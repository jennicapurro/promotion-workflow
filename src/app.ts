/**
 * app.ts
 *
 * Application entry point.
 *
 * Bootstraps:
 *   1. Config validation (exits immediately on missing env vars)
 *   2. Express server with Slack Bolt receiver
 *   3. DocuSign webhook route (requires raw body for HMAC validation)
 *   4. Health check endpoint
 *   5. Graceful shutdown handling
 *
 * Port: controlled by PORT env var (default 3000).
 * On Union Station: set PORT to whatever the platform expects and point the
 * external URL to APP_BASE_URL.
 */

import { config } from './config'; // validates all required env vars at import time
import express, { Request, Response } from 'express';
import { initSlack } from './slack';
import { buildWebhookRouter } from './docusign/webhook';
import { requestLogger } from './middleware/logging';
import { logger } from './utils/logger';
import { WebClient } from '@slack/web-api';

async function main(): Promise<void> {
  logger.info('Starting Promotion Workflow service', {
    env: config.app.env,
    port: config.app.port,
    baseUrl: config.app.baseUrl,
  });

  // ── Slack Bolt app (uses ExpressReceiver internally) ──────────────────────
  const { receiver } = initSlack();
  const expressApp = receiver.app;

  // ── Slack Web client for sending notifications (independent of Bolt events) ─
  const slackClient = new WebClient(config.slack.botToken);

  // ── Middleware ────────────────────────────────────────────────────────────
  expressApp.use(requestLogger);

  // Raw body parser for DocuSign webhook route (must come before JSON parser)
  expressApp.use('/docusign/webhook', express.raw({ type: 'application/json' }));

  // JSON parser for all other routes
  expressApp.use(express.json());

  // ── Health check ──────────────────────────────────────────────────────────
  expressApp.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'promotion-workflow',
      timestamp: new Date().toISOString(),
      env: config.app.env,
    });
  });

  // ── DocuSign webhook route ────────────────────────────────────────────────
  expressApp.use(buildWebhookRouter(slackClient));

  // ── Start server ─────────────────────────────────────────────────────────
  const server = expressApp.listen(config.app.port, () => {
    logger.info('Server listening', {
      port: config.app.port,
      webhookUrl: `${config.app.baseUrl}/docusign/webhook`,
      slackEventsUrl: `${config.app.baseUrl}/slack/events`,
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal} — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timeout — forcing exit');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled errors so they're logged before the process dies
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
