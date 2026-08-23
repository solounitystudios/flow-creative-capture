import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId } from '../../src/domain/ids.js';
import { runColdNightsScenario } from '../../src/simulator/coldNights.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { evaluateStoredBatchTrust } from '../../src/trust/batchTrust.js';

/**
 * Extends the existing Cold Nights + Local Evidence Store integration
 * (tests/simulator/coldNightsEvidenceStore.test.ts, unmodified) one step
 * further: once NightWire's signed evidence is durably persisted, run the
 * new Trust Evaluation layer over it and prove it reaches the ceiling
 * state, then degrade exactly one trust dimension (device revocation)
 * using an existing store mechanism and prove the evaluation tracks that
 * change precisely — without touching the simulator itself.
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

describe('Cold Nights -> persisted signed evidence -> evaluateStoredBatchTrust', () => {
  it('reaches locally_sound_unverified_claim, then precisely tracks a degraded device-trust dimension', () => {
    const scenario = runColdNightsScenario();
    const nightwireEvents = scenario.events.filter((event) => event.deviceId === scenario.nightwireDevice.id);
    const nightwireCheckpoints = scenario.checkpoints.filter((checkpoint) => checkpoint.sequence === 0);
    expect(nightwireCheckpoints).toHaveLength(1);

    const keyStore = new FileDeviceKeyStore(makeTempDir('flow-cold-nights-trust-keystore-'));
    const { identity } = createDeviceIdentity(keyStore, {
      profileId: scenario.nightwireSession.actorProfileId,
      platform: scenario.nightwireDevice.platform,
      appVersion: scenario.nightwireDevice.appVersion,
      deviceId: scenario.nightwireDevice.id,
    });

    const batch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-cold-nights-trust-01'),
        profileId: scenario.nightwireSession.actorProfileId,
        deviceId: scenario.nightwireDevice.id,
        sessionId: scenario.nightwireSession.id,
        events: nightwireEvents,
        createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
      }),
      identity,
    );

    const dbPath = join(makeTempDir('flow-cold-nights-trust-db-'), 'evidence.db');
    const store = new LocalEvidenceStore(dbPath);
    store.insertDevice(scenario.nightwireDevice, identity.publicKeySpkiDer, scenario.nightwireSession.startedAt);
    store.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
    store.insertEvidenceBundle({
      events: nightwireEvents,
      checkpoint: nightwireCheckpoints[0]!,
      batch,
      storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    });

    const sound = evaluateStoredBatchTrust(store, batch.id);
    expect(sound?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(sound?.signature.status).toBe('valid');
    expect(sound?.structure.valid).toBe(true);
    expect(sound?.deviceTrust.currentlyTrusted).toBe(true);
    expect(sound?.reasons).toEqual([]);

    // Degrade exactly one dimension: revoke NightWire's device, using the
    // existing LocalEvidenceStore.revokeDevice mechanism (no new machinery).
    store.revokeDevice(scenario.nightwireDevice.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    const degraded = evaluateStoredBatchTrust(store, batch.id);
    expect(degraded?.claimStatus).toBe('device_untrusted');
    // The signature and structural facts are untouched by the revocation —
    // only the device-trust dimension moved.
    expect(degraded?.signature.status).toBe('valid');
    expect(degraded?.structure.valid).toBe(true);
    expect(degraded?.deviceTrust).toEqual({
      deviceFound: true,
      currentlyTrusted: false,
      revokedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(degraded?.reasons).toEqual(['device_revoked']);

    store.close();
  });
});
