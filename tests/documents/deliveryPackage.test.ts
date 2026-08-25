import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asAssetId, asBatchId, asContributionClaimId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioDevice } from '../../src/domain/studioDevice.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createContributorReference } from '../../src/domain/contributorReference.js';
import { createProjectAsset } from '../../src/domain/projectAsset.js';
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
    expect(pkg.omittedSections).toEqual([
      'participants',
      'contributorClaims',
      'assets',
      'activity',
      'documentationProfile',
      'evidenceReferences',
      'disclaimers',
    ]);
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

describe('buildDeliveryPackage — contributor claims section', () => {
  function buildFixtureWithClaim(): { bundle: EvidenceBundleExport; dossier: ProjectDossier; claim: ReturnType<typeof createContributorReference> } {
    const projectId = asProjectId('project-delivery-claims');
    const claim = createContributorReference({
      id: asContributionClaimId('claim-delivery-01'),
      projectId,
      profileId: asProfileId('profile-delivery-claimant'),
      role: 'producer',
      subrole: 'producer',
      claimedAt: '2026-01-01T00:00:00.000Z',
    });

    const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-claims-db-'), 'evidence.db'));
    store.insertContributorReference(claim, '2026-01-01T00:05:00.000Z');
    const bundle = assembleEvidenceBundle(store, { projectId, exportedAt: EXPORTED_AT });
    store.close();
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    return { bundle, dossier, claim };
  }

  it('carries contributor claims through when the contributorClaims section is requested', () => {
    const { bundle, dossier } = buildFixtureWithClaim();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['contributorClaims'],
    });

    expect(pkg.includedSections).toEqual(['contributorClaims']);
    expect(pkg.sections.contributorClaims).toEqual(dossier.contributorClaims);
    expect(pkg.sections.contributorClaims).toHaveLength(1);
    expect(pkg.sections.contributorClaims![0]!.role).toBe('producer');
  });

  it('omits contributor claims entirely when the section is not requested, even though the claim exists', () => {
    const { bundle, dossier } = buildFixtureWithClaim();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['project'],
    });

    expect(pkg.omittedSections).toContain('contributorClaims');
    expect(pkg.sections.contributorClaims).toBeUndefined();
    expect('contributorClaims' in pkg.sections).toBe(false);
    // The claim is never smuggled into another requested section.
    expect(JSON.stringify(pkg.sections)).not.toMatch(/profile-delivery-claimant/);
  });

  it('never synthesizes rights/ownership fields alongside contributor claims', () => {
    const { bundle, dossier } = buildFixtureWithClaim();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'label',
      purpose: 'licensing',
      includeSections: ['contributorClaims', 'disclaimers'],
    });

    for (const claim of pkg.sections.contributorClaims!) {
      expect(Object.keys(claim).sort()).toEqual(
        [...new Set(['id', 'profileId', 'role', 'claimedAt', ...(('subrole' in claim) ? ['subrole'] : []), ...(('description' in claim) ? ['description'] : [])])].sort(),
      );
    }
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toMatch(/"(ownership|copyright|royalty|rightsHolder|verifiedContributor|officialCredit)":/i);
  });
});

