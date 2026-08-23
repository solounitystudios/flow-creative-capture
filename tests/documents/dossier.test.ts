import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId } from '../../src/domain/ids.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { runColdNightsScenario } from '../../src/simulator/coldNights.js';
import { assembleEvidenceBundle, type EvidenceBundleExport } from '../../src/evidence/bundle.js';
import { buildProjectDossier, DOSSIER_NOT_CLAIMED_NOTICES, DOSSIER_UNVERIFIED_NOTICES } from '../../src/documents/dossier.js';

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

const EXPORTED_AT = '2026-02-01T00:00:00.000Z';
const GENERATED_AT = '2026-02-01T00:05:00.000Z';

/** Same Cold Nights fixture pattern as tests/evidence/bundle.test.ts, producing an already-assembled EvidenceBundleExport. */
function buildColdNightsBundle(dbPath: string, documentationProfile?: 'traditional' | 'ai_native' | 'hybrid'): EvidenceBundleExport {
  const scenario = runColdNightsScenario();
  const nightwireEvents = scenario.events.filter((e) => e.deviceId === scenario.nightwireDevice.id);
  const marcusEvents = scenario.events.filter((e) => e.deviceId === scenario.marcusDevice.id);

  const keyStore = new FileDeviceKeyStore(makeTempDir('flow-dossier-keystore-'));
  const nightwireIdentity = createDeviceIdentity(keyStore, {
    profileId: scenario.nightwireSession.actorProfileId,
    platform: scenario.nightwireDevice.platform,
    appVersion: scenario.nightwireDevice.appVersion,
    deviceId: scenario.nightwireDevice.id,
  }).identity;
  const marcusIdentity = createDeviceIdentity(keyStore, {
    profileId: scenario.marcusSession.actorProfileId,
    platform: scenario.marcusDevice.platform,
    appVersion: scenario.marcusDevice.appVersion,
    deviceId: scenario.marcusDevice.id,
  }).identity;

  const nightwireBatch = signProvenanceBatch(
    createBatchFromEvents({
      id: asBatchId('batch-dossier-nightwire-01'),
      profileId: scenario.nightwireSession.actorProfileId,
      deviceId: scenario.nightwireDevice.id,
      sessionId: scenario.nightwireSession.id,
      events: nightwireEvents,
      createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    }),
    nightwireIdentity,
  );
  const marcusBatch = signProvenanceBatch(
    createBatchFromEvents({
      id: asBatchId('batch-dossier-marcus-01'),
      profileId: scenario.marcusSession.actorProfileId,
      deviceId: scenario.marcusDevice.id,
      sessionId: scenario.marcusSession.id,
      events: marcusEvents,
      createdAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
    }),
    marcusIdentity,
  );

  const store = new LocalEvidenceStore(dbPath);
  store.insertDevice(scenario.nightwireDevice, nightwireIdentity.publicKeySpkiDer, scenario.nightwireSession.startedAt);
  store.insertDevice(scenario.marcusDevice, marcusIdentity.publicKeySpkiDer, scenario.marcusSession.startedAt);
  store.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
  store.insertSession(scenario.marcusSession, scenario.marcusSession.startedAt);
  store.insertEvidenceBundle({
    events: nightwireEvents,
    checkpoint: scenario.checkpoints[0]!,
    batch: nightwireBatch,
    storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
  });
  store.insertEvidenceBundle({ events: marcusEvents, checkpoint: scenario.checkpoints[1]!, storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt });
  store.insertEvidenceBundle({ checkpoint: scenario.checkpoints[2]!, batch: marcusBatch, storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt });

  const bundle = assembleEvidenceBundle(store, {
    projectId: scenario.project.id,
    exportedAt: EXPORTED_AT,
    ...(documentationProfile !== undefined ? { documentationProfile } : {}),
  });
  store.close();
  return bundle;
}

