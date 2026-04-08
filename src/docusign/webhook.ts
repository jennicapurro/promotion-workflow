/**
 * docusign/webhook.ts
 *
 * Express route handler for DocuSign Connect webhook callbacks.
 *
 * DocuSign sends a POST to /docusign/webhook when envelope status changes.
 * We listen for "completed" status and trigger the post-signing flow:
 *   1. Download signed PDF from DocuSign
 *   2. Save to employee folder (StorageService)
 *   3. Notify Jenni via Slack DM
 *
 * Security:
 *   - Validates the HMAC-SHA256 signature in the X-DocuSign-Signature-1 header
 *     using DOCUSIGN_WEBHOOK_HMAC_KEY (set in DocuSign Connect configuration).
 *   - If the key is not configured, validation is skipped with a warning
 *     (acceptable only during local development).
 *
 * DocuSign Connect setup (in DocuSign Admin → Integrations → Connect):
 *   URL: https://<APP_BASE_URL>/docusign/webhook
 *   Trigger events: Envelope Completed, Envelope Declined, Envelope Voided
 *   Data format: JSON
 *   Include: Documents
 *   HMAC Key: <value of DOCUSIGN_WEBHOOK_HMAC_KEY>
 *   Include Certificate: Yes
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger, childLogger } from '../utils/logger';
import { downloadSignedDocument, getEnvelopeWebUrl } from './envelope';
import { getStorageService } from '../storage';
import { notifyCompletion, notifyError } from '../slack/notifications';
import { WebClient } from '@slack/web-api';
import { updateKey } from '../utils/idempotency';

// In-memory map: envelopeId → promotion job context
// Populated by PromotionService after envelope creation.
const envelopeJobMap = new Map<string, EnvelopeJobContext>();

export interface EnvelopeJobContext {
  correlationId: string;
  idempotencyKey: string;
  employeeName: string;
  newTitle: string;
  effectiveDate: string;
  employeeFolderPath?: string;
}

/** Called by PromotionService to register context for a new envelope. */
export function registerEnvelope(envelopeId: string, context: EnvelopeJobContext): void {
  envelopeJobMap.set(envelopeId, context);
  logger.info('Envelope registered for webhook tracking', {
    envelopeId,
    correlationId: context.correlationId,
  });
}