describe('buildDeliveryPackage — assets section', () => {
  function buildFixtureWithAsset(): { bundle: EvidenceBundleExport; dossier: ProjectDossier; asset: ReturnType<typeof createProjectAsset> } {
    const projectId = asProjectId('project-delivery-assets');
    const deviceId = asDeviceId('device-delivery-assets-01');
    const sessionId = asSessionId('session-delivery-assets-01');

    const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-assets-db-'), 'evidence.db'));
    store.insertDevice(
      createStudioDevice({
        id: deviceId,
        profileId: asProfileId('profile-delivery-assets'),
        devicePublicId: 'pub-delivery-assets',
        platform: 'macos',
        appVersion: '1.0.0',
        deviceKeyFingerprint: 'b'.repeat(64),
      }),
      Buffer.from('not-a-real-key'),
      '2026-01-01T00:00:00.000Z',
    );
    store.insertSession(
      createStudioSession({
        id: sessionId,
        projectId,
        actorProfileId: asProfileId('profile-delivery-assets'),
        deviceId,
        daw: 'fl_studio',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
      '2026-01-01T00:00:00.000Z',
    );
    const asset = createProjectAsset({
      id: asAssetId('asset-delivery-01'),
      projectId,
      introducedBySessionId: sessionId,
      assetType: 'stem',
      sourceType: 'human_created',
      originalFilename: 'delivery_stem.wav',
      sha256: '7'.repeat(64),
      firstSeenAt: '2026-01-01T00:04:00.000Z',
    });
    store.insertProjectAsset(asset, '2026-01-01T00:05:00.000Z');

    const bundle = assembleEvidenceBundle(store, { projectId, exportedAt: EXPORTED_AT });
    store.close();
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    return { bundle, dossier, asset };
  }

  it('carries the asset inventory through when the assets section is requested', () => {
    const { bundle, dossier } = buildFixtureWithAsset();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['assets'],
    });

    expect(pkg.includedSections).toEqual(['assets']);
    expect(pkg.sections.assets).toEqual(dossier.assetInventory);
    expect(pkg.sections.assets).toHaveLength(1);
    expect(pkg.sections.assets![0]!.assetType).toBe('stem');
  });

  it('omits the asset inventory entirely when the section is not requested, even though the asset exists', () => {
    const { bundle, dossier } = buildFixtureWithAsset();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['project'],
    });

    expect(pkg.omittedSections).toContain('assets');
    expect(pkg.sections.assets).toBeUndefined();
    expect('assets' in pkg.sections).toBe(false);
    // The asset is never smuggled into another requested section.
    expect(JSON.stringify(pkg.sections)).not.toMatch(/delivery_stem\.wav/);
  });

  it('requesting assets without contributorClaims (and the reverse) never bundles one into the other', () => {
    const { bundle, dossier } = buildFixtureWithAsset();

    const assetsOnly = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['assets'],
    });
    expect(assetsOnly.sections.contributorClaims).toBeUndefined();
    expect('contributorClaims' in assetsOnly.sections).toBe(false);

    const claimsOnly = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['contributorClaims'],
    });
    expect(claimsOnly.sections.assets).toBeUndefined();
    expect('assets' in claimsOnly.sections).toBe(false);
  });

  it('never synthesizes rights/ownership fields alongside the asset inventory', () => {
    const { bundle, dossier } = buildFixtureWithAsset();

    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'label',
      purpose: 'licensing',
      includeSections: ['assets', 'disclaimers'],
    });

    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toMatch(/"(ownership|copyright|royalty|rightsHolder|verifiedContributor|officialCredit|lineage)":/i);
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

describe('buildDeliveryPackage — Cold Nights end-to-end contributor claims', () => {
  it('carries NightWire\'s producer/songwriter claims and Marcus\'s lead-guitar claim from persistence through bundle, dossier, and delivery package, remaining claims throughout', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.contributors).toHaveLength(3);

    const store = new LocalEvidenceStore(join(makeTempDir('flow-delivery-cold-nights-claims-db-'), 'evidence.db'));
    for (const claim of scenario.contributors) {
      store.insertContributorReference(claim, claim.claimedAt);
    }
    const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    store.close();

    // --- Evidence Bundle: full domain objects, exactly the persisted claims.
    expect(bundle.contributorClaims).toEqual(
      [...scenario.contributors].sort((a, b) => (a.claimedAt !== b.claimedAt ? (a.claimedAt < b.claimedAt ? -1 : 1) : a.id < b.id ? -1 : 1)),
    );

    // --- Project Dossier: same claims, human-readable, still labeled as claims.
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    expect(dossier.contributorClaims).toHaveLength(3);
    const producer = dossier.contributorClaims.find((c) => c.role === 'producer');
    const songwriter = dossier.contributorClaims.find((c) => c.role === 'songwriter');
    const musician = dossier.contributorClaims.find((c) => c.role === 'musician');
    expect(producer).toMatchObject({ profileId: scenario.nightwireSession.actorProfileId, subrole: 'producer' });
    expect(songwriter).toMatchObject({ profileId: scenario.nightwireSession.actorProfileId, subrole: 'melody' });
    expect(musician).toMatchObject({ profileId: scenario.marcusSession.actorProfileId, subrole: 'lead_guitar' });

    // --- Delivery Package: reaches a recipient only through the explicit section.
    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['contributorClaims', 'project'],
    });
    expect(pkg.sections.contributorClaims).toEqual(dossier.contributorClaims);
    expect(pkg.sections.contributorClaims).toHaveLength(3);

    // Still self-reported claims, never rights/ownership/verification language.
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toMatch(/"(verified|ownership|copyright|royalty|rightsHolder)":/i);
  });
});

