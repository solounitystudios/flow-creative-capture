import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch, verifySignedBatch } from '../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';

/**
 * The hard invariant this batch exists to prove: a signed ProvenanceBatch,
 * once persisted and reloaded from a closed-and-reopened store, verifies
 * IDENTICALLY to how it verified before persistence. Storage is not
 * allowed to reorder fields, normalize away values, alter timestamps,
 * change null/undefined semantics, alter hashes, or alter the signature
 * encoding — any of those would silently change what the signature
 * actually protects.
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

describe('signed batch — persistence round-trip', () => {
  it('verifies identically before and after close/reopen, with every field preserved exactly', () => {
    // 1. Real DeviceIdentity.
    const keyStoreDir = makeTempDir('flow-sig-roundtrip-keystore-');
    const keyStore = new FileDeviceKeyStore(keyStoreDir);
    const deviceId = asDeviceId('device-roundtrip-01');
    const { device, identity } = createDeviceIdentity(keyStore, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
      deviceId,
    });

    // 2. Real provenance batch, built from real events.
    const events = [
      createProvenanceEvent({
        eventId: asEventId('event-1'),
        projectId: asProjectId('project-1'),
        sessionId: asSessionId('session-1'),
        actorProfileId: asProfileId('profile-1'),
        deviceId,
        source: 'studio_simulator',
        eventType: 'project_saved',
        occurredAt: '2026-01-01T00:01:00.000Z',
      }),
      createProvenanceEvent({
        eventId: asEventId('event-2'),
        projectId: asProjectId('project-1'),
        sessionId: asSessionId('session-1'),
        actorProfileId: asProfileId('profile-1'),
        deviceId,
        source: 'studio_simulator',
        eventType: 'checkpoint_created',
        occurredAt: '2026-01-01T00:02:00.000Z',
        payload: { checkpointId: 'checkpoint-1' },
      }),
    ];
    const unsigned = createBatchFromEvents({
      id: asBatchId('batch-roundtrip-01'),
      profileId: asProfileId('profile-1'),
      deviceId,
      sessionId: asSessionId('session-1'),
      events,
      createdAt: '2026-01-01T00:03:00.000Z',
    });

    // 3. Sign it.
    const signed = signProvenanceBatch(unsigned, identity);

    // 4. Verify signature BEFORE persistence.
    const beforePersistence = verifySignedBatch(signed, identity.publicKeySpkiDer);
    expect(beforePersistence).toEqual({ valid: true });

    // 5. Persist it.
    const dbDir = makeTempDir('flow-sig-roundtrip-db-');
    const dbPath = join(dbDir, 'evidence.db');
    let store = new LocalEvidenceStore(dbPath);
    store.insertDevice(device, identity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
    store.insertSession(
      createStudioSession({
        id: asSessionId('session-1'),
        projectId: asProjectId('project-1'),
        actorProfileId: asProfileId('profile-1'),
        deviceId,
        daw: 'studio_one',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
      '2026-01-01T00:00:00.000Z',
    );
    for (const event of events) {
      store.insertEvent(event, '2026-01-01T00:04:00.000Z');
    }
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');

    // 6. Close the store.
    store.close();

    // 7. Reopen the store.
    store = new LocalEvidenceStore(dbPath);

    // 8. Reload the batch.
    const reloaded = store.getBatch(signed.id);
    expect(reloaded).toBeDefined();

    // 9. Verify signature AFTER persistence — the hard invariant.
    const afterPersistence = verifySignedBatch(reloaded!, identity.publicKeySpkiDer);
    expect(afterPersistence).toEqual(beforePersistence);
    expect(afterPersistence).toEqual({ valid: true });

    // Also exercise the store's own convenience verification paths.
    expect(store.verifyBatchSignature(signed.id, identity.publicKeySpkiDer)).toEqual({ valid: true });
    expect(store.verifyBatchSignatureUsingStoredDeviceKey(signed.id)).toEqual({ valid: true });

    // Field-by-field: nothing was reordered, normalized away, or altered.
    expect(reloaded!.id).toBe(signed.id);
    expect(reloaded!.profileId).toBe(signed.profileId);
    expect(reloaded!.deviceId).toBe(signed.deviceId);
    expect(reloaded!.sessionId).toBe(signed.sessionId);
    expect(reloaded!.eventCount).toBe(signed.eventCount);
    expect(reloaded!.firstEventAt).toBe(signed.firstEventAt);
    expect(reloaded!.lastEventAt).toBe(signed.lastEventAt);
    expect(reloaded!.manifestHash).toBe(signed.manifestHash);
    expect(reloaded!.signature).toBe(signed.signature);
    expect(reloaded!.createdAt).toBe(signed.createdAt);
    // previousBatchHash was absent on the original — undefined/absent semantics preserved, not coerced to null/"".
    expect(reloaded?.previousBatchHash).toBe(signed.previousBatchHash);
    expect(reloaded).toEqual(signed);

    store.close();
  });

  it('preserves an explicit previousBatchHash exactly (not confused with absence)', () => {
    const keyStoreDir = makeTempDir('flow-sig-roundtrip-keystore-2-');
    const keyStore = new FileDeviceKeyStore(keyStoreDir);
    const deviceId = asDeviceId('device-roundtrip-02');
    const { device, identity } = createDeviceIdentity(keyStore, {
      profileId: asProfileId('profile-1'),
      platform: 'linux',
      appVersion: '1.0.0',
      deviceId,
    });

    const event = createProvenanceEvent({
      eventId: asEventId('event-1'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId,
      source: 'studio_simulator',
      eventType: 'project_saved',
      occurredAt: '2026-01-01T00:01:00.000Z',
    });
    const unsigned = createBatchFromEvents({
      id: asBatchId('batch-with-previous'),
      profileId: asProfileId('profile-1'),
      deviceId,
      sessionId: asSessionId('session-1'),
      previousBatchHash: 'f'.repeat(64),
      events: [event],
      createdAt: '2026-01-01T00:03:00.000Z',
    });
    const signed = signProvenanceBatch(unsigned, identity);

    const dbDir = makeTempDir('flow-sig-roundtrip-db-2-');
    const dbPath = join(dbDir, 'evidence.db');
    let store = new LocalEvidenceStore(dbPath);
    store.insertDevice(device, identity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
    store.insertSession(
      createStudioSession({
        id: asSessionId('session-1'),
        projectId: asProjectId('project-1'),
        actorProfileId: asProfileId('profile-1'),
        deviceId,
        daw: 'cubase',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
      '2026-01-01T00:00:00.000Z',
    );
    store.insertEvent(event, '2026-01-01T00:04:00.000Z');
    store.insertBatch(signed, '2026-01-01T00:04:00.000Z');
    store.close();

    store = new LocalEvidenceStore(dbPath);
    const reloaded = store.getBatch(signed.id);
    expect(reloaded?.previousBatchHash).toBe('f'.repeat(64));
    expect(verifySignedBatch(reloaded!, identity.publicKeySpkiDer)).toEqual({ valid: true });
    store.close();
  });
});
