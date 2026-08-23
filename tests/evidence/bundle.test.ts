import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asBatchId,
  asDeviceId,
  asEventId,
  asProfileId,
  asProjectId,
  asSessionId,
  asWorkReferenceId,
} from '../../src/domain/ids.js';
import { createStudioDevice } from '../../src/domain/studioDevice.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { runColdNightsScenario } from '../../src/simulator/coldNights.js';
import { assembleEvidenceBundle } from '../../src/evidence/bundle.js';
import { EvidenceBundleAssemblyError } from '../../src/evidence/errors.js';

// See src/store/database.ts's docstring: node:sqlite is an experimental
// builtin omitted from module.builtinModules, so this project's build
// tooling (Vite, under vitest run) can't statically resolve a plain
// `import { DatabaseSync } from 'node:sqlite'`. createRequire sidesteps it —
// same pattern already used by tests/store/database.test.ts.
interface SqliteModule {
  DatabaseSync: new (path: string) => DatabaseSyncType;
}
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as SqliteModule;

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeDbPath(prefix: string): string {
  return join(makeTempDir(prefix), 'evidence.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Persists the full Cold Nights scenario — both devices, both sessions,
 * every recorded event, all three checkpoints, and one signed batch per
 * session/device — into a fresh Local Evidence Store. This is realistic
 * fixture data exercising every field Evidence Bundle Export reads:
 * sessions, events, checkpoints, signed batches, known devices, and (via
 * assembleEvidenceBundle itself) trust evaluation.
 */
function seedColdNightsStore(dbPath: string) {
  const scenario = runColdNightsScenario();

  const nightwireEvents = scenario.events.filter((event) => event.deviceId === scenario.nightwireDevice.id);
  const marcusEvents = scenario.events.filter((event) => event.deviceId === scenario.marcusDevice.id);

  const keyStore = new FileDeviceKeyStore(makeTempDir('flow-evidence-bundle-keystore-'));
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
      id: asBatchId('batch-cold-nights-nightwire-01'),
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
      id: asBatchId('batch-cold-nights-marcus-01'),
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
  if (scenario.nightwireSession.endedAt !== undefined) {
    store.endSession(scenario.nightwireSession.id, scenario.nightwireSession.endedAt, 'ended', scenario.nightwireSession.endedAt);
  }
  if (scenario.marcusSession.endedAt !== undefined) {
    store.endSession(scenario.marcusSession.id, scenario.marcusSession.endedAt, 'ended', scenario.marcusSession.endedAt);
  }
  store.insertEvidenceBundle({
    events: nightwireEvents,
    checkpoint: scenario.checkpoints[0]!,
    batch: nightwireBatch,
    storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
  });
  store.insertEvidenceBundle({
    events: marcusEvents,
    checkpoint: scenario.checkpoints[1]!,
    storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
  });
  store.insertEvidenceBundle({
    checkpoint: scenario.checkpoints[2]!,
    batch: marcusBatch,
    storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
  });

  return { store, scenario, nightwireEvents, marcusEvents, nightwireBatch, marcusBatch };
}

const EXPORTED_AT = '2026-02-01T00:00:00.000Z';

describe('assembleEvidenceBundle — basic successful export', () => {
  it('exports the full project-scoped evidence graph: sessions, events, checkpoints, batches, devices, trust snapshots', () => {
    const { store, scenario, nightwireEvents, marcusEvents } = seedColdNightsStore(makeDbPath('flow-evidence-basic-'));

    const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });

    expect(bundle.manifestVersion).toBe(1);
    expect(bundle.exportedAt).toBe(EXPORTED_AT);
    expect(bundle.project.projectId).toBe(scenario.project.id);
    expect(bundle.project.workReference).toBe(scenario.workReference.id);

    expect(bundle.sessions.map((s) => s.id).sort()).toEqual(
      [scenario.nightwireSession.id, scenario.marcusSession.id].sort(),
    );
    expect(bundle.events).toHaveLength(nightwireEvents.length + marcusEvents.length);
    expect(bundle.checkpoints).toHaveLength(3);
    expect(bundle.checkpoints.map((c) => c.sequence)).toEqual([0, 1, 2]);
    expect(bundle.batches).toHaveLength(2);

    expect(bundle.devices.map((d) => d.deviceId).sort()).toEqual(
      [scenario.nightwireDevice.id, scenario.marcusDevice.id].sort(),
    );
    for (const device of bundle.devices) {
      expect(typeof device.publicKeySpkiDerBase64).toBe('string');
      expect(device.publicKeySpkiDerBase64.length).toBeGreaterThan(0);
    }

    expect(bundle.trustEvaluationSnapshots).toHaveLength(2);
    for (const snapshot of bundle.trustEvaluationSnapshots) {
      expect(snapshot.claimStatus).toBe('locally_sound_unverified_claim');
      expect(snapshot.capturedAt).toBe(EXPORTED_AT);
    }

    expect(bundle.integrityManifest.algorithm).toBe('sha256');
    expect(bundle.integrityManifest.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.evidenceReferenceSchemaVersion).toBe(1);

    store.close();
  });
});

