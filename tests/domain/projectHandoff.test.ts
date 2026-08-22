import { describe, expect, it } from 'vitest';
import { asCheckpointId, asHandoffId, asProfileId, asProjectId } from '../../src/domain/ids.js';
import { acceptProjectHandoff, createProjectHandoff } from '../../src/domain/projectHandoff.js';
import { hashCanonicalValue } from '../../src/crypto/sha256.js';

function baseInput() {
  return {
    id: asHandoffId('h1'),
    projectId: asProjectId('p1'),
    senderProfileId: asProfileId('nightwire'),
    recipientProfileId: asProfileId('marcus'),
    checkpointId: asCheckpointId('c1'),
    manifestHash: hashCanonicalValue({ x: 1 }),
    sentAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('project handoff', () => {
  it('starts pending and moves to accepted', () => {
    const handoff = createProjectHandoff(baseInput());
    expect(handoff.status).toBe('pending');
    const accepted = acceptProjectHandoff(handoff, '2026-01-01T01:00:00.000Z');
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedAt).toBe('2026-01-01T01:00:00.000Z');
  });

  it('rejects a sender and recipient that are the same profile', () => {
    expect(() =>
      createProjectHandoff({ ...baseInput(), recipientProfileId: asProfileId('nightwire') }),
    ).toThrow();
  });

  it('cannot be accepted twice', () => {
    const handoff = acceptProjectHandoff(createProjectHandoff(baseInput()), '2026-01-01T01:00:00.000Z');
    expect(() => acceptProjectHandoff(handoff, '2026-01-01T02:00:00.000Z')).toThrow();
  });

  it('rejects acceptedAt earlier than sentAt', () => {
    const handoff = createProjectHandoff(baseInput());
    expect(() => acceptProjectHandoff(handoff, '2025-12-31T00:00:00.000Z')).toThrow();
  });
});
