/**
 * docusign/envelope.ts
 *
 * Creates and manages DocuSign envelopes for promotion letters.
 *
 * Signing order:
 *   1. Manager    (routing order 1)
 *   2. Alex Bovee (routing order 2)
 *
 * The envelope includes:
 *  - The generated PDF as the document
 *  - SignHere tabs placed at the "___" signature lines in the letter
 *  - A useful email subject/body for each signer
 *  - Anchor-string tab positioning (searches for text in the PDF to place tabs)
 *
 * Anchor strings match the lines in the template:
 *   "___________________________\n{{MANAGER_NAME}}" → manager sign-here
 *   "___________________________\nAlex Bovee"        → Alex sign-here
 *   "___________________________\n{{EMPLOYEE_NAME}}" → employee acknowledgement
 *
 * Note: The employee is NOT a DocuSign signer in this flow (they sign a physical
 * copy or via a separate HR onboarding process). Only manager + Alex sign here.
 * To add the employee as a third signer, add them to `carbonCopies` or `signers`
 * with routing order 3.
 */

import docusign from 'docusign-esign';
import { getDocuSignClient, invalidateTokenCache } from './client';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CreateEnvelopeParams {
  correlationId: string;
  pdfBuffer: Buffer;
  employeeName: string;
  newTitle: string;
  effectiveDate: string;
  managerName: string;
  managerEmail: string;
}

export interface EnvelopeResult {
  envelopeId: string;
  status: string;
}

/**
 * Uploads the promotion letter PDF to DocuSign and creates a sent envelope.
 * Retries once on auth failure (in case token expired between cache check and use).
 */
export async function createPromotionEnvelope(
  params: CreateEnvelopeParams,
): Promise<EnvelopeResult> {
  try {
    return await doCreateEnvelope(params);
  } catch (err: any) {
    // Retry once if we get a 401 (stale token)
    if (err?.response?.status === 401 || err?.statusCode === 401) {
      logger.warn('DocuSign 401 — invalidating token cache and retrying', {
        correlationId: params.correlationId,
      });
      invalidateTokenCache();
      return await doCreateEnvelope(params);
    }
    throw err;
  }
}

async function doCreateEnvelope(params: CreateEnvelopeParams): Promise<EnvelopeResult> {
  const log = logger.child({ correlationId: params.correlationId });
  log.info('Creating DocuSign envelope', {
    employeeName: params.employeeName,
    managerEmail: params.managerEmail,
  });

  const apiClient = await getDocuSignClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const envelopeDefinition = buildEnvelopeDefinition(params);

  const result = await envelopesApi.createEnvelope(config.docusign.accountId, {
    envelopeDefinition,
  });

  if (!result.envelopeId) {
    throw new Error('DocuSign returned no envelope ID');
  }

  log.info('DocuSign envelope created', {
    envelopeId: result.envelopeId,
    status: result.status,
  });

  return {
    envelopeId: result.envelopeId,
    status: result.status ?? 'sent',
  };
}

// ── Envelope construction ─────────────────────────────────────────────────────

function buildEnvelopeDefinition(
  params: CreateEnvelopeParams,
): docusign.EnvelopeDefinition {
  const document = buildDocument(params.pdfBuffer, params.employeeName);
  const manager = buildManagerSigner(params);
  const alexBovee = buildAlexBoveeSigner(params);

  return {
    emailSubject: `Action Required: Promotion Letter for ${params.employeeName}`,
    emailBlurb: buildEmailBody(params),
    documents: [document],
    recipients: {
      signers: [manager, alexBovee],
    },
    status: 'sent', // Send immediately (use "created" to hold as draft)
    notification: {
      useAccountDefaults: 'false',
      reminders: {
        reminderEnabled: 'true',
        reminderDelay: '2',      // remind after 2 days
        reminderFrequency: '2',  // then every 2 days
      },
      expirations: {
        expireEnabled: 'true',
        expireAfter: '30',       // expire after 30 days
        expireWarn: '5',         // warn 5 days before expiry
      },
    },
  };
}

function buildDocument(pdfBuffer: Buffer, employeeName: string): docusign.Document {
  return {
    documentBase64: pdfBuffer.toString('base64'),
    name: `Promotion Letter — ${employeeName}`,
    fileExtension: 'pdf',
    documentId: '1',
  };
}

