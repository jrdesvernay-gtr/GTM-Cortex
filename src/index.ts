import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import routes from './api/routes';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Mount API routes
app.use('/api', routes);

// Root redirect
app.get('/', (_req, res) => {
  res.json({
    name: 'GTM Cortex',
    version: '1.0.0',
    description: 'GTM/RevOps AI Orchestrator powered by Claude',
    docs: '/api/health',
    endpoints: {
      start_campaign: 'POST /api/campaigns/start',
      get_campaign: 'GET /api/campaigns/:id',
      analytics: 'GET /api/analytics/recent',
      webhook: 'POST /api/webhooks/instantly',
    },
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  logger.info(`GTM Cortex server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`API available at: http://localhost:${PORT}/api`);
});

export default app;
