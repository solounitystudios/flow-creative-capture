import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioDevice } from '../../src/domain/studioDevice.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createDeviceIdentity } from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../src/provenance/batch.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { runColdNightsScenario } from '../../src/simulator/coldNights.js';
import { assembleEvidenceBundle, type EvidenceBundleExport } from '../../src/evidence/bundle.js';
import { buildProjectDossier, type ProjectDossier } from '../../src/documents/dossier.js';
import {
  buildDeliveryPackage,
  DELIVERY_PACKAGE_SECTION_KEYS,
  type DeliveryPackageSectionKey,
} from '../../src/documents/deliveryPackage.js';
import { DocumentAssemblyError } from '../../src/documents/errors.js';

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
const CREATED_AT = '2026-02-01T00:10:00.000Z';

function buildColdNightsBundle(): EvidenceBundleExport {
  const scenario = runColdNightsScenario();
  const nightwireEvents = scenario.events.filter((e) => e.deviceId === scenario.nightwireDevice.id);
  const marcusEvents = scenario.events.filter((e) => e.deviceId === scenario.marcusDevice.id);

  const keyStore = new FileDeviceKeyStore(makeTempDir('flow-delivery-keystore-'));
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
      id: asBatchId('batch-delivery-nightwire-01'),
      profileId: scenario.nightwireSession.actorProfileId,
      deviceId: scenario.nightwireDevice.id,
      sessionId: scenario.nightwireSession.id,
      events: nightwireEvents,
      createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    }),
    nightwireIdentity,
  );

  const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-db-'), 'evidence.db'));
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
  store.insertEvidenceBundle({ checkpoint: scenario.checkpoints[2]!, storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt });

  const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
  store.close();
  // revoke nothing here; degraded-trust variant is built separately below.
  return bundle;
}

/** A small, unrelated second project — deliberately NOT Cold Nights (whose ids are fixed literals), so it produces a genuinely different bundle for cross-source mismatch/isolation tests. */
function buildOtherProjectBundle(): EvidenceBundleExport {
  const projectId = asProjectId('project-delivery-other');
  const profileId = asProfileId('profile-delivery-other');
  const deviceId = asDeviceId('device-delivery-other-01');
  const sessionId = asSessionId('session-delivery-other-01');

  const keyStore = new FileDeviceKeyStore(makeTempDir('flow-delivery-other-keystore-'));
  const identity = createDeviceIdentity(keyStore, { profileId, platform: 'linux', appVersion: '1.0.0', deviceId }).identity;
  const device = createStudioDevice({
    id: deviceId,
    profileId,
    devicePublicId: 'pub-delivery-other',
    platform: 'linux',
    appVersion: '1.0.0',
    deviceKeyFingerprint: identity.fingerprint,
  });
  const session = createStudioSession({
    id: sessionId,
    projectId,
    actorProfileId: profileId,
    deviceId,
    daw: 'reaper',
    startedAt: '2026-04-01T00:00:00.000Z',
  });
  const event = createProvenanceEvent({
    eventId: asEventId('event-delivery-other-01'),
    projectId,
    sessionId,
    actorProfileId: profileId,
    deviceId,
    source: 'reaper',
    eventType: 'session_started',
    occurredAt: '2026-04-01T00:00:00.000Z',
  });
  const batch = signProvenanceBatch(
    createBatchFromEvents({
      id: asBatchId('batch-delivery-other-01'),
      profileId,
      deviceId,
      sessionId,
      events: [event],
      createdAt: '2026-04-01T00:05:00.000Z',
    }),
    identity,
  );

  const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-other-db-'), 'evidence.db'));
  store.insertDevice(device, identity.publicKeySpkiDer, '2026-04-01T00:00:00.000Z');
  store.insertSession(session, '2026-04-01T00:00:00.000Z');
  store.insertEvidenceBundle({ events: [event], batch, storedAt: '2026-04-01T00:05:00.000Z' });

  const bundle = assembleEvidenceBundle(store, { projectId, exportedAt: EXPORTED_AT });
  store.close();
  return bundle;
}

function buildFixture(): { bundle: EvidenceBundleExport; dossier: ProjectDossier } {
  const bundle = buildColdNightsBundle();
  const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
  return { bundle, dossier };
}

const ALL_SECTIONS = [...DELIVERY_PACKAGE_SECTION_KEYS];

