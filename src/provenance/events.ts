import { EVENT_SOURCES, EVENT_TYPES } from '../domain/enums.js';
import type { ProvenanceEvent } from '../domain/provenanceEvent.js';

export interface EventValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Structural + policy validation for a canonical provenance event, beyond
 * what the domain factory already enforces at construction time. Used when
 * ingesting events built elsewhere (e.g. deserialized from a batch) whose
 * provenance the caller does not fully trust yet.
 */
export function validateProvenanceEvent(event: ProvenanceEvent): EventValidationResult {
  const errors: string[] = [];

  if (!EVENT_SOURCES.includes(event.source)) {
    errors.push(`Unrecognized event source "${event.source}"`);
  }
  if (!EVENT_TYPES.includes(event.eventType)) {
    errors.push(`Unrecognized event type "${event.eventType}"`);
  }
  if (event.receivedAt !== undefined && event.receivedAt < event.occurredAt) {
    errors.push('receivedAt cannot precede occurredAt');
  }
  if (event.eventId.trim().length === 0) {
    errors.push('eventId must not be empty');
  }

  const requiresAsset: readonly string[] = [
    'asset_created',
    'asset_imported',
    'asset_modified',
    'asset_removed',
    'audio_recorded',
    'midi_created',
    'stem_exported',
    'mix_exported',
    'master_exported',
  ];
  if (requiresAsset.includes(event.eventType) && event.assetId === undefined) {
    errors.push(`Event type "${event.eventType}" requires an assetId`);
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Validates ordering within one session's event stream: occurredAt must be
 * non-decreasing. This is a coarse sanity check, not a security control —
 * a compromised device can still forge occurredAt (see SECURITY.md).
 */
export function validateEventOrdering(events: readonly ProvenanceEvent[]): EventValidationResult {
  const errors: string[] = [];
  for (let i = 1; i < events.length; i += 1) {
    const previous = events[i - 1];
    const current = events[i];
    if (previous !== undefined && current !== undefined && current.occurredAt < previous.occurredAt) {
      errors.push(`Event ${current.eventId} occurredAt precedes prior event ${previous.eventId}`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
