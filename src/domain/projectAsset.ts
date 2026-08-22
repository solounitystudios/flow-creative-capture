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

export interface ProjectAsset {
  readonly id: AssetId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
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
