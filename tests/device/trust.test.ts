import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asDeviceId, asProfileId, asSessionId } from '../../src/domain/ids.js';
import { createProvenanceBatch, type ProvenanceBatch } from '../../src/domain/provenanceBatch.js';
import { revokeStudioDevice } from '../../src/domain/studioDevice.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch, verifySignedBatch } from '../../src/device/batchSigning.js';
import { evaluateBatchTrust } from '../../src/device/trust.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-trust-test-'));
  tempDirs.push(dir);
  const store = new FileDeviceKeyStore(dir);
  const deviceId = asDeviceId('device-1');
  const { device, identity } = createDeviceIdentity(store, {
    profileId: asProfileId('profile-1'),
    platform: 'macos',
    appVersion: '1.0.0',
    deviceId,
    verifiedAt: '2025-12-01T00:00:00.000Z',
  });
  const batch: ProvenanceBatch = createProvenanceBatch({
    id: asBatchId('batch-1'),
    profileId: asProfileId('profile-1'),
    deviceId,
    sessionId: asSessionId('session-1'),
    eventCount: 2,
    firstEventAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: '2026-01-01T00:10:00.000Z',
    manifestHash: 'a'.repeat(64),
    createdAt: '2026-01-01T00:15:00.000Z',
  });
  const signed = signProvenanceBatch(batch, identity);
  return { device, identity, signed };
}

describe('evaluateBatchTrust', () => {
  it('an active device with a validly signed batch is both cryptographically valid and currently trusted', () => {
    const { device, identity, signed } = setup();
    const evaluation = evaluateBatchTrust(signed, identity.publicKeySpkiDer, device);
    expect(evaluation.signature).toEqual({ valid: true });
    expect(evaluation.deviceCurrentlyTrusted).toBe(true);
  });

  it('an active device with a tampered (invalidly signed) batch is rejected on the signature axis, independent of device trust', () => {
    const { device, identity, signed } = setup();
    const tampered: ProvenanceBatch = { ...signed, eventCount: signed.eventCount + 1 };
    const evaluation = evaluateBatchTrust(tampered, identity.publicKeySpkiDer, device);
    expect(evaluation.signature.valid).toBe(false);
    expect(evaluation.deviceCurrentlyTrusted).toBe(true);
  });

  it('a revoked device is no longer currently trusted, per the documented forward-looking policy, even though its past signature remains valid', () => {
    const { device, identity, signed } = setup();
    const revokedDevice = revokeStudioDevice(device, '2026-02-01T00:00:00.000Z');
    const evaluation = evaluateBatchTrust(signed, identity.publicKeySpkiDer, revokedDevice);
    expect(evaluation.signature).toEqual({ valid: true });
    expect(evaluation.deviceCurrentlyTrusted).toBe(false);
  });

  it('revocation never retroactively rewrites cryptographic history: the same signed batch verifies identically before and after revocation', () => {
    const { device, identity, signed } = setup();
    const before = verifySignedBatch(signed, identity.publicKeySpkiDer);
    revokeStudioDevice(device, '2026-02-01T00:00:00.000Z');
    const after = verifySignedBatch(signed, identity.publicKeySpkiDer);
    expect(after).toEqual(before);
    expect(after.valid).toBe(true);
  });

  it('signature validity and current device trust are distinct axes: a revoked device can still have produced a valid signature, and a valid signature does not imply a currently trusted device', () => {
    const { device, identity, signed } = setup();
    const revokedDevice = revokeStudioDevice(device, '2026-02-01T00:00:00.000Z');
    const evaluation = evaluateBatchTrust(signed, identity.publicKeySpkiDer, revokedDevice);
    // Both true-signature/false-trust and false-signature/true-trust are
    // observed across this suite — neither axis can be inferred from the other.
    expect(evaluation.signature.valid).toBe(true);
    expect(evaluation.deviceCurrentlyTrusted).toBe(false);
  });
});