describe('assembleEvidenceBundle — determinism', () => {
  it('produces a byte-for-byte identical payload and hash across repeated calls against unchanged store state', () => {
    const { store, scenario } = seedColdNightsStore(makeDbPath('flow-evidence-determinism-'));

    const first = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    const second = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    const third = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.integrityManifest.canonicalHash).toBe(first.integrityManifest.canonicalHash);
    expect(third.integrityManifest.canonicalHash).toBe(first.integrityManifest.canonicalHash);

    store.close();
  });
});

describe('assembleEvidenceBundle — hash sensitivity', () => {
  it('changes the integrity hash when meaningful evidence content changes, independent of exportedAt', () => {
    const { store, scenario } = seedColdNightsStore(makeDbPath('flow-evidence-hash-sensitivity-'));

    const before = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });

    // Add one more real, valid event to NightWire's session — genuine new
    // evidence content, not a change to exportedAt or any cosmetic field.
    const extraEvent = createProvenanceEvent({
      eventId: asEventId('event-extra-plugin-chain'),
      projectId: scenario.project.id,
      workReference: scenario.workReference.id,
      sessionId: scenario.nightwireSession.id,
      actorProfileId: scenario.nightwireSession.actorProfileId,
      deviceId: scenario.nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'plugin_chain_changed',
      occurredAt: '2026-01-05T18:30:00.000Z',
    });
    store.insertEvent(extraEvent, '2026-01-05T18:30:00.000Z');

    const after = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });

    expect(after.events).toHaveLength(before.events.length + 1);
    expect(after.integrityManifest.canonicalHash).not.toBe(before.integrityManifest.canonicalHash);

    store.close();
  });
});

