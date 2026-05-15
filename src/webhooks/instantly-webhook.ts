import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../database/db';
import { updateCampaignMetrics } from '../database/campaigns';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

const router = Router();

type EventType = 'email_opened' | 'email_clicked' | 'email_replied' | 'email_bounced';
type MetricColumn = 'opens' | 'clicks' | 'replies' | 'bounces';

const EVENT_TO_METRIC: Record<EventType, MetricColumn> = {
  email_opened: 'opens',
  email_clicked: 'clicks',
  email_replied: 'replies',
  email_bounced: 'bounces',
};

interface InstantlyWebhookPayload {
  event_type: string;
  campaign_id: string;
  email?: string;
  timestamp?: string;
  [key: string]: unknown;
}

function verifyWebhookSignature(req: Request): boolean {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured

  const signature = req.headers['x-instantly-signature'] as string;
  if (!signature) {
    logger.warn('Webhook received without signature header');
    return false;
  }

  const rawBody = JSON.stringify(req.body);
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSig, 'hex')
  );
}

async function processWebhookEvent(payload: InstantlyWebhookPayload): Promise<void> {
  const { event_type, campaign_id } = payload;

  if (!campaign_id) {
    logger.warn('Webhook event missing campaign_id', payload);
    return;
  }

  // Look up internal campaign ID from Instantly campaign ID
  const result = await query<{ id: string }>(
    'SELECT id FROM campaigns WHERE instantly_campaign_id = $1',
    [campaign_id]
  );

  if (result.rows.length === 0) {
    logger.warn(`No campaign found for Instantly campaign ID: ${campaign_id}`);
    return;
  }

  const internalCampaignId = result.rows[0].id;
  const metric = EVENT_TO_METRIC[event_type as EventType];

  if (!metric) {
    logger.info(`Ignoring unknown event type: ${event_type}`);
    return;
  }

  await updateCampaignMetrics(internalCampaignId, metric);
  logger.info(`Updated ${metric} for campaign ${internalCampaignId} (event: ${event_type})`);

  // Update lead status if we have the email
  if (payload.email && event_type === 'email_replied') {
    await query(
      `UPDATE leads SET status = 'replied' WHERE campaign_id = $1 AND email = $2`,
      [internalCampaignId, payload.email]
    );
  } else if (payload.email && event_type === 'email_bounced') {
    await query(
      `UPDATE leads SET status = 'bounced' WHERE campaign_id = $1 AND email = $2`,
      [internalCampaignId, payload.email]
    );
  }
}

router.post('/', (req: Request, res: Response) => {
  // Respond immediately — Instantly expects a fast response
  res.status(200).json({ received: true });

  // Process asynchronously to avoid blocking
  setImmediate(async () => {
    try {
      if (!verifyWebhookSignature(req)) {
        logger.warn('Invalid webhook signature, ignoring event');
        return;
      }

      const payload = req.body as InstantlyWebhookPayload;
      logger.info(`Webhook received: ${payload.event_type} for campaign ${payload.campaign_id}`);

      await processWebhookEvent(payload);
    } catch (err) {
      logger.error('Webhook processing error', err);
    }
  });
});

export default router;
