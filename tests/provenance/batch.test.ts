import { describe, expect, it } from 'vitest';
import { asBatchId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createBatchFromEvents, validateBatchChain } from '../../src/provenance/batch.js';

function makeEvent(eventId: string, occurredAt: string) {
  return createProvenanceEvent({
    eventId: asEventId(eventId),
    projectId: asProjectId('p1'),
    sessionId: asSessionId('s1'),
    actorProfileId: asProfileId('actor1'),
    deviceId: asDeviceId('d1'),
    source: 'studio_simulator',
    eventType: 'project_saved',
    occurredAt,
  });
}

describe('provenance batches', () => {
  it('derives eventCount and the occurredAt range from its events', () => {
    const batch = createBatchFromEvents({
      id: asBatchId('b1'),
      profileId: asProfileId('p1'),
      deviceId: asDeviceId('d1'),
      sessionId: asSessionId('s1'),
      events: [makeEvent('e1', '2026-01-01T00:00:00.000Z'), makeEvent('e2', '2026-01-01T00:05:00.000Z')],
      createdAt: '2026-01-01T00:10:00.000Z',
    });
    expect(batch.eventCount).toBe(2);
    expect(batch.firstEventAt).toBe('2026-01-01T00:00:00.000Z');
    expect(batch.lastEventAt).toBe('2026-01-01T00:05:00.000Z');
    expect(batch.validationStatus).toBe('pending');
  });

  it('rejects an empty batch', () => {
    expect(() =>
      createBatchFromEvents({
        id: asBatchId('b1'),
        profileId: asProfileId('p1'),
        deviceId: asDeviceId('d1'),
        sessionId: asSessionId('s1'),
        events: [],
        createdAt: '2026-01-01T00:10:00.000Z',
      }),
    ).toThrow();
  });

  it('validates a correctly linked batch chain', () => {
    const batch1 = createBatchFromEvents({
      id: asBatchId('b1'),
      profileId: asProfileId('p1'),
      deviceId: asDeviceId('d1'),
      sessionId: asSessionId('s1'),
      events: [makeEvent('e1', '2026-01-01T00:00:00.000Z')],
      createdAt: '2026-01-01T00:10:00.000Z',
    });
    const batch2 = createBatchFromEvents({
      id: asBatchId('b2'),
      profileId: asProfileId('p1'),
      deviceId: asDeviceId('d1'),
      sessionId: asSessionId('s1'),
      previousBatchHash: batch1.manifestHash,
      events: [makeEvent('e2', '2026-01-02T00:00:00.000Z')],
      createdAt: '2026-01-02T00:10:00.000Z',
    });
    expect(validateBatchChain([batch1, batch2]).valid).toBe(true);
  });

  it('detects a batch chain broken by a missing or wrong previousBatchHash', () => {
    const batch1 = createBatchFromEvents({
      id: asBatchId('b1'),
      profileId: asProfileId('p1'),
      deviceId: asDeviceId('d1'),
      sessionId: asSessionId('s1'),
      events: [makeEvent('e1', '2026-01-01T00:00:00.000Z')],
      createdAt: '2026-01-01T00:10:00.000Z',
    });
    const batch2 = createBatchFromEvents({
      id: asBatchId('b2'),
      profileId: asProfileId('p1'),
      deviceId: asDeviceId('d1'),
      sessionId: asSessionId('s1'),
      previousBatchHash: 'f'.repeat(64),
      events: [makeEvent('e2', '2026-01-02T00:00:00.000Z')],
      createdAt: '2026-01-02T00:10:00.000Z',
    });
    expect(validateBatchChain([batch1, batch2]).valid).toBe(false);
  });
});