describe('buildProjectDossier — deterministic derivation', () => {
  it('produces a byte-for-byte identical dossier across repeated calls against the same bundle', () => {
    const bundle = buildColdNightsBundle(join(makeTempDir('flow-dossier-determinism-'), 'evidence.db'));

    const first = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    const second = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('buildProjectDossier — content correctness', () => {
  it('summarizes participants, activity, and trust from the bundle without re-embedding raw records', () => {
    const bundle = buildColdNightsBundle(join(makeTempDir('flow-dossier-content-'), 'evidence.db'));
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });

    expect(dossier.dossierVersion).toBe(1);
    expect(dossier.generatedAt).toBe(GENERATED_AT);
    expect(dossier.sourceEvidenceBundle).toEqual({
      exportedAt: bundle.exportedAt,
      canonicalHash: bundle.integrityManifest.canonicalHash,
    });
    expect(dossier.project).toEqual(bundle.project);

    const participantIds = dossier.participants.map((p) => p.profileId).sort();
    const expectedProfileIds = [...new Set(bundle.sessions.map((s) => s.actorProfileId))].sort();
    expect(participantIds).toEqual(expectedProfileIds);
    for (const participant of dossier.participants) {
      expect(participant.sessionCount).toBeGreaterThan(0);
      expect(participant.eventCount).toBeGreaterThan(0);
    }

    expect(dossier.activity.sessionCount).toBe(bundle.sessions.length);
    expect(dossier.activity.eventCount).toBe(bundle.events.length);
    expect(dossier.activity.checkpointCount).toBe(bundle.checkpoints.length);
    expect(dossier.activity.batchCount).toBe(bundle.batches.length);
    expect(dossier.activity.deviceCount).toBe(bundle.devices.length);

    expect(dossier.trust.batchCount).toBe(bundle.batches.length);
    expect(dossier.trust.allBatchesSound).toBe(true);
    expect(dossier.trust.claimStatusCounts).toEqual({ locally_sound_unverified_claim: bundle.batches.length });

    // The dossier never re-embeds the bundle's own record arrays.
    expect('sessions' in dossier).toBe(false);
    expect('events' in dossier).toBe(false);
    expect('checkpoints' in dossier).toBe(false);
    expect('batches' in dossier).toBe(false);
  });

  it('never leaves any evidence unchanged assertion violated: the source bundle object is not mutated by dossier derivation', () => {
    const bundle = buildColdNightsBundle(join(makeTempDir('flow-dossier-immutability-'), 'evidence.db'));
    const before = JSON.parse(JSON.stringify(bundle)) as unknown;

    buildProjectDossier(bundle, { generatedAt: GENERATED_AT });

    expect(JSON.parse(JSON.stringify(bundle))).toEqual(before);
  });
});

describe('buildProjectDossier — no rights/ownership inference', () => {
  it('never introduces a rightsStatus, verificationStatus, or ownership field anywhere in the dossier', () => {
    const bundle = buildColdNightsBundle(join(makeTempDir('flow-dossier-no-rights-'), 'evidence.db'));
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    const serialized = JSON.stringify(dossier);

    // Structural check: no field NAMED rightsStatus/ownership/verified/etc.
    // ("copyright" legitimately appears as a WORD inside the disclaimer
    // prose below, disclaiming exactly this — that is correct, not a leak.)
    expect(serialized).not.toMatch(/"(rightsStatus|ownership|verified|flowVerified|copyrightStatus)":/i);
    expect(dossier.disclaimers.unverified).toEqual(DOSSIER_UNVERIFIED_NOTICES);
    expect(dossier.disclaimers.notClaimed).toEqual(DOSSIER_NOT_CLAIMED_NOTICES);
    expect(dossier.disclaimers.notClaimed.some((n) => /copyright|publishing|master ownership/.test(n))).toBe(true);
  });
});

describe('buildProjectDossier — documentation profile is a label, not captured evidence', () => {
  it('carries the profile through exactly when the bundle declared one, and omits it otherwise', () => {
    const withoutProfile = buildColdNightsBundle(join(makeTempDir('flow-dossier-profile-absent-'), 'evidence.db'));
    const dossierWithout = buildProjectDossier(withoutProfile, { generatedAt: GENERATED_AT });
    expect(dossierWithout.documentationProfile).toBeUndefined();
    expect('documentationProfile' in dossierWithout).toBe(false);

    const withProfile = buildColdNightsBundle(join(makeTempDir('flow-dossier-profile-present-'), 'evidence.db'), 'ai_native');
    const dossierWith = buildProjectDossier(withProfile, { generatedAt: GENERATED_AT });
    expect(dossierWith.documentationProfile).toBe('ai_native');
    // The profile label never causes AI-provenance-specific fields to appear —
    // the dossier's shape is identical either way except for this one field.
    expect(Object.keys(dossierWith).sort()).toEqual([...Object.keys(dossierWithout), 'documentationProfile'].sort());
  });
});

describe('buildProjectDossier — private key boundary', () => {
  it('never includes private key material anywhere in a serialized dossier', () => {
    const keyStoreDir = makeTempDir('flow-dossier-keyboundary-keystore-');
    const keyStore = new FileDeviceKeyStore(keyStoreDir);
    const scenario = runColdNightsScenario();
    const identity = createDeviceIdentity(keyStore, {
      profileId: scenario.nightwireSession.actorProfileId,
      platform: scenario.nightwireDevice.platform,
      appVersion: scenario.nightwireDevice.appVersion,
      deviceId: scenario.nightwireDevice.id,
    }).identity;
    const keyMaterial = keyStore.load(scenario.nightwireDevice.id);
    const privateKeyBase64 = keyMaterial!.privateKeyPkcs8Der.toString('base64');

    const nightwireEvents = scenario.events.filter((e) => e.deviceId === scenario.nightwireDevice.id);
    const batch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-dossier-keyboundary-01'),
        profileId: scenario.nightwireSession.actorProfileId,
        deviceId: scenario.nightwireDevice.id,
        sessionId: scenario.nightwireSession.id,
        events: nightwireEvents,
        createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
      }),
      identity,
    );

    const store = new LocalEvidenceStore(join(makeTempDir('flow-dossier-keyboundary-db-'), 'evidence.db'));
    store.insertDevice(scenario.nightwireDevice, identity.publicKeySpkiDer, scenario.nightwireSession.startedAt);
    store.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
    store.insertEvidenceBundle({
      events: nightwireEvents,
      checkpoint: scenario.checkpoints[0]!,
      batch,
      storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    });
    const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    store.close();

    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    const serialized = JSON.stringify(dossier);

    expect(serialized.includes(privateKeyBase64)).toBe(false);
    // Positive control: the dossier does legitimately contain the actor's profileId text.
    expect(serialized.includes(scenario.nightwireSession.actorProfileId)).toBe(true);
  });
});
