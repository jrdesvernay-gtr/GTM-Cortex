import { Router } from 'express';
import * as handlers from './handlers';
import instantlyWebhook from '../webhooks/instantly-webhook';

const router = Router();

// Campaign management
router.post('/campaigns/start', handlers.startCampaignSync);
router.get('/campaigns/:id', handlers.getCampaign);

// Analytics
router.get('/analytics/recent', handlers.getRecentAnalytics);

// Webhooks
router.use('/webhooks/instantly', instantlyWebhook);

// Health check
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

export default router;
