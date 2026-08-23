import { mkdtempSync, rmSync } from 'node:fs';
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
import { assembleEvidenceBundle } from '../../src/evidence/bundle.js';

/**
 * The Evidence Bundle counterpart to
 * tests/store/privateKeyBoundary.test.ts: proves a device's PRIVATE key
 * material never appears anywhere in a bundle assembled by
 * `assembleEvidenceBundle`, in either raw-byte or base64-text form, once
 * the bundle is serialized the way a real export/upload path would
 * serialize it (JSON.stringify). `assembleEvidenceBundle` only ever reads
 * `LocalEvidenceStore.getDevicePublicKey` — never private key material —
 * so this is a regression test proving that boundary holds in practice,
 * not just by code review.
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

describe('Evidence Bundle — private key boundary', () => {
  it('never includes private key material, in raw bytes or base64 text, anywhere in an assembled bundle\'s serialized JSON', () => {
    const keyStoreDir = makeTempDir('flow-evidence-keyboundary-keystore-');
    const keyStore = new FileDeviceKeyStore(keyStoreDir);
    const deviceId = asDeviceId('device-evidence-keyboundary-01');
    const profileId = asProfileId('profile-evidence-keyboundary');
    const { device, identity } = createDeviceIdentity(keyStore, {
      profileId,
      platform: 'macos',
      appVersion: '1.0.0',
      deviceId,
    });

    // The actual private key bytes, as persisted by FileDeviceKeyStore — a
    // completely separate file from the evidence database, and never
    // passed to LocalEvidenceStore or assembleEvidenceBundle below.
    const keyMaterial = keyStore.load(deviceId);
    expect(keyMaterial).toBeDefined();
    const privateKeyDer = keyMaterial!.privateKeyPkcs8Der;
    const privateKeyBase64 = privateKeyDer.toString('base64');

    const projectId = asProjectId('project-evidence-keyboundary');
    const sessionId = asSessionId('session-evidence-keyboundary-01');
    const session = createStudioSession({
      id: sessionId,
      projectId,
      actorProfileId: profileId,
      deviceId,
      daw: 'fl_studio',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const event = createProvenanceEvent({
      eventId: asEventId('event-evidence-keyboundary-01'),
      projectId,
      sessionId,
      actorProfileId: profileId,
      deviceId,
      source: 'fl_studio',
      eventType: 'project_saved',
      occurredAt: '2026-01-01T00:01:00.000Z',
    });
    const batch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-evidence-keyboundary-01'),
        profileId,
        deviceId,
        sessionId,
        events: [event],
        createdAt: '2026-01-01T00:03:00.000Z',
      }),
      identity,
    );

    const dbDir = makeTempDir('flow-evidence-keyboundary-db-');
    const store = new LocalEvidenceStore(join(dbDir, 'evidence.db'));
    store.insertDevice(device, identity.publicKeySpkiDer, '2026-01-01T00:00:00.000Z');
    store.insertSession(session, '2026-01-01T00:00:00.000Z');
    store.insertEvidenceBundle({ events: [event], batch, storedAt: '2026-01-01T00:04:00.000Z' });

    const bundle = assembleEvidenceBundle(store, { projectId, exportedAt: '2026-01-01T00:05:00.000Z' });
    const serialized = JSON.stringify(bundle);

    // Negative: neither the raw DER bytes nor their base64 text form appear
    // anywhere in the bundle's serialized JSON.
    expect(serialized.includes(privateKeyBase64)).toBe(false);
    expect(Buffer.from(serialized, 'utf8').includes(privateKeyDer)).toBe(false);

    // Positive controls: the search technique actually works — the bundle
    // legitimately contains the device's PUBLIC key (base64) and the
    // batch's signature (base64), so the negative result above isn't a
    // false negative from e.g. the private key just never being tried.
    const publicKeyBase64 = identity.publicKeySpkiDer.toString('base64');
    expect(serialized.includes(publicKeyBase64)).toBe(true);
    expect(serialized.includes(batch.signature as string)).toBe(true);

    store.close();
  });
});