describe('assembleEvidenceBundle — project isolation', () => {
  it('never leaks another project\'s sessions, events, checkpoints, or batches into the requested project\'s bundle', () => {
    const dbPath = makeDbPath('flow-evidence-isolation-');
    const { store, scenario } = seedColdNightsStore(dbPath);

    // A second, unrelated project sharing the same store.
    const otherProjectId = asProjectId('project-other');
    const otherProfileId = asProfileId('profile-other');
    const otherDeviceId = asDeviceId('device-other-01');

    const keyStore = new FileDeviceKeyStore(makeTempDir('flow-evidence-isolation-keystore-'));
    const otherIdentity = createDeviceIdentity(keyStore, {
      profileId: otherProfileId,
      platform: 'linux',
      appVersion: '1.0.0',
      deviceId: otherDeviceId,
    }).identity;

    const otherSession = createStudioSession({
      id: asSessionId('session-other-01'),
      projectId: otherProjectId,
      actorProfileId: otherProfileId,
      deviceId: otherDeviceId,
      daw: 'reaper',
      startedAt: '2026-03-01T00:00:00.000Z',
    });
    const otherEvent = createProvenanceEvent({
      eventId: asEventId('event-other-01'),
      projectId: otherProjectId,
      sessionId: otherSession.id,
      actorProfileId: otherProfileId,
      deviceId: otherDeviceId,
      source: 'reaper',
      eventType: 'session_started',
      occurredAt: '2026-03-01T00:00:00.000Z',
    });
    const otherBatch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-other-01'),
        profileId: otherProfileId,
        deviceId: otherDeviceId,
        sessionId: otherSession.id,
        events: [otherEvent],
        createdAt: '2026-03-01T00:05:00.000Z',
      }),
      otherIdentity,
    );

    const otherDevice = createStudioDevice({
      id: otherDeviceId,
      profileId: otherProfileId,
      devicePublicId: 'pub-other',
      platform: 'linux',
      appVersion: '1.0.0',
      deviceKeyFingerprint: otherIdentity.fingerprint,
    });
    store.insertDevice(otherDevice, otherIdentity.publicKeySpkiDer, '2026-03-01T00:00:00.000Z');
    store.insertSession(otherSession, '2026-03-01T00:00:00.000Z');
    store.insertEvidenceBundle({ events: [otherEvent], batch: otherBatch, storedAt: '2026-03-01T00:05:00.000Z' });

    const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });

    expect(bundle.sessions.some((s) => s.id === otherSession.id)).toBe(false);
    expect(bundle.events.some((e) => e.eventId === otherEvent.eventId)).toBe(false);
    expect(bundle.batches.some((b) => b.id === otherBatch.id)).toBe(false);
    expect(bundle.devices.some((d) => d.deviceId === otherDeviceId)).toBe(false);
    expect(bundle.trustEvaluationSnapshots.some((snap) => snap.batchId === otherBatch.id)).toBe(false);

    store.close();
  });
});

describe('assembleEvidenceBundle — dangling device reference (fail-closed)', () => {
  it('throws EvidenceBundleAssemblyError rather than silently omitting a session whose device cannot be resolved', () => {
    const dbPath = makeDbPath('flow-evidence-dangling-device-');

    // Initialize the schema via the public store, then close it.
    const store = new LocalEvidenceStore(dbPath);
    store.close();

    // The store's public API enforces `sessions.deviceId REFERENCES
    // devices(id)` (PRAGMA foreign_keys = ON — src/store/database.ts) and
    // never deletes a device row, so a dangling device reference is
    // unreachable through LocalEvidenceStore itself. Constructing it here
    // requires a raw connection with foreign keys off, exactly the
    // technique tests/store/database.test.ts already uses to prove the FK
    // constraint exists in the first place.
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = OFF');
    raw
      .prepare(
        'INSERT INTO sessions (id, projectId, actorProfileId, deviceId, daw, startedAt, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'session-dangling-01',
        'project-dangling',
        'profile-dangling',
        'device-does-not-exist',
        'fl_studio',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );
    raw.close();

    const reopened = new LocalEvidenceStore(dbPath);
    expect(() =>
      assembleEvidenceBundle(reopened, { projectId: asProjectId('project-dangling'), exportedAt: EXPORTED_AT }),
    ).toThrow(EvidenceBundleAssemblyError);
    expect(() =>
      assembleEvidenceBundle(reopened, { projectId: asProjectId('project-dangling'), exportedAt: EXPORTED_AT }),
    ).toThrow(/device-does-not-exist/);

    reopened.close();
  });
});