describe('buildDeliveryPackage — Cold Nights end-to-end asset persistence', () => {
  it('carries the six Cold Nights assets (MIDI, sample, stem, guitar take, mix, master) from persistence, through a store close/reopen, through bundle, dossier, and delivery package', () => {
    const scenario = runColdNightsScenario();
    const allAssets = Object.values(scenario.assets);
    expect(allAssets).toHaveLength(6);

    const dbPath = join(makeTempDir('flow-delivery-cold-nights-assets-db-'), 'evidence.db');
    const store = new LocalEvidenceStore(dbPath);
    store.insertDevice(scenario.nightwireDevice, Buffer.from('not-a-real-key-nightwire'), scenario.nightwireSession.startedAt);
    store.insertDevice(scenario.marcusDevice, Buffer.from('not-a-real-key-marcus'), scenario.marcusSession.startedAt);
    store.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
    store.insertSession(scenario.marcusSession, scenario.marcusSession.startedAt);
    for (const asset of allAssets) {
      store.insertProjectAsset(asset, asset.firstSeenAt);
    }
    store.close();

    // --- Close/reopen: assets must survive a real store restart, not just an in-process read.
    const reopened = new LocalEvidenceStore(dbPath);
    const reloaded = reopened.listProjectAssetsForProject(scenario.project.id);
    expect(reloaded).toHaveLength(6);
    expect(reloaded).toEqual([...allAssets].sort((a, b) => (a.firstSeenAt !== b.firstSeenAt ? (a.firstSeenAt < b.firstSeenAt ? -1 : 1) : a.id < b.id ? -1 : 1)));

    // --- Evidence Bundle: full domain objects, exactly the persisted assets.
    const bundle = assembleEvidenceBundle(reopened, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
    reopened.close();
    expect(bundle.assets).toHaveLength(6);
    expect(new Set(bundle.assets.map((a) => a.id))).toEqual(new Set(allAssets.map((a) => a.id)));

    // --- Project Dossier: same assets, human-readable, no lineage/rights fabricated.
    const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
    expect(dossier.assetInventory).toHaveLength(6);
    const master = dossier.assetInventory.find((a) => a.assetType === 'master');
    expect(master).toMatchObject({ id: scenario.assets.master.id, originalFilename: 'cold_nights_final_master.wav' });
    expect(JSON.stringify(dossier.assetInventory)).not.toMatch(/"(rightsStatus|ownership|verified|lineage|relationship|derivedFrom)":/i);

    // --- createdByProfileId never manufactures a contributor claim: this
    // test never called insertContributorReference, so the claims list
    // must stay empty regardless of how many assets exist and who
    // "created" each one.
    expect(dossier.contributorClaims).toEqual([]);

    // --- The relationship graph (midi->stem, stem/guitar->mix, mix->master)
    // remains entirely in-memory/unpersisted for this batch — no store
    // table or export field for AssetRelationship exists yet.
    expect(scenario.relationships.length).toBeGreaterThan(0);

    // --- Delivery Package: reaches a recipient only through the explicit section.
    const pkg = buildDeliveryPackage(bundle, dossier, {
      createdAt: CREATED_AT,
      audience: 'collaborator',
      purpose: 'review',
      includeSections: ['assets', 'project'],
    });
    expect(pkg.sections.assets).toEqual(dossier.assetInventory);
    expect(pkg.sections.assets).toHaveLength(6);

    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toMatch(/"(verified|ownership|copyright|royalty|rightsHolder|lineage)":/i);
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
