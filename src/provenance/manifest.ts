import type { JsonValue } from '../crypto/json.js';
import { hashCanonicalValue } from '../crypto/sha256.js';
import type { AssetId, EventId, ProjectId, WorkReferenceId } from '../domain/ids.js';
import type { AssetType } from '../domain/enums.js';

/**
 * A checkpoint manifest summarizes meaningful project state at a point in
 * time — the set of known assets (by id + fingerprint) and the events
 * folded in since the previous checkpoint. It deliberately does NOT embed
 * whole DAW project files; that would make every checkpoint enormous and
 * would hash volatile bytes (e.g. UI window state) that carry no
 * provenance meaning.
 */
export interface CheckpointManifestAssetEntry {
  readonly assetId: AssetId;
  readonly sha256: string;
  readonly assetType: AssetType;
}

export interface CheckpointManifestInput {
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  assets: readonly CheckpointManifestAssetEntry[];
  eventIds: readonly EventId[];
}

export interface CheckpointManifest {
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly assets: readonly CheckpointManifestAssetEntry[];
  readonly eventIds: readonly EventId[];
}

/** Builds a manifest with assets in deterministic (assetId-sorted) order. */
export function buildCheckpointManifest(input: CheckpointManifestInput): CheckpointManifest {
  const assets = [...input.assets].sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));

  return Object.freeze({
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    assets: Object.freeze(assets),
    // eventIds order is semantic (chronological application order) — never sorted.
    eventIds: Object.freeze([...input.eventIds]),
  });
}

function manifestToJsonValue(manifest: CheckpointManifest): JsonValue {
  return {
    projectId: manifest.projectId,
    ...(manifest.workReference !== undefined ? { workReference: manifest.workReference } : {}),
    assets: manifest.assets.map((asset) => ({
      assetId: asset.assetId,
      sha256: asset.sha256,
      assetType: asset.assetType,
    })),
    eventIds: [...manifest.eventIds],
  };
}

export function hashCheckpointManifest(manifest: CheckpointManifest): string {
  return hashCanonicalValue(manifestToJsonValue(manifest));
}