describe('buildDeliveryPackage — deterministic derivation', () => {
  it('produces a byte-for-byte identical package, including its integrity hash, across repeated calls', () => {
    const { bundle, dossier } = buildFixture();
    const options = { createdAt: CREATED_AT, audience: 'collaborator' as const, purpose: 'review' as const, includeSections: ALL_SECTIONS };

    const first = buildDeliveryPackage(bundle, dossier, options);
    const second = buildDeliveryPackage(bundle, dossier, options);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.integrityManifest.canonicalHash).toBe(first.integrityManifest.canonicalHash);
  });

  it('does not mutate the source Evidence Bundle or Project Dossier', () => {
    const { bundle, dossier } = buildFixture();
    const bundleBefore = JSON.parse(JSON.stringify(bundle)) as unknown;
    const dossierBefore = JSON.parse(JSON.stringify(dossier)) as unknown;

    buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'label',
      purpose: 'licensing',
      includeSections: ALL_SECTIONS,
    });

    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundleBefore);
    expect(JSON.parse(JSON.stringify(dossier))).toEqual(dossierBefore);
  });
});

describe('buildDeliveryPackage — selective disclosure', () => {
  it('includes only requested sections and lists the rest as omitted, in canonical order regardless of request order', () => {
    const { bundle, dossier } = buildFixture();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'attorney',
      purpose: 'legal_review',
      includeSections: ['trustSummary', 'project'], // deliberately out of canonical order
    });

    expect(pkg.includedSections).toEqual(['project', 'trustSummary']);
    expect(pkg.omittedSections).toEqual(['participants', 'activity', 'documentationProfile', 'evidenceReferences', 'disclaimers']);
    expect(pkg.sections.project).toEqual(dossier.project);
    expect(pkg.sections.trustSummary).toEqual(dossier.trust);
    expect(pkg.sections.participants).toBeUndefined();
    expect(pkg.sections.activity).toBeUndefined();
    expect(pkg.sections.evidenceReferences).toBeUndefined();
    expect(pkg.sections.disclaimers).toBeUndefined();
    expect('participants' in pkg.sections).toBe(false);
  });

  it('omits documentationProfile from includedSections when requested but the dossier never declared one', () => {
    const { bundle, dossier } = buildFixture();
    expect(dossier.documentationProfile).toBeUndefined();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'platform',
      purpose: 'general_reference',
      includeSections: ['documentationProfile'],
    });

    expect(pkg.includedSections).toEqual([]);
    expect(pkg.omittedSections).toContain('documentationProfile');
    expect(pkg.sections.documentationProfile).toBeUndefined();
  });
});

describe('buildDeliveryPackage — evidence references are redacted pointers only', () => {
  it('never carries raw event payloads, signatures, or device public keys in evidenceReferences', () => {
    const { bundle, dossier } = buildFixture();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'archive',
      purpose: 'archival',
      includeSections: ['evidenceReferences'],
    });

    const refs = pkg.sections.evidenceReferences!;
    expect(refs).toHaveLength(bundle.sessions.length + bundle.events.length + bundle.checkpoints.length + bundle.batches.length);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(['at', 'id', 'kind']);
    }
    const serialized = JSON.stringify(refs);
    for (const batch of bundle.batches) {
      if (batch.signature !== undefined) {
        expect(serialized.includes(batch.signature)).toBe(false);
      }
    }
    for (const device of bundle.devices) {
      expect(serialized.includes(device.publicKeySpkiDerBase64)).toBe(false);
    }
  });
});

describe('buildDeliveryPackage — trust cannot be overstated as FLOW verification', () => {
  it('preserves the real, degraded claimStatus counts and never introduces a "verified" or "flowVerified" field', () => {
    const scenario = runColdNightsScenario();
    const nightwireEvents = scenario.events.filter((e) => e.deviceId === scenario.nightwireDevice.id);

    const keyStore = new FileDeviceKeyStore(makeTempDir('flow-delivery-degraded-keystore-'));
    const identity = createDeviceIdentity(keyStore, {
      profileId: scenario.nightwireSession.actorProfileId,
      platform: scenario.nightwireDevice.platform,
      appVersion: scenario.nightwireDevice.appVersion,
      deviceId: scenario.nightwireDevice.id,
    }).identity;
    const batch = signProvenanceBatch(
      createBatchFromEvents({
        id: asBatchId('batch-delivery-degraded-01'),
        profileId: scenario.nightwireSession.actorProfileId,
        deviceId: scenario.nightwireDevice.id,
        sessionId: scenario.nightwireSession.id,
        events: nightwireEvents,
        createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
      }),
      identity,
    );

    const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-degraded-db-'), 'evidence.db'));
    store.insertDevice(scenario.nightwireDevice, identity.publicKeySpkiDer, scenario.nightwireSession.startedAt);
    store.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
    store.insertEvidenceBundle({
      events: nightwireEvents,
      checkpoint: scenario.checkpoints[0]!,
      batch,
      storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
    });
    store.revokeDevice(scenario.nightwireDevice.id, '2026-02-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z');

    const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    store.close();
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'flow_passport_verification',
      purpose: 'verification',
      includeSections: ['trustSummary', 'disclaimers'],
    });

    expect(pkg.sections.trustSummary?.allBatchesSound).toBe(false);
    expect(pkg.sections.trustSummary?.claimStatusCounts).toEqual({ device_untrusted: 1 });
    expect(pkg.sections.disclaimers?.unverified.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toMatch(/"verified":\s*true|"flowVerified"/);
  });
});

