import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';

/**
 * Proves the private key boundary from SECURITY.md / ARCHITECTURE.md holds
 * in practice, not just by code review: a device's PRIVATE key material
 * never appears anywhere in the Local Evidence Store's on-disk file, in
 * either its raw-byte or base64-text form. Private keys live solely under
 * FileDeviceKeyStore, in a completely separate file from the evidence
 * database used here.
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

describe('Local Evidence Store — private key boundary', () => {
  it('never persists private key material, in raw bytes or base64 text, anywhere in the evidence database file', () => {
    const keyStoreDir = makeTempDir('flow-keyboundary-keystore-');
    const keyStore = new FileDeviceKeyStore(keyStoreDir);
    const deviceId = asDeviceId('device-keyboundary-01');
    const { device, identity } = createDeviceIdentity(keyStore, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
      deviceId,
    });

    // The actual private key bytes, as persisted by FileDeviceKeyStore —
    // a completely separate file from the evidence database.
    const keyMaterial = keyStore.load(deviceId);
    expect(keyMaterial).toBeDefined();
    const privateKeyDer = keyMaterial!.privateKeyPkcs8Der;
    const privateKeyBase64 = privateKeyDer.toString('base64');

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
    const batch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-1'),
        profileId: asProfileId('profile-1'),
        deviceId,
        sessionId: asSessionId('session-1'),
        events: [event],
        createdAt: '2026-01-01T00:03:00.000Z',
      }),
      identity,
    );

    const dbDir = makeTempDir('flow-keyboundary-db-');
    const dbPath = join(dbDir, 'evidence.db');
    const store = new LocalEvidenceStore(dbPath);
    store.insertDevice(device, identity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
    store.insertSession(
      createStudioSession({
        id: asSessionId('session-1'),
        projectId: asProjectId('project-1'),
        actorProfileId: asProfileId('profile-1'),
        deviceId,
        daw: 'fl_studio',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
      '2026-01-01T00:00:00.000Z',
    );
    store.insertEvent(event, '2026-01-01T00:04:00.000Z');
    store.insertBatch(batch, '2026-01-01T00:04:00.000Z');
    store.close();

    const dbFileBytes = readFileSync(dbPath);

    // Negative: neither the raw DER bytes nor their base64 text form appear anywhere in the file.
    expect(dbFileBytes.includes(privateKeyDer)).toBe(false);
    expect(dbFileBytes.includes(Buffer.from(privateKeyBase64, 'utf8'))).toBe(false);

    // Positive control: the PUBLIC key's base64 text DOES appear (proving this
    // search technique actually works — the file legitimately contains
    // readable text, so the negative result above isn't a false negative
    // from e.g. everything being compressed or encrypted).
    const publicKeyBase64 = identity.publicKeySpkiDer.toString('base64');
    expect(dbFileBytes.includes(Buffer.from(publicKeyBase64, 'utf8'))).toBe(true);

    // Also confirm the signature (base64 text) itself is present, as a second positive control.
    expect(dbFileBytes.includes(Buffer.from(batch.signature as string, 'utf8'))).toBe(true);
  });
});
