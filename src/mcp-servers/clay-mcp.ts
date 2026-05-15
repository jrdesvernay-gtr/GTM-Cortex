import axios, { AxiosError } from 'axios';
import { CLAY_BASE_URL, MAX_ENRICHMENT_BATCH } from '../config/constants';
import { Lead } from './apify-mcp';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

export interface EnrichedLead extends Lead {
  email?: string;
  linkedin_url?: string;
  company_size?: string;
  industry?: string;
  decision_maker_name?: string;
  decision_maker_email?: string;
  icp_score: number;
  company?: string;
  title?: string;
}

interface ClayEnrichmentResponse {
  results: Array<{
    id: string;
    email?: string;
    linkedin_url?: string;
    company?: {
      name?: string;
      size?: string;
      industry?: string;
    };
    decision_maker?: {
      name?: string;
      email?: string;
    };
    error?: string;
  }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enrichBatch(
  leads: Lead[],
  enrichFields: string[]
): Promise<EnrichedLead[]> {
  const apiKey = process.env.CLAY_API_KEY;

  try {
    const response = await axios.post<ClayEnrichmentResponse>(
      `${CLAY_BASE_URL}/enrichments/batch`,
      {
        leads: leads.map((l) => ({
          name: l.name,
          phone: l.phone,
          website: l.website,
          address: l.address,
          source: l.source,
        })),
        fields: enrichFields,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return leads.map((lead, index) => {
      const result = response.data.results[index] || {};
      const enriched: EnrichedLead = {
        ...lead,
        email: result.email,
        linkedin_url: result.linkedin_url,
        company: result.company?.name,
        company_size: result.company?.size,
        industry: result.company?.industry,
        decision_maker_name: result.decision_maker?.name,
        decision_maker_email: result.decision_maker?.email,
        icp_score: 0,
      };
      enriched.icp_score = scoreICP(enriched);
      return enriched;
    });
  } catch (err) {
    if (err instanceof AxiosError) {
      if (err.response?.status === 429) {
        logger.warn('Clay rate limited, retrying after 5s...');
        await sleep(5000);
        return enrichBatch(leads, enrichFields);
      }
      logger.error('Clay enrichment API error', err.response?.data);
    }
    // Fall back to original lead data with ICP scoring on partial data
    logger.warn('Clay enrichment failed, falling back to raw lead data');
    return leads.map((lead) => {
      const enriched: EnrichedLead = { ...lead, icp_score: 0 };
      enriched.icp_score = scoreICP(enriched);
      return enriched;
    });
  }
}

export async function batchEnrichLeads(
  leads: Lead[],
  enrichFields: string[] = ['email', 'linkedin_url', 'company_info', 'decision_maker']
): Promise<EnrichedLead[]> {
  logger.info(`Enriching ${leads.length} leads with Clay`);

  const batches: Lead[][] = [];
  for (let i = 0; i < leads.length; i += MAX_ENRICHMENT_BATCH) {
    batches.push(leads.slice(i, i + MAX_ENRICHMENT_BATCH));
  }

  const allEnriched: EnrichedLead[] = [];
  for (let i = 0; i < batches.length; i++) {
    logger.info(`Processing batch ${i + 1}/${batches.length}`);
    const enriched = await enrichBatch(batches[i], enrichFields);
    allEnriched.push(...enriched);

    // Rate limit: pause between batches
    if (i < batches.length - 1) {
      await sleep(1000);
    }
  }

  logger.info(`Enrichment complete: ${allEnriched.length} leads processed`);
  return allEnriched;
}

export function scoreICP(lead: EnrichedLead): number {
  let score = 0;

  // Has email (30 pts)
  if (lead.email && lead.email.includes('@')) {
    score += 30;
  }

  // Has phone (10 pts)
  if (lead.phone && lead.phone.trim().length > 0) {
    score += 10;
  }

  // Has LinkedIn URL (15 pts)
  if (lead.linkedin_url && lead.linkedin_url.includes('linkedin')) {
    score += 15;
  }

  // Has company size (10 pts)
  if (lead.company_size && lead.company_size.trim().length > 0) {
    score += 10;
  }

  // Has decision maker (25 pts)
  if (
    (lead.decision_maker_name && lead.decision_maker_name.trim().length > 0) ||
    (lead.decision_maker_email && lead.decision_maker_email.includes('@'))
  ) {
    score += 25;
  }

  // Industry match heuristic (10 pts) - high-value industries
  const highValueIndustries = [
    'saas', 'software', 'technology', 'healthcare', 'finance',
    'fintech', 'professional services', 'consulting', 'marketing',
    'real estate', 'legal', 'insurance',
  ];
  const industry = (lead.industry || lead.category || '').toLowerCase();
  if (highValueIndustries.some((ind) => industry.includes(ind))) {
    score += 10;
  }

  return Math.min(score, 100);
}
