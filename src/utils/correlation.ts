/**
 * utils/correlation.ts
 *
 * Generates and manages correlation IDs that flow through every log line for
 * a single promotion job, making it trivial to trace the full lifecycle in logs.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a new correlation ID.
 * Format: `promo-<uuid>` — easily greppable in log streams.
 */
export function generateCorrelationId(): string {
  return `promo-${uuidv4()}`;
}
