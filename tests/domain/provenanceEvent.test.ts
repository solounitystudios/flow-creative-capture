import { describe, expect, it } from 'vitest';
import { asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';

function baseInput() {
  return {
    eventId: asEventId('e1'),
    projectId: asProjectId('p1'),
    sessionId: asSessionId('s1'),
    actorProfileId: asProfileId('actor1'),
    deviceId: asDeviceId('d1'),
    source: 'studio_simulator' as const,
    eventType: 'session_started' as const,
    occurredAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('createProvenanceEvent', () => {
  it('constructs a valid event', () => {
    const event = createProvenanceEvent(baseInput());
    expect(event.eventId).toBe('e1');
    expect(event.payload).toEqual({});
  });

  it('rejects an unrecognized source', () => {
    expect(() =>
      createProvenanceEvent({ ...baseInput(), source: 'garageband' as unknown as 'studio_simulator' }),
    ).toThrow();
  });

  it('rejects an unrecognized event type', () => {
    expect(() =>
      createProvenanceEvent({ ...baseInput(), eventType: 'button_clicked' as unknown as 'session_started' }),
    ).toThrow();
  });

  it('rejects receivedAt earlier than occurredAt — no pretending a delayed upload was live', () => {
    expect(() =>
      createProvenanceEvent({
        ...baseInput(),
        occurredAt: '2026-01-02T00:00:00.000Z',
        receivedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts receivedAt at or after occurredAt', () => {
    const event = createProvenanceEvent({
      ...baseInput(),
      receivedAt: '2026-01-01T00:05:00.000Z',
    });
    expect(event.receivedAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('freezes the payload', () => {
    const event = createProvenanceEvent({ ...baseInput(), payload: { foo: 'bar' } });
    expect(() => {
      (event.payload as Record<string, unknown>).foo = 'baz';
    }).toThrow();
  });
});
