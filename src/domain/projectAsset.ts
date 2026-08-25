import type { AssetId, ProfileId, ProjectId, SessionId, WorkReferenceId } from './ids.js';
import { isSha256Hex } from '../crypto/sha256.js';
import {
  ASSET_TYPES,
  ORIGIN_STATUSES,
  SOURCE_TYPES,
  type AssetType,
  type OriginStatus,
  type SourceType,
} from './enums.js';
import type { RightsVerificationStatus } from './enums.js';

/**
 * A single piece of actual creative material (a file, in effect) known to
 * exist in a project — immutable factual metadata about it, never a file
 * manager. See `createProjectAsset` and each field below for exact V1
 * semantics; nothing here is or implies a `ContributorReference`
 * (`src/domain/contributorReference.ts`), a verified credit, or a
 * rights/ownership determination — see PROVENANCE_SPEC.md §3.
 */
export interface ProjectAsset {
  readonly id: AssetId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  /**
   * V1 SEMANTICS, DELIBERATELY NARROW: the profile the caller is recording
   * as the source of THIS SPECIFIC FILE — e.g. who rendered/exported it,
   * or whose take it is. It is NOT, and must never be read as:
   *  - a performer/songwriter/producer credit,
   *  - proof of authorship,
   *  - a `ContributorReference` (a project-level, self-reported ROLE
   *    claim — see `src/domain/contributorReference.ts` — which is a
   *    wholly separate record a caller must construct on its own; this
   *    field never auto-generates or implies one),
   *  - legal ownership or copyright.
   * It commonly equals `introducedBySessionId`'s own `actorProfileId`
   * (the person operating Capture for that session also produced the
   * file), but the two are independent fields on purpose: an engineer
   * running a session can press Record for someone else's performance, or
   * introduce/import an asset nobody in this profile's chain actually
   * created (e.g. a purchased sample — see `sourceType`), so this field is
   * optional and may legitimately be omitted, or may name someone other
   * than the session's own actor, without that being an error. Left
   * unset, no default or inference is applied — omission is a true "not
   * recorded," not "unknown."
   */
  readonly createdByProfileId?: ProfileId;
  readonly introducedBySessionId: SessionId;
  readonly assetType: AssetType;
  readonly sourceType: SourceType;
  readonly originalFilename?: string;
  readonly sha256: string;
  readonly sizeBytes?: number;
  readonly firstSeenAt: string;
  readonly originStatus: OriginStatus;
  readonly rightsStatus?: RightsVerificationStatus;
}

export interface ProjectAssetInput {
  id: AssetId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  createdByProfileId?: ProfileId;
  introducedBySessionId: SessionId;
  assetType: AssetType;
  sourceType: SourceType;
  originalFilename?: string;
  sha256: string;
  sizeBytes?: number;
  firstSeenAt: string;
  originStatus?: OriginStatus;
  rightsStatus?: RightsVerificationStatus;
}

export function createProjectAsset(input: ProjectAssetInput): ProjectAsset {
  if (!ASSET_TYPES.includes(input.assetType)) {
    throw new Error(`ProjectAsset.assetType "${input.assetType}" is not recognized`);
  }
  if (!SOURCE_TYPES.includes(input.sourceType)) {
    throw new Error(`ProjectAsset.sourceType "${input.sourceType}" is not recognized`);
  }
  if (!isSha256Hex(input.sha256)) {
    throw new Error(`ProjectAsset.sha256 "${input.sha256}" is not a valid lowercase hex SHA-256 digest`);
  }
  if (input.sizeBytes !== undefined && input.sizeBytes < 0) {
    throw new Error('ProjectAsset.sizeBytes cannot be negative');
  }
  const originStatus = input.originStatus ?? 'declared';
  if (!ORIGIN_STATUSES.includes(originStatus)) {
    throw new Error(`ProjectAsset.originStatus "${originStatus}" is not recognized`);
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    ...(input.createdByProfileId !== undefined ? { createdByProfileId: input.createdByProfileId } : {}),
    introducedBySessionId: input.introducedBySessionId,
    assetType: input.assetType,
    sourceType: input.sourceType,
    ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
    sha256: input.sha256.toLowerCase(),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    firstSeenAt: input.firstSeenAt,
    originStatus,
    ...(input.rightsStatus !== undefined ? { rightsStatus: input.rightsStatus } : {}),
  });
}
