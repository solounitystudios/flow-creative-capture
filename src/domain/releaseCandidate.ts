import type { AssetId, CheckpointId, ProfileId, ProjectId, ReleaseCandidateId, WorkReferenceId } from './ids.js';
import { RELEASE_CANDIDATE_STATUSES, type ReleaseCandidateStatus } from './enums.js';

/**
 * A designated master (or mix) version. Designating a new release candidate
 * NEVER overwrites a previous one — prior masters are superseded, not
 * deleted, so "Master v1" and "Master v2" both remain independently
 * identifiable and traceable.
 */
export interface ReleaseCandidate {
  readonly id: ReleaseCandidateId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly assetId: AssetId;
  readonly checkpointId: CheckpointId;
  readonly versionLabel: string;
  readonly status: ReleaseCandidateStatus;
  readonly designatedBy: ProfileId;
  readonly designatedAt: string;
}

export interface ReleaseCandidateInput {
  id: ReleaseCandidateId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  assetId: AssetId;
  checkpointId: CheckpointId;
  versionLabel: string;
  status?: ReleaseCandidateStatus;
  designatedBy: ProfileId;
  designatedAt: string;
}

export function createReleaseCandidate(input: ReleaseCandidateInput): ReleaseCandidate {
  if (input.versionLabel.trim().length === 0) {
    throw new Error('ReleaseCandidate.versionLabel must not be empty');
  }
  const status = input.status ?? 'proposed';
  if (!RELEASE_CANDIDATE_STATUSES.includes(status)) {
    throw new Error(`ReleaseCandidate.status "${status}" is not recognized`);
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    assetId: input.assetId,
    checkpointId: input.checkpointId,
    versionLabel: input.versionLabel,
    status,
    designatedBy: input.designatedBy,
    designatedAt: input.designatedAt,
  });
}

/**
 * Marks a prior release candidate as superseded. Returns a NEW record —
 * callers append it, they do not mutate or remove the original.
 */
export function supersedeReleaseCandidate(candidate: ReleaseCandidate): ReleaseCandidate {
  if (candidate.status !== 'designated' && candidate.status !== 'proposed') {
    throw new Error(`ReleaseCandidate ${candidate.id} cannot be superseded from status "${candidate.status}"`);
  }
  return Object.freeze({ ...candidate, status: 'superseded' });
}

export function designateReleaseCandidate(candidate: ReleaseCandidate): ReleaseCandidate {
  if (candidate.status !== 'proposed') {
    throw new Error(`ReleaseCandidate ${candidate.id} cannot be designated from status "${candidate.status}"`);
  }
  return Object.freeze({ ...candidate, status: 'designated' });
}
