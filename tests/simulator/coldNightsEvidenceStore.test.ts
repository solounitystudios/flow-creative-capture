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

/**
 * The strongest current end-to-end proof that Creative Capture's local
 * evidence pipeline works: Cold Nights' own (unmodified) creative scenario
 * → a provenance batch built from its real events → signed by a real
 * DeviceIdentity → durably persisted to a Local Evidence Store → the
 * process closes and reopens the store → the evidence is reconstructed
 * from disk → both its hash-chain structure (checkpoints) and its device
 * signature (batch) independently re-verify, using nothing but the
 * existing provenance/device primitives.
 *
 * This does NOT modify src/simulator/coldNights.ts — Cold Nights is used
 * purely as a realistic fixture.
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

describe('Cold Nights -> signed batch -> Local Evidence Store -> close/reopen -> reconstruct + verify', () => {
  it('persists NightWire\'s evidence and independently re-verifies it after a store close/reopen', () => {
    const scenario = runColdNightsScenario();
    const nightwireEvents = scenario.events.filter((event) => event.deviceId === scenario.nightwireDevice.id);
    const nightwireCheckpoints = scenario.checkpoints.filter((checkpoint) => checkpoint.sequence === 0);
    expect(nightwireEvents.length).toBeGreaterThan(0);
    expect(nightwireCheckpoints).toHaveLength(1);

    // Real device identity, forced to Cold Nights' own nightwireDevice id.
    const keyStoreDir = makeTempDir('flow-cold-nights-store-keystore-');
    const keyStore = new FileDeviceKeyStore(keyStoreDir);
    const { identity } = createDeviceIdentity(keyStore, {
      profileId: scenario.nightwireSession.actorProfileId,
      platform: scenario.nightwireDevice.platform,
      appVersion: scenario.nightwireDevice.appVersion,
      deviceId: scenario.nightwireDevice.id,
    });

    // Real signed batch, built from NightWire's real recorded events.
    const batch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-cold-nights-store-01'),
        profileId: scenario.nightwireSession.actorProfileId,
        deviceId: scenario.nightwireDevice.id,
        sessionId: scenario.nightwireSession.id,
        events: nightwireEvents,
        createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
      }),
      identity,
    );

    // Persist device, session, events, checkpoint, and the signed batch — atomically.
    const dbDir = makeTempDir('flow-cold-nights-store-db-');
    const dbPath = join(dbDir, 'evidence.db');
    let store = new LocalEvidenceStore(dbPath);
    store.insertDevice(scenario.nightwireDevice, identity.publicKeySpkiDer, scenario.nightwireSession.startedAt);
    store.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
    if (scenario.nightwireSession.endedAt !== undefined) {
      store.endSession(scenario.nightwireSession.id, scenario.nightwireSession.endedAt, 'ended', scenario.nightwireSession.endedAt);
    }
    store.insertEvidenceBundle({
      events: nightwireEvents,
      checkpoint: nightwireCheckpoints[0]!,
      batch,
      storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    });

    // Close the process's connection to the store entirely.
    store.close();

    // Reopen — nothing in memory survives from before this point except
    // `identity` (used only to know which public key to check against,
    // exactly as a real verifier would need to be told).
    store = new LocalEvidenceStore(dbPath);

    // Reconstruct evidence from disk.
    const reloadedEvents = store.listEventsForSession(scenario.nightwireSession.id);
    expect(reloadedEvents).toHaveLength(nightwireEvents.length);
    expect(reloadedEvents.map((e) => e.eventId).sort()).toEqual(nightwireEvents.map((e) => e.eventId).sort());

    const reloadedBatch = store.getBatch(batch.id);
    expect(reloadedBatch).toEqual(batch);

    // Verify hash/provenance relationships: the checkpoint chain for this project.
    const chainResult = store.verifyCheckpointChainForProject(scenario.project.id);
    expect(chainResult.valid).toBe(true);

    // Verify the device signature, using the store's own persisted public key —
    // not the live `identity` object — proving verification survives the reopen
    // independent of any in-memory signing state.
    const signatureResult = store.verifyBatchSignatureUsingStoredDeviceKey(batch.id);
    expect(signatureResult).toEqual({ valid: true });

    store.close();
  });

  it('persists Cold Nights\' explicit contributor claims (NightWire producer/songwriter, Marcus lead guitar) and reconstructs them after a store close/reopen', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.contributors).toHaveLength(3);

    const dbDir = makeTempDir('flow-cold-nights-contributors-db-');
    const dbPath = join(dbDir, 'evidence.db');
    let store = new LocalEvidenceStore(dbPath);

    for (const claim of scenario.contributors) {
      store.insertContributorReference(claim, claim.claimedAt);
    }
    store.close();

    // Reopen — reconstruct purely from disk.
    store = new LocalEvidenceStore(dbPath);
    const reloadedClaims = store.listContributorReferencesForProject(scenario.project.id);
    expect(reloadedClaims).toEqual(scenario.contributors);

    const producerClaim = reloadedClaims.find((c) => c.role === 'producer');
    expect(producerClaim).toMatchObject({
      id: 'claim-nightwire-producer',
      projectId: scenario.project.id,
      profileId: scenario.nightwireSession.actorProfileId,
      role: 'producer',
      subrole: 'producer',
    });

    const songwriterClaim = reloadedClaims.find((c) => c.role === 'songwriter');
    expect(songwriterClaim).toMatchObject({
      id: 'claim-nightwire-songwriter',
      projectId: scenario.project.id,
      profileId: scenario.nightwireSession.actorProfileId,
      role: 'songwriter',
      subrole: 'melody',
    });

    const musicianClaim = reloadedClaims.find((c) => c.role === 'musician');
    expect(musicianClaim).toMatchObject({
      id: 'claim-marcus-musician',
      projectId: scenario.project.id,
      profileId: scenario.marcusSession.actorProfileId,
      role: 'musician',
      subrole: 'lead_guitar',
    });

    // Each claim retains its own claimedAt, individually — never
    // defaulted or collapsed to a single project-level timestamp.
    for (const claim of scenario.contributors) {
      const reloaded = reloadedClaims.find((c) => c.id === claim.id);
      expect(reloaded?.claimedAt).toBe(claim.claimedAt);
    }

    store.close();
  });
});
