/**
 * Generates the ONE static fixture Capture Studio Shell V1 renders.
 *
 * This script runs in Node (via `tsx`), never in the browser -- it is the
 * one and only place this app touches the real Capture engine
 * (`../../../src/*`), because the engine's hashing/store code depends on
 * `node:crypto`/`node:sqlite`, neither of which exist in a browser bundle.
 * Everything it produces is REAL engine output -- not hand-authored fake
 * JSON pretending to be engine output. The app then imports the frozen
 * result as static data and never re-executes any engine code.
 *
 * REAL PERSISTED PATH (as of ProjectAsset Persistence V1, PR #8, now
 * merged into `main`): the Cold Nights scenario's six assets are inserted
 * into a real, FILE-BACKED `LocalEvidenceStore` via `insertProjectAsset`,
 * the store is genuinely CLOSED and REOPENED (proving durability, not
 * just an in-memory session), and only THEN are `listProjectAssetsForProject`,
 * `assembleEvidenceBundle`, `buildProjectDossier`, and `buildDeliveryPackage`
 * called against the reopened store. `bundle.assets`, `dossier.assetInventory`,
 * and the Delivery Package `assets` section in this fixture are therefore
 * genuinely persisted-and-reloaded data, not a bypass of the store.
 *
 * STILL DEMO/IN-MEMORY ONLY: `AssetRelationship` persistence does not
 * exist anywhere in this codebase yet, so `relationships` below comes
 * straight from the simulator's in-memory scenario, never a store. The
 * UI must only ever show it behind an explicit "demo relationship graph"
 * label -- never presented as persisted truth. Same for `ReleaseCandidate`
 * state, which this fixture does not carry at all.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runColdNightsScenario } from '../../../src/simulator/coldNights.js';
import { FileDeviceKeyStore } from '../../../src/device/keyStore.js';
import { loadDeterministicFixtureIdentity } from './fixtureDeviceKeys.js';
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

  const workDir = mkdtempSync(join(tmpdir(), 'flow-capture-studio-fixture-'));
  const keyStore = new FileDeviceKeyStore(join(workDir, 'keys'));
  const dbPath = join(workDir, 'evidence.db');

  // Deterministic, fixture-only key material (see fixtureDeviceKeys.ts) —
  // not a fresh CSPRNG-generated keypair on every run. Production device
  // identity (`createDeviceIdentity`) is completely untouched and still
  // always uses the real CSPRNG; this fixture is the one, narrow,
  // documented exception. This is what makes every downstream hash in
  // this fixture (signatures, integrityManifest.canonicalHash, delivery
  // package hashes) byte-for-byte identical across regenerations.
  const nightwireIdentity = loadDeterministicFixtureIdentity(keyStore, scenario.nightwireDevice.id, 'nightwire');
  const marcusIdentity = loadDeterministicFixtureIdentity(keyStore, scenario.marcusDevice.id, 'marcus');

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

  // --- Write phase: a real, file-backed store, not :memory:. ---------------
  const writeStore = new LocalEvidenceStore(dbPath);
  writeStore.insertDevice(scenario.nightwireDevice, nightwireIdentity.publicKeySpkiDer, scenario.nightwireSession.startedAt);
  writeStore.insertDevice(scenario.marcusDevice, marcusIdentity.publicKeySpkiDer, scenario.marcusSession.startedAt);
  writeStore.insertSession(scenario.nightwireSession, scenario.nightwireSession.startedAt);
  writeStore.insertSession(scenario.marcusSession, scenario.marcusSession.startedAt);
  if (scenario.nightwireSession.endedAt !== undefined) {
    writeStore.endSession(scenario.nightwireSession.id, scenario.nightwireSession.endedAt, 'ended', scenario.nightwireSession.endedAt);
  }
  if (scenario.marcusSession.endedAt !== undefined) {
    writeStore.endSession(scenario.marcusSession.id, scenario.marcusSession.endedAt, 'ended', scenario.marcusSession.endedAt);
  }
  writeStore.insertEvidenceBundle({
    events: nightwireEvents,
    checkpoint: scenario.checkpoints[0],
    batch: nightwireBatch,
    storedAt: scenario.nightwireSession.endedAt ?? scenario.nightwireSession.startedAt,
  });
  writeStore.insertEvidenceBundle({
    events: marcusEvents,
    checkpoint: scenario.checkpoints[1],
    storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
  });
  writeStore.insertEvidenceBundle({
    checkpoint: scenario.checkpoints[2],
    batch: marcusBatch,
    storedAt: scenario.marcusSession.endedAt ?? scenario.marcusSession.startedAt,
  });
  for (const claim of scenario.contributors) {
    writeStore.insertContributorReference(claim, claim.claimedAt);
  }
  // The six real ProjectAsset domain objects, persisted for real via the
  // real store API -- MIDI, sample, stem, guitar take, mix, master.
  for (const asset of Object.values(scenario.assets)) {
    writeStore.insertProjectAsset(asset, asset.firstSeenAt);
  }
  writeStore.close();

  // --- Reopen phase: a genuinely new store instance over the same file. ---
  // Proves durability (not just reading back an in-memory session) before
  // anything downstream (bundle/dossier/delivery) is assembled.
  const reopenedStore = new LocalEvidenceStore(dbPath);
  const persistedAssets = reopenedStore.listProjectAssetsForProject(scenario.project.id);
  if (persistedAssets.length !== 6) {
    throw new Error(`Expected 6 persisted assets after reopen, found ${persistedAssets.length}`);
  }

  const bundle = assembleEvidenceBundle(reopenedStore, { projectId: scenario.project.id, exportedAt: EXPORTED_AT });
  if (bundle.assets.length !== 6) {
    throw new Error(`Expected bundle.assets to contain 6 persisted assets, found ${bundle.assets.length}`);
  }
  const dossier = buildProjectDossier(bundle, { generatedAt: GENERATED_AT });
  if (dossier.assetInventory.length !== 6) {
    throw new Error(`Expected dossier.assetInventory to contain 6 entries, found ${dossier.assetInventory.length}`);
  }

  // Two real, differently-scoped packages -- demonstrating that selective
  // disclosure is genuine, not cosmetic: the licensing package is visibly
  // narrower than the collaborator package (no assets, no contributor
  // claims, no participant activity), because privacy-by-default means a
  // section is only ever present when explicitly requested.
  const collaboratorPackage = buildDeliveryPackage(bundle, dossier, {
    createdAt: CREATED_AT,
    audience: 'collaborator',
    purpose: 'review',
    includeSections: ['project', 'participants', 'contributorClaims', 'assets', 'activity', 'trustSummary', 'disclaimers'],
  });
  const labelPackage = buildDeliveryPackage(bundle, dossier, {
    createdAt: CREATED_AT,
    audience: 'label',
    purpose: 'licensing',
    includeSections: ['project', 'trustSummary', 'disclaimers'],
  });
  if (collaboratorPackage.sections.assets === undefined || collaboratorPackage.sections.assets.length !== 6) {
    throw new Error('Expected the collaborator Delivery Package to carry all 6 persisted assets');
  }
  if (labelPackage.sections.assets !== undefined) {
    throw new Error('Expected the label Delivery Package to omit assets (not requested) -- privacy-by-default regression');
  }

  reopenedStore.close();
  rmSync(workDir, { recursive: true, force: true });

  const fixture = {
    schemaNote:
      'Real FLOW Creative Capture engine output for the Cold Nights demo scenario, generated once by scripts/generateFixture.ts and frozen as static data. All six assets, the Evidence Bundle, Project Dossier, and Delivery Packages below were produced by genuinely persisting to a file-backed LocalEvidenceStore, closing it, reopening it, and reading back through the real assembleEvidenceBundle/buildProjectDossier/buildDeliveryPackage pipeline -- not a bypass. relationships is the one exception: AssetRelationship has no persistence anywhere in this codebase yet, so it is carried through directly from the in-memory simulator scenario and must only ever be shown in the UI behind an explicit demo-graph label. Nothing in this file is live or interactive.',
    generatedAt: GENERATED_AT,
    project: scenario.project,
    workReference: scenario.workReference,
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
  console.log(`Wrote ${outPath} -- ${persistedAssets.length} persisted assets verified through close/reopen.`);
}

main();
