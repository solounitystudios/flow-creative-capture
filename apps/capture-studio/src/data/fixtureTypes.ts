/**
 * Type-only view over the generated Cold Nights fixture. Every import
 * here is `import type` -- erased entirely at compile time, so this file
 * has ZERO runtime dependency on the core engine (no `node:crypto`,
 * `node:sqlite`, or any of it ends up in the browser bundle). The actual
 * data comes from the static JSON `scripts/generateFixture.ts` produced by
 * really running that engine in Node -- see that script's docstring.
 *
 * `bundle.assets` / `dossier.assetInventory` / each Delivery Package's
 * `sections.assets` are the REAL, PERSISTED asset path (ProjectAsset
 * Persistence V1, PR #8) -- genuinely written to a file-backed store,
 * closed, reopened, and read back before assembly. `relationships` is the
 * one field that is NOT persisted anywhere yet (AssetRelationship has no
 * store table) -- see this type's own docstring below.
 */
import type { CreativeProject } from '../../../../src/domain/creativeProject.js';
import type { WorkReference } from '../../../../src/domain/workReference.js';
import type { AssetRelationship } from '../../../../src/domain/assetRelationship.js';
import type { EvidenceBundleExport } from '../../../../src/evidence/bundle.js';
import type { ProjectDossier } from '../../../../src/documents/dossier.js';
import type { DeliveryPackage } from '../../../../src/documents/deliveryPackage.js';

import fixtureJson from './coldNightsFixture.generated.json';

export interface ColdNightsFixture {
  readonly schemaNote: string;
  readonly generatedAt: string;
  readonly project: CreativeProject;
  readonly workReference: WorkReference;
  /**
   * Real `AssetRelationship` edges from the simulator -- entirely
   * in-memory, never persisted anywhere in this codebase yet (no store
   * table exists for it). Shown in the UI ONLY behind an explicit "demo
   * relationship graph" label -- see the Usage tab in the asset inspector.
   * Never presented as persisted truth.
   */
  readonly relationships: readonly AssetRelationship[];
  /** Real, persisted-and-reloaded Evidence Bundle -- includes `assets`. */
  readonly bundle: EvidenceBundleExport;
  /** Real Project Dossier derived from `bundle` -- includes `assetInventory`. */
  readonly dossier: ProjectDossier;
  readonly deliveryPackages: {
    readonly collaboratorReview: DeliveryPackage;
    readonly labelLicensing: DeliveryPackage;
  };
}

export const coldNightsFixture = fixtureJson as unknown as ColdNightsFixture;
