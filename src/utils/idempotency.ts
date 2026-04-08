/**
 * utils/idempotency.ts
 *
 * In-process idempotency store that prevents duplicate envelope submissions if
 * a user accidentally double-submits the modal or a retry fires unexpectedly.
 *
 * State is keyed by the Slack view submission's `view.id` (unique per modal open)
 * and expires after TTL_MS to avoid unbounded memory growth.
 *
 * NOTE: For multi-instance deployments on Union Station, replace this with a
 * shared Redis/Memcached store. The interface is the same — just swap the Map
 * for a Redis SET with NX + EX flags.
 */

import { logger } from './logger';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface IdempotencyEntry {
  correlationId: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: number;
  envelopeId?: string;
}

const store = new Map<string, IdempotencyEntry>();

/** Attempt to claim an idempotency key. Returns false if already claimed. */
export function claimKey(key: string, correlationId: string): boolean {
  pruneExpired();
  if (store.has(key)) {
    logger.warn('Idempotency key already claimed — blocking duplicate submission', {
      key,
      existing: store.get(key),
    });
    return false;
  }
  store.set(key, { correlationId, status: 'processing', createdAt: Date.now() });
  return true;
}

/** Update the status of a claimed key (e.g. after envelope creation). */
export function updateKey(key: string, update: Partial<IdempotencyEntry>): void {
  const entry = store.get(key);
  if (entry) {
    store.set(key, { ...entry, ...update });
  }
}

/** Look up an existing entry without claiming it. */
export function getEntry(key: string): IdempotencyEntry | undefined {
  return store.get(key);
}

/** Release a key (use only on confirmed permanent failure). */
export function releaseKey(key: string): void {
  store.delete(key);
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(key);
    }
  }
}
