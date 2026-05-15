import Anthropic from '@anthropic-ai/sdk';
import { getCampaignById, getRecentCampaigns } from '../database/campaigns';
import { createFeedback } from '../database/feedback';
import { getPlaybookBySegment, updatePlaybookMetrics } from '../database/playbooks';
import { getCampaignStats } from '../mcp-servers/instantly-mcp';
import { FEEDBACK_LOOKBACK_DAYS } from '../config/constants';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

const FEEDBACK_SYSTEM_PROMPT = `You are a GTM/RevOps analytics expert specializing in email outreach optimization.
Analyze campaign performance metrics and provide actionable insights.
Focus on: open rates, reply rates, bounce rates, and overall campaign health.
Provide specific, data-driven recommendations.`;

interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  segment: string;
  channel: string;
  totalSent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

interface AnalysisResult {
  insight: string;
  recommendation: string;
  primaryMetric: string;
  metricValue: number;
}

async function analyzeWithClaude(metrics: CampaignMetrics): Promise<AnalysisResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Analyze these email campaign metrics and provide insights and recommendations:

Campaign: ${metrics.campaignName}
Segment: ${metrics.segment}
Channel: ${metrics.channel}
Total Sent: ${metrics.totalSent}

Performance Metrics:
- Open Rate: ${(metrics.openRate * 100).toFixed(1)}% (industry avg: 21%)
- Click Rate: ${(metrics.clickRate * 100).toFixed(1)}% (industry avg: 2.6%)
- Reply Rate: ${(metrics.replyRate * 100).toFixed(1)}% (industry avg: 1-5%)
- Bounce Rate: ${(metrics.bounceRate * 100).toFixed(1)}% (acceptable: <2%)

Provide:
1. KEY_INSIGHT: A one-sentence insight about the most important finding
2. RECOMMENDATION: A specific, actionable recommendation to improve performance
3. PRIMARY_METRIC: The most important metric to focus on (open_rate|click_rate|reply_rate|bounce_rate)
4. METRIC_VALUE: The value of that metric as a decimal (e.g., 0.25 for 25%)

Format your response as JSON:
{
  "insight": "...",
  "recommendation": "...",
  "primary_metric": "...",
  "metric_value": 0.0
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: FEEDBACK_SYSTEM_PROMPT,
          // @ts-expect-error cache_control is valid per API docs
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Extract JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      insight: string;
      recommendation: string;
      primary_metric: string;
      metric_value: number;
    };

    return {
      insight: parsed.insight,
      recommendation: parsed.recommendation,
      primaryMetric: parsed.primary_metric,
      metricValue: parsed.metric_value,
    };
  } catch (err) {
    logger.error('Claude feedback analysis failed', err);
    // Return a basic analysis as fallback
    const lowestMetric =
      metrics.openRate < 0.1 ? 'open_rate' :
      metrics.bounceRate > 0.05 ? 'bounce_rate' :
      metrics.replyRate < 0.01 ? 'reply_rate' : 'click_rate';

    return {
      insight: `Campaign "${metrics.campaignName}" has ${metrics.totalSent} recipients with ${(metrics.openRate * 100).toFixed(1)}% open rate.`,
      recommendation: `Focus on improving ${lowestMetric.replace('_', ' ')} for better campaign performance.`,
      primaryMetric: lowestMetric,
      metricValue: metrics.openRate,
    };
  }
}

export async function analyzeCampaignPerformance(campaignId: string): Promise<void> {
  logger.info(`Analyzing campaign performance: ${campaignId}`);

  try {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      logger.warn(`Campaign ${campaignId} not found for feedback analysis`);
      return;
    }

    // Fetch live stats from Instantly if available
    let liveStats = { opens: 0, clicks: 0, replies: 0, bounces: 0 };
    if (campaign.instantly_campaign_id) {
      liveStats = await getCampaignStats(campaign.instantly_campaign_id);
    }

    // Use whichever is higher: DB metrics or live stats
    const opens = Math.max(campaign.opens, liveStats.opens);
    const clicks = Math.max(campaign.clicks, liveStats.clicks);
    const replies = Math.max(campaign.replies, liveStats.replies);
    const bounces = Math.max(campaign.bounces, liveStats.bounces);
    const totalSent = campaign.total_leads_sent || 1;

    const metrics: CampaignMetrics = {
      campaignId,
      campaignName: campaign.name,
      segment: campaign.segment,
      channel: campaign.channel,
      totalSent,
      opens,
      clicks,
      replies,
      bounces,
      openRate: opens / totalSent,
      clickRate: clicks / totalSent,
      replyRate: replies / totalSent,
      bounceRate: bounces / totalSent,
    };

    // Get Claude's analysis
    const analysis = await analyzeWithClaude(metrics);

    // Save feedback to DB
    await createFeedback({
      campaign_id: campaignId,
      metric_name: analysis.primaryMetric,
      metric_value: analysis.metricValue,
      insight: analysis.insight,
      recommendation: analysis.recommendation,
    });

    // Update playbook metrics if this campaign used one
    if (campaign.playbook_id) {
      await updatePlaybookMetrics(
        campaign.playbook_id,
        metrics.openRate,
        metrics.replyRate
      );
    }

    // Also try to update by segment/channel match
    const playbook = await getPlaybookBySegment(campaign.segment, campaign.channel);
    if (playbook && playbook.id !== campaign.playbook_id) {
      await updatePlaybookMetrics(playbook.id, metrics.openRate, metrics.replyRate);
    }

    logger.info(`Feedback saved for campaign ${campaignId}: ${analysis.insight}`);
  } catch (err) {
    logger.error(`Failed to analyze campaign ${campaignId}`, err);
    throw err;
  }
}

export async function runDailyAnalysis(): Promise<void> {
  logger.info('Starting daily campaign performance analysis');

  try {
    const recentCampaigns = await getRecentCampaigns(FEEDBACK_LOOKBACK_DAYS * 10);
    const activeCampaigns = recentCampaigns.filter(
      (c) => c.status === 'sending' || c.status === 'completed'
    );

    logger.info(`Found ${activeCampaigns.length} campaigns to analyze`);

    let successCount = 0;
    let errorCount = 0;

    for (const campaign of activeCampaigns) {
      try {
        await analyzeCampaignPerformance(campaign.id);
        successCount++;
      } catch (err) {
        logger.error(`Failed to analyze campaign ${campaign.id}`, err);
        errorCount++;
      }
    }

    logger.info(`Daily analysis complete: ${successCount} succeeded, ${errorCount} failed`);
  } catch (err) {
    logger.error('Daily analysis job failed', err);
    throw err;
  }
}
