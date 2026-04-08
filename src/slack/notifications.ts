/**
 * slack/notifications.ts
 *
 * All outbound Slack messages sent to Jenni. Centralised here so the message
 * format and content are easy to update without touching business logic.
 */

import { WebClient } from '@slack/web-api';
import { config } from '../config';
import { logger } from '../utils/logger';

const JENNI_USER_ID = config.slack.authorizedUserId;

// ── Notification types ────────────────────────────────────────────────────────

export interface CompletionNotificationParams {
  correlationId: string;
  employeeName: string;
  newTitle: string;
  effectiveDate: string;
  envelopeId: string;
  docusignUrl?: string;
  storagePath?: string;
}

export interface ErrorNotificationParams {
  correlationId: string;
  employeeName: string;
  stage: string;
  message: string;
}

export interface EnvelopeCreatedNotificationParams {
  correlationId: string;
  employeeName: string;
  newTitle: string;
  effectiveDate: string;
  envelopeId: string;
  managerName: string;
}

// ── Outbound message functions ────────────────────────────────────────────────

/**
 * Sends Jenni a confirmation DM after the DocuSign envelope has been created
 * and routed to signers.
 */
export async function notifyEnvelopeSent(
  client: WebClient,
  params: EnvelopeCreatedNotificationParams,
): Promise<void> {
  const log = logger.child({ correlationId: params.correlationId });
  try {
    await client.chat.postMessage({
      channel: JENNI_USER_ID,
      text: `Promotion letter sent for ${params.employeeName}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Promotion Letter Sent for Signatures' },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Employee:*\n${params.employeeName}` },
            { type: 'mrkdwn', text: `*New Title:*\n${params.newTitle}` },
            { type: 'mrkdwn', text: `*Effective Date:*\n${params.effectiveDate}` },
            { type: 'mrkdwn', text: `*Manager:*\n${params.managerName}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `DocuSign envelope *${params.envelopeId}* has been created and routed for signatures.\nYou'll receive another message here when the document is fully executed.`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Correlation ID: \`${params.correlationId}\`` }],
        },
      ],
    });
    log.info('Envelope-sent notification delivered to Jenni');
  } catch (err) {
    log.error('Failed to send envelope-sent notification', { error: err });
  }
}

/**
 * Sends Jenni a DM when the document is fully signed and saved.
 */
export async function notifyCompletion(
  client: WebClient,
  params: CompletionNotificationParams,
): Promise<void> {
  const log = logger.child({ correlationId: params.correlationId });
  const storageText = params.storagePath
    ? `*Saved to:*\n\`${params.storagePath}\``
    : '*Storage:* Not saved (see logs for details)';

  try {
    await client.chat.postMessage({
      channel: JENNI_USER_ID,
      text: `Promotion letter fully executed for ${params.employeeName}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Promotion Letter Fully Executed' },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `The promotion letter for *${params.employeeName}* has been signed by all parties and is complete.`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Employee:*\n${params.employeeName}` },
            { type: 'mrkdwn', text: `*New Title:*\n${params.newTitle}` },
            { type: 'mrkdwn', text: `*Effective Date:*\n${params.effectiveDate}` },
            { type: 'mrkdwn', text: `*DocuSign Status:*\nCompleted` },
          ],
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Envelope ID:*\n\`${params.envelopeId}\`` },
            { type: 'mrkdwn', text: storageText },
          ],
        },
        ...(params.docusignUrl
          ? [
              {
                type: 'actions' as const,
                elements: [
                  {
                    type: 'button' as const,
                    text: { type: 'plain_text' as const, text: 'View in DocuSign' },
                    url: params.docusignUrl,
                    style: 'primary' as const,
                  },
                ],
              },
            ]
          : []),
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Correlation ID: \`${params.correlationId}\`` }],
        },
      ],
    });
    log.info('Completion notification delivered to Jenni');
  } catch (err) {
    log.error('Failed to send completion notification', { error: err });
  }
}

/**
 * Sends Jenni a DM when a stage of the workflow fails.
 * Always use this instead of silent failure so Jenni can take action.
 */
export async function notifyError(
  client: WebClient,
  params: ErrorNotificationParams,
): Promise<void> {
  const log = logger.child({ correlationId: params.correlationId });
  try {
    await client.chat.postMessage({
      channel: JENNI_USER_ID,
      text: `Promotion workflow error for ${params.employeeName}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Promotion Workflow Error' },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `An error occurred during the promotion workflow for *${params.employeeName}*.`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Failed at stage:*\n${params.stage}` },
            { type: 'mrkdwn', text: `*Error:*\n${params.message}` },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Please check logs for \`${params.correlationId}\` for full details.`,
            },
          ],
        },
      ],
    });
    log.info('Error notification delivered to Jenni', { stage: params.stage });
  } catch (err) {
    log.error('Failed to send error notification to Jenni (critical)', { error: err });
  }
}
