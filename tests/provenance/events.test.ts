import { describe, expect, it } from 'vitest';
import { asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { validateEventOrdering, validateProvenanceEvent } from '../../src/provenance/events.js';

function event(eventId: string, eventType: 'session_started' | 'asset_created', occurredAt: string, assetId?: string) {
  return createProvenanceEvent({
    eventId: asEventId(eventId),
    projectId: asProjectId('p1'),
    sessionId: asSessionId('s1'),
    actorProfileId: asProfileId('actor1'),
    deviceId: asDeviceId('d1'),
    source: 'studio_simulator',
    eventType,
    occurredAt,
    ...(assetId !== undefined ? { assetId: assetId as never } : {}),
  });
}

describe('provenance event validation', () => {
  it('flags asset-bearing event types missing an assetId', () => {
    const result = validateProvenanceEvent(event('e1', 'asset_created', '2026-01-01T00:00:00.000Z'));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('requires an assetId'))).toBe(true);
  });

  it('passes when an asset-bearing event carries an assetId', () => {
    const result = validateProvenanceEvent(event('e1', 'asset_created', '2026-01-01T00:00:00.000Z', 'a1'));
    expect(result.valid).toBe(true);
  });

  it('detects out-of-order events within a session', () => {
    const events = [
      event('e1', 'session_started', '2026-01-01T00:05:00.000Z'),
      event('e2', 'session_started', '2026-01-01T00:00:00.000Z'),
    ];
    const result = validateEventOrdering(events);
    expect(result.valid).toBe(false);
  });

  it('passes non-decreasing event ordering', () => {
    const events = [
      event('e1', 'session_started', '2026-01-01T00:00:00.000Z'),
      event('e2', 'session_started', '2026-01-01T00:05:00.000Z'),
    ];
    expect(validateEventOrdering(events).valid).toBe(true);
  });
});
