import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asCheckpointId, asDeviceId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceCheckpoint } from '../../src/device/checkpointSigning.js';
import { createCheckpointFromManifest, type CreateCheckpointOptions } from '../../src/provenance/checkpoint.js';
import { closeEvidenceDatabase, openEvidenceDatabase } from '../../src/store/database.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { evaluateStoredCheckpointTrust } from '../../src/trust/checkpointTrust.js';

/**
 * Mirrors tests/trust/batchTrust.test.ts's structure exactly, evaluated
 * over checkpoints instead of batches — same setup helpers, same
 * dimension/claimStatus assertions, over `evaluateStoredCheckpointTrust`.
 */

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

function setup(deviceIdStr = 'device-1') {
  const keyStore = new FileDeviceKeyStore(makeTempDir('flow-checkpointtrust-keystore-'));
  const deviceId = asDeviceId(deviceIdStr);
  const { device, identity } = createDeviceIdentity(keyStore, {
    profileId: asProfileId('profile-1'),
    platform: 'macos',
    appVersion: '1.0.0',
    deviceId,
  });
  const dbPath = join(makeTempDir('flow-checkpointtrust-db-'), 'evidence.db');
  const store = new LocalEvidenceStore(dbPath);
  store.insertDevice(device, identity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
  return { store, device, identity, dbPath };
}

function insertSession(store: LocalEvidenceStore, deviceId: ReturnType<typeof asDeviceId>, sessionId = 'session-1', projectId = 'project-1') {
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

function makeCheckpointOptions(
  id: string,
  deviceId: ReturnType<typeof asDeviceId>,
  sessionId: string,
  overrides: Partial<CreateCheckpointOptions> = {},
): CreateCheckpointOptions {
  return {
    id: asCheckpointId(id),
    projectId: asProjectId('project-1'),
    sessionId: asSessionId(sessionId),
    actorProfileId: asProfileId('profile-1'),
    deviceId,
    sequence: 0,
    manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
    triggerType: 'manual',
    createdAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}

describe('evaluateStoredCheckpointTrust — sound evidence', () => {
  it('a fully sound, signed, persisted checkpoint evaluates to locally_sound_unverified_claim', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const checkpoint = createCheckpointFromManifest(makeCheckpointOptions('checkpoint-sound', device.id, 'session-1'));
    const signed = signProvenanceCheckpoint(checkpoint, identity);
    store.insertCheckpoint(signed, '2026-01-01T00:02:00.000Z');

    const result = evaluateStoredCheckpointTrust(store, signed.id);
    expect(result).toBeDefined();
    expect(result?.signature.status).toBe('valid');
    expect(result?.structure.valid).toBe(true);
    expect(result?.deviceTrust).toEqual({ deviceFound: true, currentlyTrusted: true });
    expect(result?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(result?.reasons).toEqual([]);
    store.close();
  });

  it('returns undefined for a checkpoint id that was never persisted', () => {
    const { store } = setup();
    expect(evaluateStoredCheckpointTrust(store, asCheckpointId('nope'))).toBeUndefined();
    store.close();
  });
});

describe('evaluateStoredCheckpointTrust — signature dimension', () => {
  it('an unsigned checkpoint evaluates to unsigned, with reasons containing checkpoint_unsigned', () => {
    const { store, device } = setup();
    insertSession(store, device.id);
    const checkpoint = createCheckpointFromManifest(makeCheckpointOptions('checkpoint-unsigned', device.id, 'session-1'));
    store.insertCheckpoint(checkpoint, '2026-01-01T00:02:00.000Z');

    const result = evaluateStoredCheckpointTrust(store, checkpoint.id);
    expect(result?.signature.status).toBe('unsigned');
    expect(result?.claimStatus).toBe('unsigned');
    expect(result?.reasons).toContain('checkpoint_unsigned');
    store.close();
  });

  it('a checkpoint whose device was never persisted evaluates to signer_unknown, distinct from unsigned', () => {
    const { store, device, dbPath } = setup();
    const session = insertSession(store, device.id);
    store.close();

    // Bypass insertCheckpoint's foreign-key enforcement (which makes an
    // unregistered device unreachable through normal application use) to
    // simulate an inconsistent/corrupted database state directly — the
    // same technique tests/trust/batchTrust.test.ts uses for batches.
    const raw = openEvidenceDatabase(dbPath);
    raw.exec('PRAGMA foreign_keys = OFF');
    raw
      .prepare(
        `INSERT INTO checkpoints (id, projectId, sessionId, actorProfileId, deviceId, sequence, previousCheckpointHash, manifestHash, checkpointHash, signature, triggerType, createdAt, storedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'checkpoint-ghost-device',
        'project-1',
        session.id,
        'profile-1',
        'device-that-was-never-registered',
        0,
        null,
        'a'.repeat(64),
        'b'.repeat(64),
        null,
        'manual',
        '2026-01-01T00:01:00.000Z',
        '2026-01-01T00:02:00.000Z',
      );
    closeEvidenceDatabase(raw);

    const reopened = new LocalEvidenceStore(dbPath);
    const result = evaluateStoredCheckpointTrust(reopened, asCheckpointId('checkpoint-ghost-device'));
    expect(result?.signature).toEqual({ status: 'signer_unknown' });
    expect(result?.deviceTrust).toEqual({ deviceFound: false, currentlyTrusted: false });
    expect(result?.claimStatus).toBe('signer_unknown');
    expect(result?.reasons).toContain('signer_device_unknown');
    expect(result?.reasons).not.toContain('checkpoint_unsigned');
    reopened.close();
  });

  it('a malformed signature evaluates to signature_invalid, with reasons containing signature_malformed', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const checkpoint = createCheckpointFromManifest(makeCheckpointOptions('checkpoint-malformed', device.id, 'session-1'));
    const signed = signProvenanceCheckpoint(checkpoint, identity);
    const truncated = { ...signed, signature: (signed.signature as string).slice(0, 10) };
    store.insertCheckpoint(truncated, '2026-01-01T00:02:00.000Z');

    const result = evaluateStoredCheckpointTrust(store, truncated.id);
    expect(result?.signature.status).toBe('invalid');
    expect(result?.claimStatus).toBe('signature_invalid');
    expect(result?.reasons).toContain('signature_malformed');
    store.close();
  });

  it('a signature that does not match the persisted public key evaluates to signature_invalid (mismatch)', () => {
    const { store, device } = setup();
    insertSession(store, device.id);

    // A second, unrelated keypair, forced to the same nominal deviceId —
    // the checkpoint is genuinely signed with the WRONG private key
    // relative to what is stored for this device.
    const otherKeyStore = new FileDeviceKeyStore(makeTempDir('flow-checkpointtrust-otherkey-'));
    const { identity: otherIdentity } = createDeviceIdentity(otherKeyStore, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
      deviceId: device.id,
    });
    const checkpoint = createCheckpointFromManifest(makeCheckpointOptions('checkpoint-mismatch', device.id, 'session-1'));
    const signedWithWrongKey = signProvenanceCheckpoint(checkpoint, otherIdentity);
    store.insertCheckpoint(signedWithWrongKey, '2026-01-01T00:02:00.000Z');

    const result = evaluateStoredCheckpointTrust(store, signedWithWrongKey.id);
    expect(result?.signature.status).toBe('invalid');
    expect(result?.signature.status === 'invalid' && result.signature.verification.reason).toBe('signature_mismatch');
    expect(result?.claimStatus).toBe('signature_invalid');
    expect(result?.reasons).toContain('signature_mismatch');
    store.close();
  });
});

describe('evaluateStoredCheckpointTrust — structural dimension', () => {
  it('a broken checkpoint chain evaluates to structure_invalid, with a valid signature preserved', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);

    const checkpoint0 = createCheckpointFromManifest(makeCheckpointOptions('checkpoint-0', device.id, 'session-1', { sequence: 0 }));
    store.insertCheckpoint(checkpoint0, '2026-01-01T00:01:00.000Z');

    // Deliberately wrong previousCheckpointHash — does not match checkpoint0's actual hash.
    const checkpoint1 = createCheckpointFromManifest(
      makeCheckpointOptions('checkpoint-1', device.id, 'session-1', {
        sequence: 1,
        previousCheckpointHash: '9'.repeat(64),
        createdAt: '2026-01-01T00:02:00.000Z',
      }),
    );
    const signed1 = signProvenanceCheckpoint(checkpoint1, identity);
    store.insertCheckpoint(signed1, '2026-01-01T00:02:00.000Z');

    const result = evaluateStoredCheckpointTrust(store, signed1.id);
    expect(result?.signature.status).toBe('valid');
    expect(result?.structure.valid).toBe(false);
    expect(result?.claimStatus).toBe('structure_invalid');
    expect(result?.reasons).toContain('checkpoint_chain_invalid');
    store.close();
  });
});

describe('evaluateStoredCheckpointTrust — device trust dimension (non-retroactivity)', () => {
  it('revoking the signing device after a checkpoint was validly signed flips deviceTrust and claimStatus, but never the signature dimension', () => {
    const { store, device, identity } = setup();
    insertSession(store, device.id);
    const checkpoint = createCheckpointFromManifest(makeCheckpointOptions('checkpoint-recompute', device.id, 'session-1'));
    const signed = signProvenanceCheckpoint(checkpoint, identity);
    store.insertCheckpoint(signed, '2026-01-01T00:02:00.000Z');

    const first = evaluateStoredCheckpointTrust(store, signed.id);
    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    const second = evaluateStoredCheckpointTrust(store, signed.id);

    expect(first?.claimStatus).not.toBe(second?.claimStatus);
    expect(first?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(second?.claimStatus).toBe('device_untrusted');
    expect(second?.signature.status).toBe(first?.signature.status);
    expect(second?.reasons).toContain('device_revoked');
    store.close();
  });
});
