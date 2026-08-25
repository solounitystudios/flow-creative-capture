/**
 * Generates the ONE static fixture Capture Studio Shell V1 renders.
 *
 * This script runs in Node (via `tsx`), never in the browser -- it is the
 * one and only place this app touches the real Capture engine
 * (`../../../src/*`), because the engine's hashing/store code depends on
 * `node:crypto`/`node:sqlite`, neither of which exist in a browser bundle.
 * Everything it produces is REAL engine output (the actual Cold Nights
 * scenario, actually persisted to a real in-memory `LocalEvidenceStore`,
 * actually assembled into a real `EvidenceBundleExport` /
 * `ProjectDossier` / two real `DeliveryPackage`s) -- not hand-authored
 * fake JSON pretending to be engine output. The app then imports the
 * frozen result as static data and never re-executes any engine code.
 *
 * `ProjectAsset` persistence (a `LocalEvidenceStore.insertProjectAsset`
 * method, an `assets` field on `EvidenceBundleExport`, etc.) is a
 * SEPARATE, not-yet-merged batch (see PR #8) -- it is not on `main`, which
 * is what this app branches from. So the asset data below comes directly
 * from `runColdNightsScenario()`'s own `assets` (still real, validated,
 * hashed `ProjectAsset` domain objects -- just not yet run through a
 * persisted store/bundle pipeline). The fixture and the UI are both
 * explicit about this: assets are demo-scenario data, not "queried from a
 * persisted store."
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runColdNightsScenario } from '../../../src/simulator/coldNights.js';
import { createDeviceIdentity } from '../../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../../src/device/keyStore.js';
import { signProvenanceBatch } from '../../../src/device/batchSigning.js';
import { createBatchFromEvents } from '../../../src/provenance/batch.js';
import { asBatchId } from '../../../src/domain/ids.js';
import { LocalEvidenceStore } from '../../../src/store/evidenceStore.js';
import { assembleEvidenceBundle } from '../../../src/evidence/bundle.js';
import { buildProjectDossier } from '../../../src/documents/dossier.js';
import { buildDeliveryPackage } from '../../../src/documents/deliveryPackage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORTED_AT = '2026-01-07T09:00:00.000Z';
const GENERATED_AT = '2026-01-07T09:05:00.000Z';
const CREATED_AT = '2026-01-07T09:10:00.000Z';

function main() {
  const scenario = runColdNightsScenario();

  const keyStoreDir = mkdtempSync(join(tmpdir(), 'flow-capture-studio-fixture-keystore-'));
  const keyStore = new FileDeviceKeyStore(keyStoreDir);
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

  const nightwireEvents = scenario.events.filter((e) => e.deviceId === scenario.nightwireDevice.id);
  const marcusEvents = scenario.events.filter((e) => e.deviceId === scenario.marcusDevice.id);

  const nightwireBatch = signProvenanceBatch(
    createBatchFromEvents({
      id: asBatchId('batch-fixture-nightwire-01'),
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
      id: asBatchId('batch-fixture-marcus-01'),
      profileId: scenario.marcusSession.actorProfileId,
      deviceId: scenario.marcusDevice.id,
      sessionId: scenario.marcusSession.id,
      events: marcusEvents,
      createdAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
    }),
    marcusIdentity,
  );

  const store = new LocalEvidenceStore(':memory:');
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
    checkpoint: scenario.checkpoints[0],
    batch: nightwireBatch,
    storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
  });
  store.insertEvidenceBundle({
    events: marcusEvents,
    checkpoint: scenario.checkpoints[1],
    storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
  });
  store.insertEvidenceBundle({
    checkpoint: scenario.checkpoints[2],
    batch: marcusBatch,
    storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
  });
  for (const claim of scenario.contributors) {
    store.insertContributorReference(claim, claim.claimedAt);
  }

  const bundle = assembleEvidenceBundle(store, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
  const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });

  // Two real, differently-scoped packages -- demonstrating that selective
  // disclosure is genuine, not cosmetic: the licensing package is visibly
  // narrower than the collaborator package, because privacy-by-default
  // means a section is only ever present when explicitly requested.
  const collaboratorPackage = buildDeliveryPackage(bundle, dossier, {
    createdAt: CREATED_AT,
    audience: 'collaborator',
    purpose: 'review',
    includeSections: ['project', 'participants', 'contributorClaims', 'activity', 'trustSummary', 'disclaimers'],
  });
  const labelPackage = buildDeliveryPackage(bundle, dossier, {
    createdAt: CREATED_AT,
    audience: 'label',
    purpose: 'licensing',
    includeSections: ['project', 'trustSummary', 'disclaimers'],
  });

  store.close();
  rmSync(keyStoreDir, { recursive: true, force: true });

  const fixture = {
    schemaNote:
      'Real FLOW Creative Capture engine output for the Cold Nights demo scenario, generated once by scripts/generateFixture.ts and frozen as static data. assets/relationships come directly from the simulator (not yet routed through a persisted store on this branch -- see PR #8). Nothing here is live or interactive.',
    generatedAt: GENERATED_AT,
    project: scenario.project,
    workReference: scenario.workReference,
    assets: scenario.assets,
    relationships: scenario.relationships,
    bundle,
    dossier,
    deliveryPackages: {
      collaboratorReview: collaboratorPackage,
      labelLicensing: labelPackage,
    },
  };

  const outPath = resolve(__dirname, '../src/data/coldNightsFixture.generated.json');
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
}

main();
