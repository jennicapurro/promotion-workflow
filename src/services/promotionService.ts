/**
 * services/promotionService.ts
 *
 * Core orchestration layer. Called after the Slack modal is submitted.
 * Coordinates all downstream services in sequence, with structured logging
 * at every step and error notifications to Jenni on any failure.
 *
 * Steps:
 *   1. Generate promotion letter PDF
 *   2. Create DocuSign envelope (route to manager → Alex Bovee)
 *   3. Register envelope for webhook tracking
 *   4. Notify Jenni that the envelope is en route
 *
 * Post-signing (triggered by DocuSign webhook in docusign/webhook.ts):
 *   5. Download signed PDF
 *   6. Save to employee folder
 *   7. Notify Jenni of completion
 */

import { WebClient } from '@slack/web-api';
import { childLogger } from '../utils/logger';
import { generatePromotionLetter } from '../document/generator';
import { createPromotionEnvelope } from '../docusign/envelope';
import { registerEnvelope } from '../docusign/webhook';
import { notifyEnvelopeSent, notifyError } from '../slack/notifications';
import { updateKey } from '../utils/idempotency';

export interface PromotionData {
  correlationId: string;
  idempotencyKey: string;

  // Employee
  employeeName: string;
  employeeEmail: string;

  // Manager
  managerName: string;
  managerEmail: string;

  // Promotion details
  newTitle: string;
  newSalary: number;
  equityDetails: string;
  effectiveDate: string;

  // Optional
  notes?: string;
  employeeFolderPath?: string;

  // Metadata
  submittedBy: string;
  submittedAt: string;
}

export class PromotionService {
  /**
   * Main orchestration entry point. Runs asynchronously after modal submission.
   * Any error at any step is caught, logged, and surfaced to Jenni via Slack.
   */
  static async orchestrate(data: PromotionData, slackClient: WebClient): Promise<void> {
    const log = childLogger(data.correlationId);

    log.info('Promotion workflow started', {
      employeeName: data.employeeName,
      newTitle: data.newTitle,
      effectiveDate: data.effectiveDate,
      submittedBy: data.submittedBy,
    });

    // ── Step 1: Generate PDF ───────────────────────────────────────────────
    let pdfBuffer: Buffer;
    try {
      log.info('Step 1/4: Generating promotion letter PDF');
      pdfBuffer = await generatePromotionLetter({
        correlationId: data.correlationId,
        employeeName: data.employeeName,
        newTitle: data.newTitle,
        newSalary: data.newSalary,
        equityDetails: data.equityDetails,
        effectiveDate: data.effectiveDate,
        managerName: data.managerName,
      });
      log.info('Step 1/4 complete: PDF generated', { sizeBytes: pdfBuffer.length });
    } catch (err: any) {
      log.error('Step 1/4 failed: PDF generation error', { error: err });
      updateKey(data.idempotencyKey, { status: 'failed' });
      await notifyError(slackClient, {
        correlationId: data.correlationId,
        employeeName: data.employeeName,
        stage: 'PDF Generation',
        message: err?.message ?? String(err),
      });
      return;
    }

    // ── Step 2: Create DocuSign envelope ──────────────────────────────────
    let envelopeId: string;
    try {
      log.info('Step 2/4: Creating DocuSign envelope');
      const result = await createPromotionEnvelope({
        correlationId: data.correlationId,
        pdfBuffer,
        employeeName: data.employeeName,
        newTitle: data.newTitle,
        effectiveDate: data.effectiveDate,
        managerName: data.managerName,
        managerEmail: data.managerEmail,
      });
      envelopeId = result.envelopeId;
      log.info('Step 2/4 complete: DocuSign envelope created', {
        envelopeId,
        status: result.status,
      });
    } catch (err: any) {
      log.error('Step 2/4 failed: DocuSign envelope creation error', { error: err });
      updateKey(data.idempotencyKey, { status: 'failed' });
      await notifyError(slackClient, {
        correlationId: data.correlationId,
        employeeName: data.employeeName,
        stage: 'DocuSign Envelope Creation',
        message: err?.message ?? String(err),
      });
      return;
    }

    // ── Step 3: Register envelope for webhook tracking ────────────────────
    log.info('Step 3/4: Registering envelope context for webhook');
    registerEnvelope(envelopeId, {
      correlationId: data.correlationId,
      idempotencyKey: data.idempotencyKey,
      employeeName: data.employeeName,
      newTitle: data.newTitle,
      effectiveDate: data.effectiveDate,
      employeeFolderPath: data.employeeFolderPath,
    });
    updateKey(data.idempotencyKey, { envelopeId, status: 'processing' });
    log.info('Step 3/4 complete: Envelope registered');

    // ── Step 4: Notify Jenni that signing is underway ─────────────────────
    log.info('Step 4/4: Sending envelope-sent notification to Jenni');
    await notifyEnvelopeSent(slackClient, {
      correlationId: data.correlationId,
      employeeName: data.employeeName,
      newTitle: data.newTitle,
      effectiveDate: data.effectiveDate,
      envelopeId,
      managerName: data.managerName,
    });
    log.info('Step 4/4 complete: Jenni notified');

    log.info('Promotion workflow orchestration complete — awaiting DocuSign signatures', {
      envelopeId,
    });
  }
}
