import type { OrganizationId, ProfileId, ProjectId, RightsClaimId, WorkReferenceId } from './ids.js';
import { RIGHTS_TYPES, RIGHTS_VERIFICATION_STATUSES, type RightsType, type RightsVerificationStatus } from './enums.js';

/**
 * A REFERENCE to a rights claim, not an adjudication of one. Creative
 * Capture records that a claim exists and points at where its supporting
 * evidence lives; it never computes, infers, or verifies rights from
 * provenance data. Legal ownership decisions belong to flow-platform (and,
 * ultimately, to people).
 */
export interface RightsClaimReference {
  readonly id: RightsClaimId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly claimantProfileId?: ProfileId;
  readonly claimantOrganizationId?: OrganizationId;
  readonly rightsType: RightsType;
  readonly claimedShare?: number;
  readonly verificationStatus: RightsVerificationStatus;
  readonly externalEvidenceReference?: string;
}

export interface RightsClaimReferenceInput {
  id: RightsClaimId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  claimantProfileId?: ProfileId;
  claimantOrganizationId?: OrganizationId;
  rightsType: RightsType;
  claimedShare?: number;
  verificationStatus?: RightsVerificationStatus;
  externalEvidenceReference?: string;
}

export function createRightsClaimReference(input: RightsClaimReferenceInput): RightsClaimReference {
  if (!RIGHTS_TYPES.includes(input.rightsType)) {
    throw new Error(`RightsClaimReference.rightsType "${input.rightsType}" is not recognized`);
  }
  if (input.claimantProfileId === undefined && input.claimantOrganizationId === undefined) {
    throw new Error('RightsClaimReference requires a claimantProfileId or claimantOrganizationId');
  }
  if (input.claimedShare !== undefined && (input.claimedShare < 0 || input.claimedShare > 1)) {
    throw new Error('RightsClaimReference.claimedShare must be between 0 and 1');
  }
  const verificationStatus = input.verificationStatus ?? 'claimed';
  if (!RIGHTS_VERIFICATION_STATUSES.includes(verificationStatus)) {
    throw new Error(`RightsClaimReference.verificationStatus "${verificationStatus}" is not recognized`);
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    ...(input.claimantProfileId !== undefined ? { claimantProfileId: input.claimantProfileId } : {}),
    ...(input.claimantOrganizationId !== undefined ? { claimantOrganizationId: input.claimantOrganizationId } : {}),
    rightsType: input.rightsType,
    ...(input.claimedShare !== undefined ? { claimedShare: input.claimedShare } : {}),
    verificationStatus,
    ...(input.externalEvidenceReference !== undefined
      ? { externalEvidenceReference: input.externalEvidenceReference }
      : {}),
  });
}
