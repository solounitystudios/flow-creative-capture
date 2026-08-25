import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asCheckpointId, asDeviceId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createProvenanceCheckpoint, type ProvenanceCheckpoint } from '../../src/domain/provenanceCheckpoint.js';
import { createDeviceIdentity, type DeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import {
  buildCheckpointSigningPayload,
  signProvenanceCheckpoint,
  verifySignedCheckpoint,
} from '../../src/device/checkpointSigning.js';

const tempDirs: string[] = [];

function makeKeyStore(): FileDeviceKeyStore {
  const dir = mkdtempSync(join(tmpdir(), 'flow-checkpointsigning-test-'));
  tempDirs.push(dir);
  return new FileDeviceKeyStore(dir);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeIdentity(deviceId = asDeviceId('device-1')): DeviceIdentity {
  const store = makeKeyStore();
  const { identity } = createDeviceIdentity(store, {
    profileId: asProfileId('profile-1'),
    platform: 'macos',
    appVersion: '1.0.0',
    deviceId,
  });
  return identity;
}

function makeCheckpoint(deviceId = asDeviceId('device-1')): ProvenanceCheckpoint {
  return createProvenanceCheckpoint({
    id: asCheckpointId('checkpoint-1'),
    projectId: asProjectId('project-1'),
    sessionId: asSessionId('session-1'),
    actorProfileId: asProfileId('profile-1'),
    deviceId,
    sequence: 1,
    previousCheckpointHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    checkpointHash: 'd'.repeat(64),
    triggerType: 'manual',
    createdAt: '2026-01-01T01:05:00.000Z',
  });
}

describe('signProvenanceCheckpoint', () => {
  it('signs a valid checkpoint, producing a base64 signature that decodes to 64 bytes (Ed25519)', () => {
    const identity = makeIdentity();
    const signed = signProvenanceCheckpoint(makeCheckpoint(), identity);
    expect(signed.signature).toBeDefined();
    expect(Buffer.from(signed.signature as string, 'base64')).toHaveLength(64);
  });

  it('does not mutate the input checkpoint', () => {
    const identity = makeIdentity();
    const checkpoint = makeCheckpoint();
    signProvenanceCheckpoint(checkpoint, identity);
    expect(checkpoint.signature).toBeUndefined();
  });

  it('verifies successfully immediately after signing', () => {
    const identity = makeIdentity();
    const signed = signProvenanceCheckpoint(makeCheckpoint(), identity);
    expect(verifySignedCheckpoint(signed, identity.publicKeySpkiDer)).toEqual({ valid: true });
  });

  it('refuses to sign a checkpoint whose deviceId does not match the signing identity', () => {
    const identity = makeIdentity(asDeviceId('device-1'));
    const checkpoint = makeCheckpoint(asDeviceId('device-2'));
    expect(() => signProvenanceCheckpoint(checkpoint, identity)).toThrow();
  });

  it('is deterministic: signing the same canonical payload with the same key twice produces the same signature (Ed25519, not randomized like ECDSA)', () => {
    const identity = makeIdentity();
    const checkpoint = makeCheckpoint();
    const signedOnce = signProvenanceCheckpoint(checkpoint, identity);
    const signedTwice = signProvenanceCheckpoint(checkpoint, identity);
    expect(signedTwice.signature).toBe(signedOnce.signature);
  });

  it("verification fails against a different device's public key", () => {
    const deviceId = asDeviceId('device-shared-id');
    const identityA = makeIdentity(deviceId);
    const identityB = makeIdentity(deviceId);
    const signed = signProvenanceCheckpoint(makeCheckpoint(deviceId), identityA);
    expect(verifySignedCheckpoint(signed, identityB.publicKeySpkiDer).valid).toBe(false);
  });
});

describe('verifySignedCheckpoint — tamper detection over every signed field', () => {
  // One mutator per field in CheckpointSigningPayload
  // (src/device/checkpointSigning.ts). If a new field is ever added to the
  // payload, add its mutation here too — the coverage test below fails
  // loudly if a bound field is left untested.
  const mutations: ReadonlyArray<{ payloadField: string; mutate: (checkpoint: ProvenanceCheckpoint) => ProvenanceCheckpoint }> = [
    { payloadField: 'checkpointId', mutate: (c) => ({ ...c, id: asCheckpointId('tampered-checkpoint-id') }) },
    { payloadField: 'projectId', mutate: (c) => ({ ...c, projectId: asProjectId('a-different-project') }) },
    { payloadField: 'sessionId', mutate: (c) => ({ ...c, sessionId: asSessionId('a-different-session') }) },
    { payloadField: 'actorProfileId', mutate: (c) => ({ ...c, actorProfileId: asProfileId('someone-elses-profile') }) },
    { payloadField: 'deviceId', mutate: (c) => ({ ...c, deviceId: asDeviceId('someone-elses-device') }) },
    { payloadField: 'sequence', mutate: (c) => ({ ...c, sequence: c.sequence + 1 }) },
    { payloadField: 'previousCheckpointHash', mutate: (c) => ({ ...c, previousCheckpointHash: 'e'.repeat(64) }) },
    { payloadField: 'manifestHash', mutate: (c) => ({ ...c, manifestHash: 'f'.repeat(64) }) },
    { payloadField: 'checkpointHash', mutate: (c) => ({ ...c, checkpointHash: '1'.repeat(64) }) },
    { payloadField: 'triggerType', mutate: (c) => ({ ...c, triggerType: 'session_end' }) },
    { payloadField: 'createdAt', mutate: (c) => ({ ...c, createdAt: '1999-12-31T23:59:59.000Z' }) },
  ];

  it.each(mutations)('detects tampering with $payloadField after signing', ({ mutate }) => {
    const identity = makeIdentity();
    const signed = signProvenanceCheckpoint(makeCheckpoint(), identity);
    const tampered = mutate(signed);
    const result = verifySignedCheckpoint(tampered, identity.publicKeySpkiDer);
    expect(result.valid).toBe(false);
  });

  it('the mutation table above covers every field the signature actually binds — no field is silently left untested', () => {
    const identity = makeIdentity();
    const signed = signProvenanceCheckpoint(makeCheckpoint(), identity);
    const payloadKeys = Object.keys(buildCheckpointSigningPayload(signed)).sort();
    const testedFields = mutations.map((m) => m.payloadField).sort();
    expect(testedFields).toEqual(payloadKeys);
  });
});

describe('verifySignedCheckpoint — signature corruption and missing-signature handling', () => {
  it('reports missing_signature when the checkpoint has no signature at all', () => {
    const checkpoint = makeCheckpoint();
    const identity = makeIdentity();
    expect(verifySignedCheckpoint(checkpoint, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'missing_signature',
    });
  });

  it('reports missing_signature for a blank/whitespace-only signature', () => {
    const identity = makeIdentity();
    const checkpoint: ProvenanceCheckpoint = { ...makeCheckpoint(), signature: '   ' };
    expect(verifySignedCheckpoint(checkpoint, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'missing_signature',
    });
  });

  it('reports malformed_signature for a truncated signature', () => {
    const identity = makeIdentity();
    const signed = signProvenanceCheckpoint(makeCheckpoint(), identity);
    const truncated: ProvenanceCheckpoint = { ...signed, signature: (signed.signature as string).slice(0, 20) };
    expect(verifySignedCheckpoint(truncated, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'malformed_signature',
    });
  });

  it('reports malformed_signature for a signature that does not decode to 64 bytes', () => {
    const identity = makeIdentity();
    const checkpoint: ProvenanceCheckpoint = { ...makeCheckpoint(), signature: 'AAAA' };
    expect(verifySignedCheckpoint(checkpoint, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'malformed_signature',
    });
  });

  it('does not throw on a garbage, non-base64-ish signature string — it fails safe', () => {
    const identity = makeIdentity();
    const checkpoint: ProvenanceCheckpoint = { ...makeCheckpoint(), signature: 'not!!valid$$base64%%data' };
    expect(() => verifySignedCheckpoint(checkpoint, identity.publicKeySpkiDer)).not.toThrow();
  });

  it('reports signature_mismatch for a well-formed but random 64-byte signature', () => {
    const identity = makeIdentity();
    const checkpoint: ProvenanceCheckpoint = { ...makeCheckpoint(), signature: randomBytes(64).toString('base64') };
    expect(verifySignedCheckpoint(checkpoint, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'signature_mismatch',
    });
  });

  it("reports signature_mismatch for a signature genuinely produced by a different device's key", () => {
    const deviceId = asDeviceId('device-shared-id-2');
    const identityA = makeIdentity(deviceId);
    const identityB = makeIdentity(deviceId);
    const signedByB = signProvenanceCheckpoint(makeCheckpoint(deviceId), identityB);
    expect(verifySignedCheckpoint(signedByB, identityA.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'signature_mismatch',
    });
  });
});
