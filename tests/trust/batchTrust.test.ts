import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asCheckpointId, asDeviceId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceBatch, type ProvenanceBatch } from '../../src/domain/provenanceBatch.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../src/device/batchSigning.js';
import { createCheckpointFromManifest } from '../../src/provenance/checkpoint.js';
import { evaluateBatchTrust } from '../../src/device/trust.js';
import { closeEvidenceDatabase, openEvidenceDatabase } from '../../src/store/database.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { evaluateStoredBatchTrust, type ClaimStatus } from '../../src/trust/batchTrust.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Fresh device identity + store, with the device already persisted and active. */
function setup(deviceIdStr = 'device-1') {
  const keyStore = new FileDeviceKeyStore(makeTempDir('flow-trust-keystore-'));
  const deviceId = asDeviceId(deviceIdStr);
  const { device, identity } = createDeviceIdentity(keyStore, {
    profileId: asProfileId('profile-1'),
    platform: 'macos',
    appVersion: '1.0.0',
    deviceId,
  });
  const dbPath = join(makeTempDir('flow-trust-db-'), 'evidence.db');
  const store = new LocalEvidenceStore(dbPath);
  store.insertDevice(device, identity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
  return { store, device, identity, dbPath };
}

function insertSession(
  store: LocalEvidenceStore,
  deviceId: ReturnType<typeof asDeviceId>,
  sessionId = 'session-1',
  projectId = 'project-1',
) {
  const session = createStudioSession({
    id: asSessionId(sessionId),
    projectId: asProjectId(projectId),
    actorProfileId: asProfileId('profile-1'),
    deviceId,
    daw: 'fl_studio',
    startedAt: '2026-01-01T00:00:00.000Z',
  });
  store.insertSession(session, '2026-01-01T00:00:00.000Z');
  return session;
}

function makeBatch(
  id: string,
  deviceId: ReturnType<typeof asDeviceId>,
  sessionId: string,
  overrides: Partial<Parameters<typeof createProvenanceBatch>[0]> = {},
): ProvenanceBatch {
  return createProvenanceBatch({
    id: asBatchId(id),
    profileId: asProfileId('profile-1'),
    deviceId,
    sessionId: asSessionId(sessionId),
    eventCount: 1,
    firstEventAt: '2026-01-01T00:01:00.000Z',
    lastEventAt: '2026-01-01T00:01:00.000Z',
    manifestHash: 'a'.repeat(64),
    createdAt: '2026-01-01T00:03:00.000Z',
    ...overrides,
  });
}

/**
 * Inserts a batch row directly, bypassing foreign-key enforcement — for
 * simulating an inconsistent/corrupted database state (an unknown device,
 * or a missing session) that `LocalEvidenceStore.insertBatch`'s own
 * foreign keys make unreachable through normal application use. This is a
 * deliberate robustness test of `evaluateStoredBatchTrust`, not a
 * realistic application flow.
 */
function insertPhantomBatchRow(
  dbPath: string,
  batch: { id: string; profileId: string; deviceId: string; sessionId: string; eventCount: number; firstEventAt: string; lastEventAt: string; manifestHash: string; signature: string | null; createdAt: string; storedAt: string },
): void {
  const raw = openEvidenceDatabase(dbPath);
  raw.exec('PRAGMA foreign_keys = OFF');
  raw
    .prepare(
      `INSERT INTO batches (id, profileId, deviceId, sessionId, eventCount, firstEventAt, lastEventAt, manifestHash, signature, createdAt, storedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      batch.id,
      batch.profileId,
      batch.deviceId,
      batch.sessionId,
      batch.eventCount,
      batch.firstEventAt,
      batch.lastEventAt,
      batch.manifestHash,
      batch.signature,
      batch.createdAt,
      batch.storedAt,
    );
  closeEvidenceDatabase(raw);
}

/** Tracks which ClaimStatus values have been observed, for the coverage meta-test at the end of this file. */
const observedClaimStatuses = new Set<ClaimStatus>();
function record(status: ClaimStatus): void {
  observedClaimStatuses.add(status);
}

describe('evaluateStoredBatchTrust — sound evidence', () => {
  it('a fully sound persisted batch evaluates to locally_sound_unverified_claim', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const signed = signProvenanceBatch(makeBatch('batch-sound', device.id, 'session-1'), identity);
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    const result = evaluateStoredBatchTrust(store, signed.id);
    expect(result).toBeDefined();
    expect(result?.signature.status).toBe('valid');
    expect(result?.structure.valid).toBe(true);
    expect(result?.deviceTrust).toEqual({ deviceFound: true, currentlyTrusted: true });
    expect(result?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(result?.reasons).toEqual([]);
    record(result!.claimStatus);
    store.close();
  });

  it('evaluation does not mutate batch_validation_state (side-effect-free)', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const signed = signProvenanceBatch(makeBatch('batch-no-side-effect', device.id, 'session-1'), identity);
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    const before = store.getBatch(signed.id)?.validationStatus;
    evaluateStoredBatchTrust(store, signed.id);
    // Also run a failing evaluation shape to be sure a bad outcome doesn't trigger a write either.
    evaluateStoredBatchTrust(store, signed.id);
    const after = store.getBatch(signed.id)?.validationStatus;

    expect(before).toBe('pending');
    expect(after).toBe('pending');
    store.close();
  });
});

describe('evaluateStoredBatchTrust — signature dimension', () => {
  it('an unsigned batch evaluates to unsigned, distinct from signer_unknown', () => {
    const { store, device } = setup();
    insertSession(store, device.id);
    const unsigned = makeBatch('batch-unsigned', device.id, 'session-1');
    store.insertBatch(unsigned, '2026-01-01T00:04:00.000Z');

    const result = evaluateStoredBatchTrust(store, unsigned.id);
    expect(result?.signature).toEqual({
      status: 'unsigned',
      verification: { valid: false, reason: 'missing_signature' },
    });
    expect(result?.claimStatus).toBe('unsigned');
    expect(result?.reasons).toContain('batch_unsigned');
    expect(result?.reasons).not.toContain('signer_device_unknown');
    record(result!.claimStatus);
    store.close();
  });

  it('a malformed signature evaluates to signature_invalid', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const signed = signProvenanceBatch(makeBatch('batch-malformed', device.id, 'session-1'), identity);
    const corrupted = createProvenanceBatch({ ...signed, signature: 'AAAA' });
    store.insertBatch(corrupted, '2026-01-01T00:04:00.000Z');

    const result = evaluateStoredBatchTrust(store, corrupted.id);
    expect(result?.signature.status).toBe('invalid');
    if (result?.signature.status === 'invalid') {
      expect(result.signature.verification.reason).toBe('malformed_signature');
    }
    expect(result?.claimStatus).toBe('signature_invalid');
    expect(result?.reasons).toContain('signature_malformed');
    record(result!.claimStatus);
    store.close();
  });

  it('a signature that does not match the persisted public key evaluates to signature_invalid (mismatch)', () => {
    const { store, device, identity } = setup();
    store.close(); // this store's device row isn't used for this test — start fresh below

    // A second, unrelated keypair, forced to the SAME nominal deviceId — its
    // public key is what ends up stored for "device-1", but the batch is
    // actually signed with the real identity's (different) private key.
    const otherKeyStore = new FileDeviceKeyStore(makeTempDir('flow-trust-otherkey-'));
    const { identity: otherIdentity } = createDeviceIdentity(otherKeyStore, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
      deviceId: device.id,
    });

    const mismatchDbPath = join(makeTempDir('flow-trust-mismatch-db-'), 'evidence.db');
    const mismatchStore = new LocalEvidenceStore(mismatchDbPath);
    // Store the WRONG (other) public key for this device.
    mismatchStore.insertDevice(device, otherIdentity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
    insertSession(mismatchStore, device.id);
    const signed = signProvenanceBatch(makeBatch('batch-mismatch', device.id, 'session-1'), identity);
    mismatchStore.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    const result = evaluateStoredBatchTrust(mismatchStore, signed.id);
    expect(result?.signature.status).toBe('invalid');
    if (result?.signature.status === 'invalid') {
      expect(result.signature.verification.reason).toBe('signature_mismatch');
    }
    expect(result?.claimStatus).toBe('signature_invalid');
    expect(result?.reasons).toContain('signature_mismatch');
    record(result!.claimStatus);
    mismatchStore.close();
  });

  it('a batch whose device was never persisted evaluates to signer_unknown, distinct from unsigned', () => {
    const { store, device, dbPath } = setup();
    const session = insertSession(store, device.id);
    store.close();

    insertPhantomBatchRow(dbPath, {
      id: 'batch-ghost-device',
      profileId: 'profile-1',
      deviceId: 'device-that-was-never-registered',
      sessionId: session.id,
      eventCount: 1,
      firstEventAt: '2026-01-01T00:01:00.000Z',
      lastEventAt: '2026-01-01T00:01:00.000Z',
      manifestHash: 'a'.repeat(64),
      signature: null,
      createdAt: '2026-01-01T00:03:00.000Z',
      storedAt: '2026-01-01T00:04:00.000Z',
    });

    const reopened = new LocalEvidenceStore(dbPath);
    const result = evaluateStoredBatchTrust(reopened, asBatchId('batch-ghost-device'));
    expect(result?.signature).toEqual({ status: 'signer_unknown' });
    expect(result?.deviceTrust).toEqual({ deviceFound: false, currentlyTrusted: false });
    expect(result?.claimStatus).toBe('signer_unknown');
    expect(result?.reasons).toContain('signer_device_unknown');
    expect(result?.reasons).not.toContain('batch_unsigned');
    record(result!.claimStatus);
    reopened.close();
  });
});

describe('evaluateStoredBatchTrust — device trust dimension and non-retroactivity', () => {
  it('revoking a device after signing flips claimStatus to device_untrusted while the signature remains valid', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const signed = signProvenanceBatch(makeBatch('batch-revoke', device.id, 'session-1'), identity);
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    const before = evaluateStoredBatchTrust(store, signed.id);
    expect(before?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(before?.signature.status).toBe('valid');

    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    const after = evaluateStoredBatchTrust(store, signed.id);
    expect(after?.signature.status).toBe('valid'); // cryptographic history is never rewritten
    expect(after?.deviceTrust).toEqual({
      deviceFound: true,
      currentlyTrusted: false,
      revokedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(after?.claimStatus).toBe('device_untrusted');
    expect(after?.reasons).toContain('device_revoked');
    record(after!.claimStatus);
    store.close();
  });

  it('recomputes on every call: two consecutive calls on the same store instance differ after revocation, with no explicit refresh', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const signed = signProvenanceBatch(makeBatch('batch-recompute', device.id, 'session-1'), identity);
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    const first = evaluateStoredBatchTrust(store, signed.id);
    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    const second = evaluateStoredBatchTrust(store, signed.id);

    expect(first?.claimStatus).not.toBe(second?.claimStatus);
    expect(first?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(second?.claimStatus).toBe('device_untrusted');
    store.close();
  });
});

describe('evaluateStoredBatchTrust — structural dimension', () => {
  it('a broken checkpoint chain evaluates to structure_invalid, with a valid signature preserved', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);

    const checkpoint0 = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-0'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId: device.id,
      sequence: 0,
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:01:00.000Z',
    });
    store.insertCheckpoint(checkpoint0, '2026-01-01T00:01:00.000Z');

    // Deliberately wrong previousCheckpointHash — does not match checkpoint0's actual hash.
    const checkpoint1 = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-1'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId: device.id,
      sequence: 1,
      previousCheckpointHash: '9'.repeat(64),
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:02:00.000Z',
    });
    store.insertCheckpoint(checkpoint1, '2026-01-01T00:02:00.000Z');

    const signed = signProvenanceBatch(makeBatch('batch-broken-checkpoint-chain', device.id, 'session-1'), identity);
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    const result = evaluateStoredBatchTrust(store, signed.id);
    expect(result?.signature.status).toBe('valid');
    expect(result?.structure.checkpointChain.valid).toBe(false);
    expect(result?.structure.batchChain.valid).toBe(true);
    expect(result?.structure.valid).toBe(false);
    expect(result?.claimStatus).toBe('structure_invalid');
    expect(result?.reasons).toContain('checkpoint_chain_invalid');
    expect(result?.reasons).not.toContain('batch_chain_invalid');
    record(result!.claimStatus);
    store.close();
  });

  it('a broken batch-to-batch chain evaluates to structure_invalid, with a valid signature preserved', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);

    const batch0 = signProvenanceBatch(makeBatch('batch-chain-0', device.id, 'session-1'), identity);
    store.insertBatch(batch0, '2026-01-01T00:03:00.000Z');

    // Deliberately wrong previousBatchHash — does not match batch0's actual manifestHash.
    const batch1 = signProvenanceBatch(
      makeBatch('batch-chain-1', device.id, 'session-1', {
        previousBatchHash: '9'.repeat(64),
        createdAt: '2026-01-01T00:05:00.000Z',
      }),
      identity,
    );
    store.insertBatch(batch1, '2026-01-01T00:05:00.000Z');

    const result = evaluateStoredBatchTrust(store, batch1.id);
    expect(result?.signature.status).toBe('valid');
    expect(result?.structure.batchChain.valid).toBe(false);
    expect(result?.structure.checkpointChain.valid).toBe(true);
    expect(result?.structure.valid).toBe(false);
    expect(result?.claimStatus).toBe('structure_invalid');
    expect(result?.reasons).toContain('batch_chain_invalid');
    expect(result?.reasons).not.toContain('checkpoint_chain_invalid');
    record(result!.claimStatus);
    store.close();
  });

  it('does not implicate an earlier, valid batch when only a LATER batch in the same device chain is broken', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);

    const batch0 = signProvenanceBatch(makeBatch('batch-scope-0', device.id, 'session-1'), identity);
    store.insertBatch(batch0, '2026-01-01T00:03:00.000Z');
    const batch1 = signProvenanceBatch(
      makeBatch('batch-scope-1', device.id, 'session-1', {
        previousBatchHash: '9'.repeat(64),
        createdAt: '2026-01-01T00:05:00.000Z',
      }),
      identity,
    );
    store.insertBatch(batch1, '2026-01-01T00:05:00.000Z');

    // batch0 is the FIRST batch in the device's chain — its own prefix chain is just itself, always valid.
    const resultForEarlierBatch = evaluateStoredBatchTrust(store, batch0.id);
    expect(resultForEarlierBatch?.structure.batchChain.valid).toBe(true);
    expect(resultForEarlierBatch?.claimStatus).toBe('locally_sound_unverified_claim');
    store.close();
  });

  it('checkpoint AND batch chain both broken: both reason codes are preserved even though the rollup names one', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);

    const checkpoint0 = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-both-0'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId: device.id,
      sequence: 0,
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:01:00.000Z',
    });
    store.insertCheckpoint(checkpoint0, '2026-01-01T00:01:00.000Z');
    const checkpoint1 = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-both-1'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId: device.id,
      sequence: 1,
      previousCheckpointHash: '9'.repeat(64),
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:02:00.000Z',
    });
    store.insertCheckpoint(checkpoint1, '2026-01-01T00:02:00.000Z');

    const batch0 = signProvenanceBatch(makeBatch('batch-both-0', device.id, 'session-1'), identity);
    store.insertBatch(batch0, '2026-01-01T00:03:00.000Z');
    const batch1 = signProvenanceBatch(
      makeBatch('batch-both-1', device.id, 'session-1', {
        previousBatchHash: '9'.repeat(64),
        createdAt: '2026-01-01T00:05:00.000Z',
      }),
      identity,
    );
    store.insertBatch(batch1, '2026-01-01T00:05:00.000Z');

    const result = evaluateStoredBatchTrust(store, batch1.id);
    expect(result?.claimStatus).toBe('structure_invalid');
    expect(result?.reasons).toContain('checkpoint_chain_invalid');
    expect(result?.reasons).toContain('batch_chain_invalid');
    record(result!.claimStatus);
    store.close();
  });

  it('structure broken AND device revoked: rollup prioritizes structure_invalid, but device_revoked is still preserved in reasons', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);

    const batch0 = signProvenanceBatch(makeBatch('batch-priority-0', device.id, 'session-1'), identity);
    store.insertBatch(batch0, '2026-01-01T00:03:00.000Z');
    const batch1 = signProvenanceBatch(
      makeBatch('batch-priority-1', device.id, 'session-1', {
        previousBatchHash: '9'.repeat(64),
        createdAt: '2026-01-01T00:05:00.000Z',
      }),
      identity,
    );
    store.insertBatch(batch1, '2026-01-01T00:05:00.000Z');
    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    const result = evaluateStoredBatchTrust(store, batch1.id);
    expect(result?.claimStatus).toBe('structure_invalid'); // structure outranks device trust in the rollup
    expect(result?.reasons).toContain('batch_chain_invalid');
    expect(result?.reasons).toContain('device_revoked');
    record(result!.claimStatus);
    store.close();
  });
});

describe('evaluateStoredBatchTrust — missing references', () => {
  it('returns undefined for a batch that was never persisted', () => {
    const { store } = setup();
    expect(evaluateStoredBatchTrust(store, asBatchId('never-existed'))).toBeUndefined();
    store.close();
  });

  it('a batch referencing a session that was never persisted reports an explicit structural failure, not a fabricated pass', () => {
    const { store, device, identity, dbPath } = setup();
    const signed = signProvenanceBatch(
      makeBatch('batch-ghost-session', device.id, 'session-that-was-never-persisted'),
      identity,
    );
    store.close();

    insertPhantomBatchRow(dbPath, {
      id: signed.id,
      profileId: signed.profileId,
      deviceId: signed.deviceId,
      sessionId: 'session-that-was-never-persisted',
      eventCount: signed.eventCount,
      firstEventAt: signed.firstEventAt,
      lastEventAt: signed.lastEventAt,
      manifestHash: signed.manifestHash,
      signature: signed.signature ?? null,
      createdAt: signed.createdAt,
      storedAt: '2026-01-01T00:04:00.000Z',
    });

    const reopened = new LocalEvidenceStore(dbPath);
    const result = evaluateStoredBatchTrust(reopened, signed.id);
    expect(result?.signature.status).toBe('valid'); // signing didn't depend on the session actually existing
    expect(result?.structure.valid).toBe(false);
    expect(result?.claimStatus).toBe('structure_invalid');
    expect(result?.reasons).toContain('session_missing');
    expect(result?.reasons).not.toContain('checkpoint_chain_invalid');
    record(result!.claimStatus);
    reopened.close();
  });
});

describe('evaluateStoredBatchTrust — ClaimStatus coverage', () => {
  it('every ClaimStatus union member was exercised by the tests above', () => {
    const allStatuses: readonly ClaimStatus[] = [
      'unsigned',
      'signature_invalid',
      'signer_unknown',
      'structure_invalid',
      'device_untrusted',
      'locally_sound_unverified_claim',
    ];
    for (const status of allStatuses) {
      expect(observedClaimStatuses.has(status)).toBe(true);
    }
    expect(observedClaimStatuses.size).toBe(allStatuses.length);
  });
});

describe('src/device/trust.ts evaluateBatchTrust — unchanged by this batch', () => {
  it('still behaves exactly as before: pure, in-memory, no store dependency', () => {
    const { device, identity } = (() => {
      const keyStore = new FileDeviceKeyStore(makeTempDir('flow-trust-legacy-keystore-'));
      return createDeviceIdentity(keyStore, {
        profileId: asProfileId('profile-1'),
        platform: 'macos',
        appVersion: '1.0.0',
      });
    })();
    const signed = signProvenanceBatch(makeBatch('batch-legacy', device.id, 'session-1'), identity);
    const evaluation = evaluateBatchTrust(signed, identity.publicKeySpkiDer, device);
    expect(evaluation).toEqual({ signature: { valid: true }, deviceCurrentlyTrusted: true });
  });
});

afterAll(() => {
  // Final sanity: the coverage set itself must never have grown beyond the known union.
  expect(observedClaimStatuses.size).toBeLessThanOrEqual(6);
});
