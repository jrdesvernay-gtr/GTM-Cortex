import { Request, Response } from 'express';
import { orchestrate } from '../orchestrator/claude-orchestrator';
import { getCampaignById, getRecentCampaigns } from '../database/campaigns';
import { getFeedbackByCampaign } from '../database/feedback';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

export async function startCampaign(req: Request, res: Response): Promise<void> {
  try {
    const { segment, source, template, limit } = req.body as {
      segment?: string;
      source?: string;
      template?: string;
      limit?: number;
    };

    if (!segment || !source) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['segment', 'source'],
        example: {
          segment: 'dentists in Seattle',
          source: 'email',
          limit: 50,
        },
      });
      return;
    }

    const userRequest = `Find ${segment} and reach out via ${source}`;
    logger.info(`Starting campaign: ${userRequest}`);

    // Respond immediately with 202 Accepted
    const startResult = { status: 'processing', message: 'Campaign orchestration started' };
    res.status(202).json(startResult);

    // Orchestrate in background
    orchestrate({
      userRequest,
      limit: limit || 50,
      templateOverride: template,
    }).then((result) => {
      logger.info(`Campaign orchestration completed: ${result.campaignId}`);
    }).catch((err) => {
      logger.error('Campaign orchestration failed', err);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logger.error('startCampaign handler error', err);
    res.status(500).json({ error: message });
  }
}

export async function startCampaignSync(req: Request, res: Response): Promise<void> {
  try {
    const { segment, source, template, limit } = req.body as {
      segment?: string;
      source?: string;
      template?: string;
      limit?: number;
    };

    if (!segment || !source) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['segment', 'source'],
      });
      return;
    }

    const userRequest = `Find ${segment} and reach out via ${source}`;
    logger.info(`Starting campaign (sync): ${userRequest}`);

    const result = await orchestrate({
      userRequest,
      limit: limit || 50,
      templateOverride: template,
    });

    res.status(result.campaignId ? 202 : 422).json({
      campaignId: result.campaignId,
      status: result.status,
      leadsSourced: result.leadsSourced,
      leadsEnriched: result.leadsEnriched,
      message: result.message,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logger.error('startCampaignSync handler error', err);
    res.status(500).json({ error: message });
  }
}

export async function getCampaign(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'Campaign ID required' });
      return;
    }

    const campaign = await getCampaignById(id);
    if (!campaign) {
      res.status(404).json({ error: `Campaign ${id} not found` });
      return;
    }

    const feedback = await getFeedbackByCampaign(id);

    res.status(200).json({
      campaign,
      feedback,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logger.error('getCampaign handler error', err);
    res.status(500).json({ error: message });
  }
}

export async function getRecentAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const campaigns = await getRecentCampaigns(20);

    const totalSent = campaigns.reduce((sum, c) => sum + (c.total_leads_sent || 0), 0);
    const totalOpens = campaigns.reduce((sum, c) => sum + (c.opens || 0), 0);
    const totalReplies = campaigns.reduce((sum, c) => sum + (c.replies || 0), 0);

    const avgOpenRate = totalSent > 0 ? totalOpens / totalSent : 0;
    const avgReplyRate = totalSent > 0 ? totalReplies / totalSent : 0;

    res.status(200).json({
      campaigns,
      aggregates: {
        total_sent: totalSent,
        avg_open_rate: Math.round(avgOpenRate * 1000) / 1000,
        avg_reply_rate: Math.round(avgReplyRate * 1000) / 1000,
        campaign_count: campaigns.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logger.error('getRecentAnalytics handler error', err);
    res.status(500).json({ error: message });
  }
}
