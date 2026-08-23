import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runColdNightsScenario } from '../../src/simulator/coldNights.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { asBatchId } from '../../src/domain/ids.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch, verifySignedBatch } from '../../src/device/batchSigning.js';

/**
 * The Cold Nights golden scenario (src/simulator/coldNights.ts) predates
 * device signing and, by design, does not exercise it — its StudioDevice
 * fixtures carry a fabricated deviceKeyFingerprint (see coldNights.ts),
 * not one derived from a real keypair.
 *
 * This test does NOT modify the simulator. It takes Cold Nights' own
 * output (NightWire's real recorded events) and runs it through the
 * actual signing primitives, proving the provenance engine's output and
 * the device-signing primitive genuinely compose: a real batch built from
 * real (simulated) provenance events, signed by a real Ed25519
 * DeviceIdentity, verifies successfully — and tampering with it after
 * signing is still caught.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Cold Nights -> real DeviceIdentity -> batch signature -> verification', () => {
  it('signs and verifies a batch built from NightWire\'s actual Cold Nights events', () => {
    const scenario = runColdNightsScenario();

    const nightwireEvents = scenario.events.filter((event) => event.deviceId === scenario.nightwireDevice.id);
    expect(nightwireEvents.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), 'flow-cold-nights-signing-'));
    tempDirs.push(dir);
    const keyStore = new FileDeviceKeyStore(dir);

    // A real keypair, forced to the same deviceId Cold Nights already used
    // for NightWire, so the signed batch's deviceId lines up with the
    // signing identity (signProvenanceBatch requires this — see
    // src/device/batchSigning.ts).
    const { identity } = createDeviceIdentity(keyStore, {
      profileId: scenario.nightwireSession.actorProfileId,
      platform: scenario.nightwireDevice.platform,
      appVersion: scenario.nightwireDevice.appVersion,
      deviceId: scenario.nightwireDevice.id,
    });

    const batch = createBatchFromEvents({
      id: asBatchId('batch-cold-nights-nightwire-01'),
      profileId: scenario.nightwireSession.actorProfileId,
      deviceId: scenario.nightwireDevice.id,
      sessionId: scenario.nightwireSession.id,
      events: nightwireEvents,
      createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    });

    const signed = signProvenanceBatch(batch, identity);
    expect(verifySignedBatch(signed, identity.publicKeySpkiDer)).toEqual({ valid: true });

    // And it still catches tampering with the real evidence content.
    const tampered = { ...signed, eventCount: signed.eventCount + 1 };
    expect(verifySignedBatch(tampered, identity.publicKeySpkiDer).valid).toBe(false);
  });
});
