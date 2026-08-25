/**
 * Type-only view over the generated Cold Nights fixture. Every import
 * here is `import type` -- erased entirely at compile time, so this file
 * has ZERO runtime dependency on the core engine (no `node:crypto`,
 * `node:sqlite`, or any of it ends up in the browser bundle). The actual
 * data comes from the static JSON `scripts/generateFixture.ts` produced by
 * really running that engine in Node -- see that script's docstring.
 */
import type { CreativeProject } from '../../../../src/domain/creativeProject.js';
import type { WorkReference } from '../../../../src/domain/workReference.js';
import type { ProjectAsset } from '../../../../src/domain/projectAsset.js';
import type { AssetRelationship } from '../../../../src/domain/assetRelationship.js';
import type { EvidenceBundleExport } from '../../../../src/evidence/bundle.js';
import type { ProjectDossier } from '../../../../src/documents/dossier.js';
import type { DeliveryPackage } from '../../../../src/documents/deliveryPackage.js';

import fixtureJson from './coldNightsFixture.generated.json';

export interface ColdNightsAssets {
  readonly midi: ProjectAsset;
  readonly sample: ProjectAsset;
  readonly stem: ProjectAsset;
  readonly guitar: ProjectAsset;
  readonly mix: ProjectAsset;
  readonly master: ProjectAsset;
}

export interface ColdNightsFixture {
  readonly schemaNote: string;
  readonly generatedAt: string;
  readonly project: CreativeProject;
  readonly workReference: WorkReference;
  /**
   * Real `ProjectAsset` domain objects from the Cold Nights simulator.
   * NOT yet routed through a persisted store / Evidence Bundle on this
   * branch -- `ProjectAsset` persistence is a separate, not-yet-merged
   * batch (PR #8). Demo-scenario data, not "queried from a live store."
   */
  readonly assets: ColdNightsAssets;
  /**
   * Real `AssetRelationship` edges from the simulator -- entirely
   * in-memory, never persisted anywhere in this codebase yet. Shown in
   * the UI ONLY behind an explicit "demo relationship graph" label -- see
   * Usage tab in the asset inspector.
   */
  readonly relationships: readonly AssetRelationship[];
  readonly bundle: EvidenceBundleExport;
  readonly dossier: ProjectDossier;
  readonly deliveryPackages: {
    readonly collaboratorReview: DeliveryPackage;
    readonly labelLicensing: DeliveryPackage;
  };
}

export const coldNightsFixture = fixtureJson as unknown as ColdNightsFixture;