describe('assembleEvidenceBundle — conflicting workReference (fail-closed)', () => {
  it('throws EvidenceBundleAssemblyError when in-scope sessions disagree on workReference, without normalizing or reassigning either value', () => {
    const store = new LocalEvidenceStore(makeDbPath('flow-evidence-conflicting-workref-'));
    const projectId = asProjectId('project-conflicting-workref');
    const profileId = asProfileId('profile-conflict');
    const deviceId = asDeviceId('device-conflict-01');

    const keyStore = new FileDeviceKeyStore(makeTempDir('flow-evidence-conflict-keystore-'));
    const identity = createDeviceIdentity(keyStore, {
      profileId,
      platform: 'macos',
      appVersion: '1.0.0',
      deviceId,
    }).identity;
    store.insertDevice(
      createStudioDevice({
        id: deviceId,
        profileId,
        devicePublicId: 'pub-conflict',
        platform: 'macos',
        appVersion: '1.0.0',
        deviceKeyFingerprint: identity.fingerprint,
      }),
      identity.publicKeySpkiDer,
      '2026-01-01T00:00:00.000Z',
    );

    const sessionA = createStudioSession({
      id: asSessionId('session-conflict-a'),
      projectId,
      workReference: asWorkReferenceId('work-a'),
      actorProfileId: profileId,
      deviceId,
      daw: 'fl_studio',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const sessionB = createStudioSession({
      id: asSessionId('session-conflict-b'),
      projectId,
      workReference: asWorkReferenceId('work-b'),
      actorProfileId: profileId,
      deviceId,
      daw: 'fl_studio',
      startedAt: '2026-01-01T01:00:00.000Z',
    });
    store.insertSession(sessionA, '2026-01-01T00:00:00.000Z');
    store.insertSession(sessionB, '2026-01-01T01:00:00.000Z');

    expect(() => assembleEvidenceBundle(store, { projectId, exportedAt: EXPORTED_AT })).toThrow(
      EvidenceBundleAssemblyError,
    );
    expect(() => assembleEvidenceBundle(store, { projectId, exportedAt: EXPORTED_AT })).toThrow(/disagree on workReference/);

    // Neither session was touched by the failed assembly attempt.
    expect(store.getSession(sessionA.id)).toEqual(sessionA);
    expect(store.getSession(sessionB.id)).toEqual(sessionB);

    store.close();
  });
});

describe('assembleEvidenceBundle — trust snapshot fidelity', () => {
  it('preserves the true per-batch trust result, including a degraded (device-revoked) case, never overstating trust', () => {
    const { store, scenario, nightwireBatch, marcusBatch } = seedColdNightsStore(makeDbPath('flow-evidence-trust-'));

    const sound = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    const soundNightwireSnapshot = sound.trustEvaluationSnapshots.find((s) => s.batchId === nightwireBatch.id);
    const soundMarcusSnapshot = sound.trustEvaluationSnapshots.find((s) => s.batchId === marcusBatch.id);
    expect(soundNightwireSnapshot?.claimStatus).toBe('locally_sound_unverified_claim');
    expect(soundMarcusSnapshot?.claimStatus).toBe('locally_sound_unverified_claim');

    // Degrade exactly one dimension via the existing store mechanism.
    store.revokeDevice(scenario.nightwireDevice.id, '2026-02-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z');

    const degraded = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    const degradedNightwireSnapshot = degraded.trustEvaluationSnapshots.find((s) => s.batchId === nightwireBatch.id);
    const degradedMarcusSnapshot = degraded.trustEvaluationSnapshots.find((s) => s.batchId === marcusBatch.id);

    expect(degradedNightwireSnapshot?.claimStatus).toBe('device_untrusted');
    expect(degradedNightwireSnapshot?.deviceTrust.currentlyTrusted).toBe(false);
    expect(degradedNightwireSnapshot?.reasons).toContain('device_revoked');
    // Marcus's device was never touched — his batch's trust is unaffected.
    expect(degradedMarcusSnapshot?.claimStatus).toBe('locally_sound_unverified_claim');

    // The batch itself is still exported in full — degraded trust never
    // means the underlying evidence is dropped from the bundle.
    expect(degraded.batches.some((b) => b.id === nightwireBatch.id)).toBe(true);

    store.close();
  });
});

describe('assembleEvidenceBundle — tamper/broken-evidence condition', () => {
  it('exports an unsigned batch in full, with a trust snapshot reflecting the unsigned condition, reusing existing trust evaluation only', () => {
    const store = new LocalEvidenceStore(makeDbPath('flow-evidence-unsigned-batch-'));
    const projectId = asProjectId('project-unsigned');
    const profileId = asProfileId('profile-unsigned');
    const deviceId = asDeviceId('device-unsigned-01');
    const sessionId = asSessionId('session-unsigned-01');

    const keyStore = new FileDeviceKeyStore(makeTempDir('flow-evidence-unsigned-keystore-'));
    const identity = createDeviceIdentity(keyStore, { profileId, platform: 'windows', appVersion: '1.0.0', deviceId })
      .identity;
    store.insertDevice(
      createStudioDevice({
        id: deviceId,
        profileId,
        devicePublicId: 'pub-unsigned',
        platform: 'windows',
        appVersion: '1.0.0',
        deviceKeyFingerprint: identity.fingerprint,
      }),
      identity.publicKeySpkiDer,
      '2026-01-01T00:00:00.000Z',
    );
    const session = createStudioSession({
      id: sessionId,
      projectId,
      actorProfileId: profileId,
      deviceId,
      daw: 'cubase',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    store.insertSession(session, '2026-01-01T00:00:00.000Z');

    const event = createProvenanceEvent({
      eventId: asEventId('event-unsigned-01'),
      projectId,
      sessionId,
      actorProfileId: profileId,
      deviceId,
      source: 'cubase',
      eventType: 'project_saved',
      occurredAt: '2026-01-01T00:01:00.000Z',
    });

    // Deliberately NOT signed — createBatchFromEvents alone, never passed
    // through signProvenanceBatch.
    const unsignedBatch = createBatchFromEvents({
      id: asBatchId('batch-unsigned-01'),
      profileId,
      deviceId,
      sessionId,
      events: [event],
      createdAt: '2026-01-01T00:02:00.000Z',
    });
    store.insertEvidenceBundle({ events: [event], batch: unsignedBatch, storedAt: '2026-01-01T00:02:00.000Z' });

    const bundle = assembleEvidenceBundle(store, { projectId, exportedAt: EXPORTED_AT });

    expect(bundle.batches).toHaveLength(1);
    expect(bundle.batches[0]!.id).toBe(unsignedBatch.id);
    expect(bundle.batches[0]!.signature).toBeUndefined();

    const snapshot = bundle.trustEvaluationSnapshots.find((s) => s.batchId === unsignedBatch.id);
    expect(snapshot?.signature.status).toBe('unsigned');
    expect(snapshot?.claimStatus).toBe('unsigned');
    expect(snapshot?.reasons).toContain('batch_unsigned');

    store.close();
  });
});

describe('assembleEvidenceBundle — documentation envelope', () => {
  it('preserves a requested documentation profile exactly, with a stable registryVersion, without implying captured AI provenance', () => {
    const { store, scenario } = seedColdNightsStore(makeDbPath('flow-evidence-documentation-'));

    for (const profile of ['traditional', 'ai_native', 'hybrid'] as const) {
      const bundle = assembleEvidenceBundle(store, {
        projectId: scenario.project.id,
        exportedAt: EXPORTED_AT,
        documentationProfile: profile,
      });
      expect(bundle.documentation).toEqual({ profile, registryVersion: 'music-v1' });
      // Requesting a profile never invents fields describing captured
      // evidence — the envelope stays exactly {profile, registryVersion}.
      expect(Object.keys(bundle.documentation!).sort()).toEqual(['profile', 'registryVersion']);
    }

    store.close();
  });

  it('omits the documentation envelope entirely when no profile is requested', () => {
    const { store, scenario } = seedColdNightsStore(makeDbPath('flow-evidence-documentation-absent-'));

    const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });

    expect(bundle.documentation).toBeUndefined();
    expect('documentation' in bundle).toBe(false);

    store.close();
  });
});
