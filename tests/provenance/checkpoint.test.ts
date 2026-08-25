import { describe, expect, it } from 'vitest';
import { asCheckpointId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createCheckpointFromManifest, validateCheckpointChain } from '../../src/provenance/checkpoint.js';

function chainOfTwo() {
  const projectId = asProjectId('p1');
  const sessionId = asSessionId('s1');
  const actorProfileId = asProfileId('actor1');
  const deviceId = asDeviceId('device1');

  const checkpoint0 = createCheckpointFromManifest({
    id: asCheckpointId('c0'),
    projectId,
    sessionId,
    actorProfileId,
    deviceId,
    sequence: 0,
    manifest: { projectId, assets: [], eventIds: [asEventId('e1')] },
    triggerType: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const checkpoint1 = createCheckpointFromManifest({
    id: asCheckpointId('c1'),
    projectId,
    sessionId,
    actorProfileId,
    deviceId,
    sequence: 1,
    previousCheckpointHash: checkpoint0.checkpointHash,
    manifest: { projectId, assets: [], eventIds: [asEventId('e2')] },
    triggerType: 'manual',
    createdAt: '2026-01-01T01:00:00.000Z',
  });

  return [checkpoint0, checkpoint1] as const;
}

describe('checkpoint chain', () => {
  it('validates a correctly linked chain', () => {
    const chain = chainOfTwo();
    const result = validateCheckpointChain(chain);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('is deterministic: the same manifest input always produces the same checkpointHash', () => {
    const [c0] = chainOfTwo();
    const [c0Again] = chainOfTwo();
    expect(c0.manifestHash).toBe(c0Again.manifestHash);
    expect(c0.checkpointHash).toBe(c0Again.checkpointHash);
  });

  it('detects a broken chain when previousCheckpointHash does not match', () => {
    const [checkpoint0, checkpoint1] = chainOfTwo();
    const tamperedSecond = { ...checkpoint1, previousCheckpointHash: 'f'.repeat(64) };
    const result = validateCheckpointChain([checkpoint0, tamperedSecond]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('previousCheckpointHash'))).toBe(true);
  });

  it('detects tampering when a stored field is altered without recomputing checkpointHash', () => {
    const [checkpoint0, checkpoint1] = chainOfTwo();
    // Attacker swaps in a different manifestHash but leaves checkpointHash untouched.
    const tampered = { ...checkpoint1, manifestHash: 'a'.repeat(64) };
    const result = validateCheckpointChain([checkpoint0, tampered]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('tampering detected'))).toBe(true);
  });

  it('rejects out-of-order sequence numbers', () => {
    const [checkpoint0, checkpoint1] = chainOfTwo();
    const result = validateCheckpointChain([checkpoint1, checkpoint0]);
    expect(result.valid).toBe(false);
  });
});