function buildManagerSigner(params: CreateEnvelopeParams): docusign.Signer {
  return {
    email: params.managerEmail,
    name: params.managerName,
    recipientId: '1',
    routingOrder: '1',
    emailNotification: {
      emailSubject: `Please sign: Promotion letter for ${params.employeeName}`,
      emailBody: `Hi ${params.managerName},\n\nPlease review and sign the promotion letter for ${params.employeeName} — ${params.newTitle}, effective ${params.effectiveDate}.\n\nThank you.`,
    },
    tabs: {
      signHereTabs: [
        {
          // Anchor to the manager's signature line in the PDF
          anchorString: '___________________________',
          anchorUnits: 'pixels',
          anchorXOffset: '0',
          anchorYOffset: '-5',
          anchorIgnoreIfNotPresent: 'false',
          anchorCaseSensitive: 'false',
          // Only the FIRST anchor occurrence = manager signature line
          anchorMatchWholeWord: 'false',
          tabId: 'manager_sign',
          name: 'Manager Signature',
          documentId: '1',
          recipientId: '1',
          // Use occurrence index 1 (first instance of the anchor string)
          tabOrder: '1',
        } as any,
      ],
      dateTabs: [
        {
          anchorString: '___________________________',
          anchorUnits: 'pixels',
          anchorXOffset: '250',
          anchorYOffset: '-5',
          anchorIgnoreIfNotPresent: 'true',
          tabOrder: '1',
          documentId: '1',
          recipientId: '1',
        } as any,
      ],
    },
  };
}

function buildAlexBoveeSigner(params: CreateEnvelopeParams): docusign.Signer {
  return {
    email: config.signers.alexBovee.email,
    name: config.signers.alexBovee.name,
    recipientId: '2',
    routingOrder: '2',
    emailNotification: {
      emailSubject: `Please sign: Promotion letter for ${params.employeeName}`,
      emailBody: `Hi Alex,\n\nThe manager has signed. Please review and countersign the promotion letter for ${params.employeeName} — ${params.newTitle}, effective ${params.effectiveDate}.\n\nThank you.`,
    },
    tabs: {
      signHereTabs: [
        {
          // Second occurrence of the anchor string = Alex's signature line
          anchorString: 'Alex Bovee',
          anchorUnits: 'pixels',
          anchorXOffset: '-10',
          anchorYOffset: '-25',
          anchorIgnoreIfNotPresent: 'false',
          tabId: 'alex_sign',
          name: 'Authorized Signatory',
          documentId: '1',
          recipientId: '2',
        } as any,
      ],
    },
  };
}

function buildEmailBody(params: CreateEnvelopeParams): string {
  return (
    `This DocuSign envelope contains a promotion letter for ${params.employeeName}.\n\n` +
    `New Title: ${params.newTitle}\n` +
    `Effective Date: ${params.effectiveDate}\n\n` +
    `Signing order: (1) ${params.managerName}, (2) Alex Bovee.\n\n` +
    `Please sign at your earliest convenience.`
  );
}

// ── Envelope retrieval ────────────────────────────────────────────────────────

/**
 * Downloads the completed signed document PDF from DocuSign.
 * Call this after receiving a "completed" webhook event.
 */
export async function downloadSignedDocument(
  envelopeId: string,
  correlationId: string,
): Promise<Buffer> {
  const log = logger.child({ correlationId, envelopeId });
  log.info('Downloading signed document from DocuSign');

  const apiClient = await getDocuSignClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  // getDocument returns a Buffer (Readable stream of the PDF bytes)
  const pdfBytes = await envelopesApi.getDocument(
    config.docusign.accountId,
    envelopeId,
    'combined', // "combined" = all docs merged into one PDF
  );

  const buffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes as any);
  log.info('Signed document downloaded', { sizeBytes: buffer.length });
  return buffer;
}

/**
 * Returns the DocuSign web app URL for an envelope (for Jenni's notification).
 */
export function getEnvelopeWebUrl(envelopeId: string): string {
  // Derive from base path: https://na4.docusign.net/restapi → https://app.docusign.com
  const isDemo = config.docusign.basePath.includes('demo');
  const appBase = isDemo ? 'https://appdemo.docusign.com' : 'https://app.docusign.com';
  return `${appBase}/documents/details/${envelopeId}`;
}
