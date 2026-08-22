import type { JsonValue } from '../crypto/json.js';
import { hashCanonicalValue } from '../crypto/sha256.js';
import {
  createProvenanceBatch,
  type ProvenanceBatch,
  type ProvenanceBatchInput,
} from '../domain/provenanceBatch.js';
import type { ProvenanceEvent } from '../domain/provenanceEvent.js';

/**
 * The manifest hash for a batch covers the events it bundles, in the exact
 * order they were captured on-device (chronological, never sorted) — the
 * order is part of what the hash attests to.
 */
export function computeBatchManifestHash(events: readonly ProvenanceEvent[]): string {
  const structure: JsonValue = events.map((event) => ({
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
  }));
  return hashCanonicalValue(structure);
}

export interface CreateBatchFromEventsOptions {
  id: ProvenanceBatchInput['id'];
  profileId: ProvenanceBatchInput['profileId'];
  deviceId: ProvenanceBatchInput['deviceId'];
  sessionId: ProvenanceBatchInput['sessionId'];
  previousBatchHash?: string;
  events: readonly ProvenanceEvent[];
  createdAt: string;
}

export function createBatchFromEvents(options: CreateBatchFromEventsOptions): ProvenanceBatch {
  if (options.events.length === 0) {
    throw new Error('A ProvenanceBatch must contain at least one event');
  }
  const occurredTimestamps = options.events.map((event) => event.occurredAt);
  const firstEventAt = occurredTimestamps.reduce((min, ts) => (ts < min ? ts : min));
  const lastEventAt = occurredTimestamps.reduce((max, ts) => (ts > max ? ts : max));

  return createProvenanceBatch({
    id: options.id,
    profileId: options.profileId,
    deviceId: options.deviceId,
    sessionId: options.sessionId,
    eventCount: options.events.length,
    firstEventAt,
    lastEventAt,
    ...(options.previousBatchHash !== undefined ? { previousBatchHash: options.previousBatchHash } : {}),
    manifestHash: computeBatchManifestHash(options.events),
    createdAt: options.createdAt,
  });
}

export interface BatchChainValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates that consecutive batches (same device/session lineage,
 * ascending createdAt order) link correctly: each batch's
 * previousBatchHash must equal the prior batch's manifestHash.
 */
export function validateBatchChain(batches: readonly ProvenanceBatch[]): BatchChainValidationResult {
  const errors: string[] = [];

  batches.forEach((batch, index) => {
    const previous = index > 0 ? batches[index - 1] : undefined;
    if (previous !== undefined && batch.previousBatchHash !== previous.manifestHash) {
      errors.push(`Batch ${batch.id} previousBatchHash does not match batch ${previous.id}'s manifestHash`);
    }
    if (previous === undefined && batch.previousBatchHash !== undefined) {
      errors.push(`Batch ${batch.id} is first in chain but declares a previousBatchHash`);
    }
  });

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
