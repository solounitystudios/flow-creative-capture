import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asDeviceId, asProfileId, asSessionId } from '../../src/domain/ids.js';
import { createProvenanceBatch, type ProvenanceBatch } from '../../src/domain/provenanceBatch.js';
import { createDeviceIdentity, type DeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { buildBatchSigningPayload, signProvenanceBatch, verifySignedBatch } from '../../src/device/batchSigning.js';

const tempDirs: string[] = [];

function makeKeyStore(): FileDeviceKeyStore {
  const dir = mkdtempSync(join(tmpdir(), 'flow-batchsigning-test-'));
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

function makeBatch(deviceId = asDeviceId('device-1')): ProvenanceBatch {
  return createProvenanceBatch({
    id: asBatchId('batch-1'),
    profileId: asProfileId('profile-1'),
    deviceId,
    sessionId: asSessionId('session-1'),
    eventCount: 3,
    firstEventAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: '2026-01-01T01:00:00.000Z',
    previousBatchHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    createdAt: '2026-01-01T01:05:00.000Z',
  });
}

describe('signProvenanceBatch', () => {
  it('signs a valid batch, producing a base64 signature that decodes to 64 bytes (Ed25519)', () => {
    const identity = makeIdentity();
    const signed = signProvenanceBatch(makeBatch(), identity);
    expect(signed.signature).toBeDefined();
    expect(Buffer.from(signed.signature as string, 'base64')).toHaveLength(64);
  });

  it('does not mutate the input batch', () => {
    const identity = makeIdentity();
    const batch = makeBatch();
    signProvenanceBatch(batch, identity);
    expect(batch.signature).toBeUndefined();
  });

  it('verifies successfully immediately after signing', () => {
    const identity = makeIdentity();
    const signed = signProvenanceBatch(makeBatch(), identity);
    expect(verifySignedBatch(signed, identity.publicKeySpkiDer)).toEqual({ valid: true });
  });

  it('refuses to sign a batch whose deviceId does not match the signing identity', () => {
    const identity = makeIdentity(asDeviceId('device-1'));
    const batch = makeBatch(asDeviceId('device-2'));
    expect(() => signProvenanceBatch(batch, identity)).toThrow();
  });

  it('is deterministic: signing the same canonical payload with the same key twice produces the same signature (Ed25519, not randomized like ECDSA)', () => {
    const identity = makeIdentity();
    const batch = makeBatch();
    const signedOnce = signProvenanceBatch(batch, identity);
    const signedTwice = signProvenanceBatch(batch, identity);
    expect(signedTwice.signature).toBe(signedOnce.signature);
  });

  it('verification fails against a different device\'s public key', () => {
    const deviceId = asDeviceId('device-shared-id');
    const identityA = makeIdentity(deviceId);
    const identityB = makeIdentity(deviceId);
    const signed = signProvenanceBatch(makeBatch(deviceId), identityA);
    expect(verifySignedBatch(signed, identityB.publicKeySpkiDer).valid).toBe(false);
  });
});

describe('verifySignedBatch — tamper detection over every signed field', () => {
  // One mutator per field in BatchSigningPayload (src/device/batchSigning.ts).
  // If a new field is ever added to the payload, add its mutation here too —
  // the coverage test below fails loudly if a bound field is left untested.
  const mutations: ReadonlyArray<{ payloadField: string; mutate: (batch: ProvenanceBatch) => ProvenanceBatch }> = [
    { payloadField: 'batchId', mutate: (b) => ({ ...b, id: asBatchId('tampered-batch-id') }) },
    { payloadField: 'profileId', mutate: (b) => ({ ...b, profileId: asProfileId('someone-elses-profile') }) },
    { payloadField: 'deviceId', mutate: (b) => ({ ...b, deviceId: asDeviceId('someone-elses-device') }) },
    { payloadField: 'sessionId', mutate: (b) => ({ ...b, sessionId: asSessionId('a-different-session') }) },
    { payloadField: 'eventCount', mutate: (b) => ({ ...b, eventCount: b.eventCount + 1 }) },
    { payloadField: 'firstEventAt', mutate: (b) => ({ ...b, firstEventAt: '2020-01-01T00:00:00.000Z' }) },
    { payloadField: 'lastEventAt', mutate: (b) => ({ ...b, lastEventAt: '2030-01-01T00:00:00.000Z' }) },
    { payloadField: 'previousBatchHash', mutate: (b) => ({ ...b, previousBatchHash: 'd'.repeat(64) }) },
    { payloadField: 'manifestHash', mutate: (b) => ({ ...b, manifestHash: 'e'.repeat(64) }) },
    { payloadField: 'createdAt', mutate: (b) => ({ ...b, createdAt: '1999-12-31T23:59:59.000Z' }) },
  ];

  it.each(mutations)('detects tampering with $payloadField after signing', ({ mutate }) => {
    const identity = makeIdentity();
    const signed = signProvenanceBatch(makeBatch(), identity);
    const tampered = mutate(signed);
    const result = verifySignedBatch(tampered, identity.publicKeySpkiDer);
    expect(result.valid).toBe(false);
  });

  it('the mutation table above covers every field the signature actually binds — no field is silently left untested', () => {
    const identity = makeIdentity();
    const signed = signProvenanceBatch(makeBatch(), identity);
    const payloadKeys = Object.keys(buildBatchSigningPayload(signed)).sort();
    const testedFields = mutations.map((m) => m.payloadField).sort();
    expect(testedFields).toEqual(payloadKeys);
  });

  it('does NOT flag a change to validationStatus as tampering — it is deliberately outside the signed payload', () => {
    const identity = makeIdentity();
    const signed = signProvenanceBatch(makeBatch(), identity);
    const revalidated: ProvenanceBatch = { ...signed, validationStatus: 'valid' };
    expect(verifySignedBatch(revalidated, identity.publicKeySpkiDer)).toEqual({ valid: true });
  });
});

describe('verifySignedBatch — signature corruption and missing-signature handling', () => {
  it('reports missing_signature when the batch has no signature at all', () => {
    const batch = makeBatch();
    const identity = makeIdentity();
    expect(verifySignedBatch(batch, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'missing_signature',
    });
  });

  it('reports missing_signature for a blank/whitespace-only signature', () => {
    const identity = makeIdentity();
    const batch: ProvenanceBatch = { ...makeBatch(), signature: '   ' };
    expect(verifySignedBatch(batch, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'missing_signature',
    });
  });

  it('reports malformed_signature for a truncated signature', () => {
    const identity = makeIdentity();
    const signed = signProvenanceBatch(makeBatch(), identity);
    const truncated: ProvenanceBatch = { ...signed, signature: (signed.signature as string).slice(0, 20) };
    expect(verifySignedBatch(truncated, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'malformed_signature',
    });
  });

  it('reports malformed_signature for a signature that does not decode to 64 bytes', () => {
    const identity = makeIdentity();
    const batch: ProvenanceBatch = { ...makeBatch(), signature: 'AAAA' };
    expect(verifySignedBatch(batch, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'malformed_signature',
    });
  });

  it('does not throw on a garbage, non-base64-ish signature string — it fails safe', () => {
    const identity = makeIdentity();
    const batch: ProvenanceBatch = { ...makeBatch(), signature: 'not!!valid$$base64%%data' };
    expect(() => verifySignedBatch(batch, identity.publicKeySpkiDer)).not.toThrow();
  });

  it('reports signature_mismatch for a well-formed but random 64-byte signature', () => {
    const identity = makeIdentity();
    const batch: ProvenanceBatch = { ...makeBatch(), signature: randomBytes(64).toString('base64') };
    expect(verifySignedBatch(batch, identity.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'signature_mismatch',
    });
  });

  it('reports signature_mismatch for a signature genuinely produced by a different device\'s key', () => {
    const deviceId = asDeviceId('device-shared-id-2');
    const identityA = makeIdentity(deviceId);
    const identityB = makeIdentity(deviceId);
    const signedByB = signProvenanceBatch(makeBatch(deviceId), identityB);
    expect(verifySignedBatch(signedByB, identityA.publicKeySpkiDer)).toEqual({
      valid: false,
      reason: 'signature_mismatch',
    });
  });
});