describe('buildDeliveryPackage — malformed/inconsistent inputs fail safely', () => {
  it('throws DocumentAssemblyError on an unrecognized audience', () => {
    const { bundle, dossier } = buildFixture();
    expect(() =>
      buildDeliveryPackage(bundle, dossier, {
        createdAt: CREATED_AT,
        audience: 'not_a_real_audience' as never,
        purpose: 'review',
        includeSections: [],
      }),
    ).toThrow(DocumentAssemblyError);
  });

  it('throws DocumentAssemblyError on an unrecognized purpose', () => {
    const { bundle, dossier } = buildFixture();
    expect(() =>
      buildDeliveryPackage(bundle, dossier, {
        createdAt: CREATED_AT,
        audience: 'collaborator',
        purpose: 'not_a_real_purpose' as never,
        includeSections: [],
      }),
    ).toThrow(DocumentAssemblyError);
  });

  it('throws DocumentAssemblyError on an unrecognized section key', () => {
    const { bundle, dossier } = buildFixture();
    expect(() =>
      buildDeliveryPackage(bundle, dossier, {
        createdAt: CREATED_AT,
        audience: 'collaborator',
        purpose: 'review',
        includeSections: ['not_a_real_section' as unknown as DeliveryPackageSectionKey],
      }),
    ).toThrow(DocumentAssemblyError);
  });

  it('throws DocumentAssemblyError when the dossier was not derived from the given bundle', () => {
    const { bundle: bundleA } = buildFixture();
    const bundleB = buildOtherProjectBundle();
    const dossierB = buildProjectDossier(bundleB, { generatedAt: GENERATED_AT });

    expect(() =>
      buildDeliveryPackage(bundleA, dossierB, {
        createdAt: CREATED_AT,
        audience: 'collaborator',
        purpose: 'review',
        includeSections: ['project'],
      }),
    ).toThrow(DocumentAssemblyError);
    expect(() =>
      buildDeliveryPackage(bundleA, dossierB, {
        createdAt: CREATED_AT,
        audience: 'collaborator',
        purpose: 'review',
        includeSections: ['project'],
      }),
    ).toThrow(/not derived from the supplied Evidence Bundle/);
  });
});

describe('buildDeliveryPackage — project isolation', () => {
  it('never includes another project\'s evidence references', () => {
    const bundleA = buildColdNightsBundle();
    const dossierA = buildProjectDossier(bundleA, { generatedAt: GENERATED_AT });
    const bundleB = buildOtherProjectBundle();

    const pkg = buildDeliveryPackage(bundleA, dossierA, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['evidenceReferences'],
    });

    const refIds = new Set(pkg.sections.evidenceReferences!.map((r) => r.id));
    for (const session of bundleB.sessions) {
      expect(refIds.has(session.id)).toBe(false);
    }
    for (const event of bundleB.events) {
      expect(refIds.has(event.eventId)).toBe(false);
    }
    for (const batch of bundleB.batches) {
      expect(refIds.has(batch.id)).toBe(false);
    }
  });
});

describe('buildDeliveryPackage — private key boundary', () => {
  it('never includes private key material anywhere in a serialized package, even with all sections included', () => {
    const scenario = runColdNightsScenario();
    const keyStore = new FileDeviceKeyStore(makeTempDir('flow-delivery-keyboundary-keystore-'));
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
        id: asBatchId('batch-delivery-keyboundary-01'),
        profileId: scenario.nightwireSession.actorProfileId,
        deviceId: scenario.nightwireDevice.id,
        sessionId: scenario.nightwireSession.id,
        events: nightwireEvents,
        createdAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
      }),
      identity,
    );
    const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-keyboundary-db-'), 'evidence.db'));
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

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'flow_passport_verification',
      purpose: 'verification',
      includeSections: ALL_SECTIONS,
    });
    const serialized = JSON.stringify(pkg);

    expect(serialized.includes(privateKeyBase64)).toBe(false);
    // Positive control: the package legitimately contains the actor's profileId text.
    expect(serialized.includes(scenario.nightwireSession.actorProfileId)).toBe(true);
  });
});