export function buildWebhookRouter(slackClient: WebClient): Router {
  const router = Router();

  // Raw body is needed for HMAC verification; Express must be configured with
  // express.raw() for this route (done in app.ts before JSON middleware).
  router.post('/docusign/webhook', async (req: Request, res: Response) => {
    const log = logger.child({ route: 'docusign-webhook' });

    // ── HMAC validation ────────────────────────────────────────────────────
    if (config.docusign.webhookHmacKey) {
      const signature = req.headers['x-docusign-signature-1'] as string | undefined;
      if (!signature || !verifyHmac(req.body as Buffer, signature, config.docusign.webhookHmacKey)) {
        log.warn('DocuSign webhook HMAC validation failed — rejecting');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      log.warn('DOCUSIGN_WEBHOOK_HMAC_KEY not set — skipping webhook signature validation');
    }

    // ── Parse payload ──────────────────────────────────────────────────────
    let payload: any;
    try {
      const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : JSON.stringify(req.body);
      payload = JSON.parse(bodyStr);
    } catch (err) {
      log.error('Failed to parse DocuSign webhook payload', { error: err });
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // DocuSign Connect JSON format
    const envelopeId: string = payload?.data?.envelopeId ?? payload?.envelopeId;
    const status: string = payload?.data?.envelopeSummary?.status ?? payload?.status;

    log.info('DocuSign webhook received', { envelopeId, status });

    // Always respond 200 quickly — processing is async
    res.status(200).json({ received: true });

    // ── Route by status ────────────────────────────────────────────────────
    if (status === 'completed') {
      await handleCompleted(envelopeId, slackClient, log);
    } else if (status === 'declined' || status === 'voided') {
      await handleCancelled(envelopeId, status, slackClient, log);
    } else {
      log.info('DocuSign webhook: non-terminal status — no action taken', { status });
    }
  });

  return router;
}

// ── Status handlers ───────────────────────────────────────────────────────────

async function handleCompleted(
  envelopeId: string,
  slackClient: WebClient,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const context = envelopeJobMap.get(envelopeId);
  if (!context) {
    log.warn('Received completed webhook for unknown envelope — may have restarted', {
      envelopeId,
    });
    // Still attempt to notify Jenni with limited info
    await notifyCompletion(slackClient, {
      correlationId: 'unknown',
      employeeName: 'Unknown (envelope not tracked)',
      newTitle: 'Unknown',
      effectiveDate: 'Unknown',
      envelopeId,
      docusignUrl: getEnvelopeWebUrl(envelopeId),
    });
    return;
  }

  const jobLog = childLogger(context.correlationId);
  jobLog.info('Processing completed DocuSign envelope', { envelopeId });

  let storagePath: string | undefined;

  // ── Download signed PDF ──────────────────────────────────────────────────
  let signedPdf: Buffer;
  try {
    signedPdf = await downloadSignedDocument(envelopeId, context.correlationId);
    jobLog.info('Signed PDF downloaded successfully');
  } catch (err: any) {
    jobLog.error('Failed to download signed document', { error: err });
    await notifyError(slackClient, {
      correlationId: context.correlationId,
      employeeName: context.employeeName,
      stage: 'Signed Document Download',
      message: err?.message ?? String(err),
    });
    return;
  }

  // ── Save to storage ──────────────────────────────────────────────────────
  try {
    const storage = getStorageService();
    const fileName = buildFileName(context.employeeName, context.effectiveDate);
    const folderPath = context.employeeFolderPath ?? buildDefaultFolderPath(context.employeeName);

    storagePath = await storage.saveDocument({
      correlationId: context.correlationId,
      folderPath,
      fileName,
      content: signedPdf,
    });

    jobLog.info('Signed document saved to storage', { storagePath });
    updateKey(context.idempotencyKey, { status: 'completed', envelopeId });
  } catch (err: any) {
    jobLog.error('Failed to save signed document to storage', { error: err });
    await notifyError(slackClient, {
      correlationId: context.correlationId,
      employeeName: context.employeeName,
      stage: 'Document Storage',
      message: err?.message ?? String(err),
    });
    // Still notify Jenni of completion even if storage failed
  }

  // ── Notify Jenni ─────────────────────────────────────────────────────────
  await notifyCompletion(slackClient, {
    correlationId: context.correlationId,
    employeeName: context.employeeName,
    newTitle: context.newTitle,
    effectiveDate: context.effectiveDate,
    envelopeId,
    docusignUrl: getEnvelopeWebUrl(envelopeId),
    storagePath,
  });

  // Clean up the in-memory map
  envelopeJobMap.delete(envelopeId);
  jobLog.info('Completed envelope processed and cleaned up', { envelopeId });
}

async function handleCancelled(
  envelopeId: string,
  status: string,
  slackClient: WebClient,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const context = envelopeJobMap.get(envelopeId);
  const employeeName = context?.employeeName ?? 'Unknown';
  const correlationId = context?.correlationId ?? 'unknown';

  log.warn('DocuSign envelope was cancelled', { envelopeId, status, employeeName });

  await notifyError(slackClient, {
    correlationId,
    employeeName,
    stage: 'DocuSign Signing',
    message: `Envelope was ${status}. Envelope ID: ${envelopeId}. Please re-initiate the promotion workflow if needed.`,
  });

  if (context) {
    updateKey(context.idempotencyKey, { status: 'failed' });
    envelopeJobMap.delete(envelopeId);
  }
}

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifyHmac(body: Buffer, signature: string, key: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(body);
    const expected = hmac.digest('base64');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function buildFileName(employeeName: string, effectiveDate: string): string {
  const safeName = employeeName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
  const safeDate = effectiveDate.replace(/\//g, '-');
  return `Promotion_Letter_${safeName}_${safeDate}_signed.pdf`;
}

function buildDefaultFolderPath(employeeName: string): string {
  // Default: employees/<first-last-lowercase>
  const slug = employeeName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `employees/${slug}`;
}
