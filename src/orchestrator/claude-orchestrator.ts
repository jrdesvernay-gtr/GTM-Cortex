import Anthropic from '@anthropic-ai/sdk';
import { createCampaign, updateCampaign } from '../database/campaigns';
import { runGoogleMapsScraper, runLinkedInScraper } from '../mcp-servers/apify-mcp';
import { batchEnrichLeads, EnrichedLead } from '../mcp-servers/clay-mcp';
import { ICP_SCORE_THRESHOLD } from '../config/constants';
import { query } from '../database/db';
import { analyzeCampaignPerformance } from './feedback-loop';
import { coordinateCampaign } from './campaign-coordinator';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

export interface OrchestratorInput {
  userRequest: string;
  limit?: number;
  templateOverride?: string;
}

export interface OrchestratorResult {
  campaignId: string;
  status: string;
  leadsSourced: number;
  leadsEnriched: number;
  message: string;
}

const SYSTEM_PROMPT = `You are GTM Cortex, an AI-powered Go-To-Market orchestrator.
Your role is to parse natural language sales and marketing requests and determine the optimal execution plan.

When given a user request, you must analyze it and call the appropriate tools to:
1. Determine the data source (Google Maps for local businesses, LinkedIn for professionals)
2. Set the correct search parameters (query, location, job title, company)
3. Identify the target segment name for personalization
4. Choose the outreach channel (email or linkedin)

Be precise and actionable. Extract exact search parameters from the request.

Examples:
- "Find dentists in Seattle and email them" -> Google Maps, dentists, Seattle, email
- "Reach out to CTOs at startups in NYC" -> LinkedIn, CTO, startup, New York, email
- "Find coffee shops in Austin and message them" -> Google Maps, coffee shops, Austin, linkedin

Always call exactly one scrape tool followed by enrich_leads, then create_email_campaign.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'scrape_google_maps',
    description: 'Scrape business leads from Google Maps. Use for local businesses, restaurants, clinics, shops, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        searchQuery: { type: 'string', description: 'Business type or category to search for' },
        location: { type: 'string', description: 'City, state or region to search in' },
        limit: { type: 'number', description: 'Maximum number of leads to scrape (max 100)' },
      },
      required: ['searchQuery', 'location', 'limit'],
    },
  },
  {
    name: 'scrape_linkedin',
    description: 'Scrape professional leads from LinkedIn. Use for B2B prospecting by job title and company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        jobTitle: { type: 'string', description: 'Job title or role to target' },
        company: { type: 'string', description: 'Company type, industry or specific company name' },
        location: { type: 'string', description: 'City, state or region' },
        limit: { type: 'number', description: 'Maximum number of leads to scrape (max 100)' },
      },
      required: ['jobTitle', 'location', 'limit'],
    },
  },
  {
    name: 'enrich_leads',
    description: 'Enrich scraped leads with emails, phones, LinkedIn profiles, and company info via Clay',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadCount: { type: 'number', description: 'Number of leads to enrich' },
      },
      required: ['leadCount'],
    },
  },
  {
    name: 'create_email_campaign',
    description: 'Create and launch an outreach campaign via Instantly for the enriched and filtered leads',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaignName: { type: 'string', description: 'Descriptive name for the campaign' },
        segment: { type: 'string', description: 'Target segment label (e.g. "dentists_seattle", "saas_ctos")' },
        channel: {
          type: 'string',
          enum: ['email', 'linkedin'],
          description: 'Outreach channel to use',
        },
      },
      required: ['campaignName', 'segment', 'channel'],
    },
  },
];

export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  logger.info(`Orchestrating request: "${input.userRequest}"`);

  const limit = input.limit || 50;
  let scrapedLeads: ReturnType<typeof runGoogleMapsScraper> extends Promise<infer T> ? T : never = [];
  let enrichedLeads: EnrichedLead[] = [];
  let campaignId = '';
  let sourceType = 'unknown';
  let segment = 'general';
  let channel = 'email';

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `${input.userRequest}\n\nTarget limit: ${limit} leads.${input.templateOverride ? `\n\nCustom template provided: ${input.templateOverride}` : ''}`,
    },
  ];

  // Agentic loop with Claude tool use
  let continueLoop = true;
  while (continueLoop) {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // @ts-expect-error cache_control is valid per API docs
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOLS,
      messages,
    });

    logger.info(`Claude response: stop_reason=${response.stop_reason}`);

    // Append assistant message to history
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      continueLoop = false;
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      continueLoop = false;
      break;
    }

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const toolName = block.name;
      const toolInput = block.input as Record<string, unknown>;
      logger.info(`Executing tool: ${toolName}`, toolInput);

      let resultContent = '';

      try {
        if (toolName === 'scrape_google_maps') {
          sourceType = 'google_maps';
          const rawLeads = await runGoogleMapsScraper(
            toolInput.searchQuery as string,
            toolInput.location as string,
            toolInput.limit as number
          );
          // Store for later use
          (scrapedLeads as typeof rawLeads) = rawLeads;
          resultContent = JSON.stringify({ success: true, count: rawLeads.length, sample: rawLeads.slice(0, 2) });
        } else if (toolName === 'scrape_linkedin') {
          sourceType = 'linkedin';
          const rawLeads = await runLinkedInScraper(
            toolInput.jobTitle as string,
            toolInput.company as string || '',
            toolInput.location as string,
            toolInput.limit as number
          );
          (scrapedLeads as typeof rawLeads) = rawLeads;
          resultContent = JSON.stringify({ success: true, count: rawLeads.length, sample: rawLeads.slice(0, 2) });
        } else if (toolName === 'enrich_leads') {
          if (scrapedLeads.length === 0) {
            resultContent = JSON.stringify({ error: 'No leads to enrich. Run a scrape tool first.' });
          } else {
            enrichedLeads = await batchEnrichLeads(scrapedLeads);
            const qualified = enrichedLeads.filter((l) => l.icp_score >= ICP_SCORE_THRESHOLD);
            resultContent = JSON.stringify({
              success: true,
              total_enriched: enrichedLeads.length,
              qualified_count: qualified.length,
              avg_icp_score: Math.round(enrichedLeads.reduce((s, l) => s + l.icp_score, 0) / enrichedLeads.length),
            });
          }
        } else if (toolName === 'create_email_campaign') {
          const campaignName = toolInput.campaignName as string;
          segment = toolInput.segment as string;
          channel = toolInput.channel as string;

          // Create campaign record in DB
          const campaign = await createCampaign({
            name: campaignName,
            source_type: sourceType,
            segment,
            channel,
            status: 'processing',
            total_leads_sourced: scrapedLeads.length,
            total_leads_enriched: enrichedLeads.length,
          });
          campaignId = campaign.id;

          // Save leads to DB
          const qualifiedLeads = enrichedLeads.filter((l) => l.icp_score >= ICP_SCORE_THRESHOLD);
          for (const lead of qualifiedLeads) {
            await query(
              `INSERT INTO leads (campaign_id, name, email, phone, company, title, location, linkedin_url, source_data, enriched_data, icp_score, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                campaignId,
                lead.name,
                lead.email || null,
                lead.phone || null,
                lead.company || null,
                lead.title || lead.category || null,
                lead.address || null,
                lead.linkedin_url || null,
                JSON.stringify(lead.raw),
                JSON.stringify(lead),
                lead.icp_score,
                'enriched',
              ]
            );
          }

          // Coordinate the campaign (create Instantly campaign + send)
          if (qualifiedLeads.length > 0) {
            setImmediate(async () => {
              try {
                await coordinateCampaign(campaignId, qualifiedLeads, channel, input.templateOverride);
              } catch (err) {
                logger.error('Campaign coordination failed', err);
              }
            });
          } else {
            await updateCampaign(campaignId, { status: 'no_qualified_leads' });
          }

          resultContent = JSON.stringify({
            success: true,
            campaign_id: campaignId,
            qualified_leads: qualifiedLeads.length,
            message: `Campaign "${campaignName}" created with ${qualifiedLeads.length} qualified leads`,
          });
        } else {
          resultContent = JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Tool ${toolName} failed:`, err);
        resultContent = JSON.stringify({ error: errorMsg });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultContent,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Trigger async feedback analysis if campaign was created
  if (campaignId) {
    setTimeout(async () => {
      try {
        await analyzeCampaignPerformance(campaignId);
      } catch (err) {
        logger.warn('Background feedback analysis failed', err);
      }
    }, 5 * 60 * 1000); // analyze after 5 min
  }

  const qualifiedCount = enrichedLeads.filter((l) => l.icp_score >= ICP_SCORE_THRESHOLD).length;

  return {
    campaignId,
    status: campaignId ? 'processing' : 'failed',
    leadsSourced: scrapedLeads.length,
    leadsEnriched: enrichedLeads.length,
    message: campaignId
      ? `Campaign created with ${qualifiedCount} qualified leads (ICP score ≥ ${ICP_SCORE_THRESHOLD})`
      : 'Campaign orchestration completed without creating a campaign',
  };
}
