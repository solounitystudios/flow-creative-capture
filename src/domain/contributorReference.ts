import type { ContributionClaimId, ProfileId, ProjectId } from './ids.js';
import { isValidSubrole, type ContributionRole } from './roles.js';

/**
 * An EXPLICIT, self-reported claim: "profileId claims role (subrole) on
 * projectId." This is a provenance-side SIGNAL only. It is NOT:
 *  - proof of project membership,
 *  - proof the person actually performed the work,
 *  - a verified contribution or verified credit,
 *  - a public credit,
 *  - legal ownership, copyright, publishing, master ownership, royalty
 *    entitlement, work-for-hire status, or split acceptance.
 * See AGENTS.md's trust model and PROVENANCE_SPEC.md §3.
 *
 * A ContributorReference is created ONLY by an explicit call to
 * `createContributorReference` — nothing in this codebase ever derives or
 * infers one from session/event/device activity. Rich activity in a
 * project with zero explicitly-created claims means zero contribution
 * claims exist for it, never a claim manufactured on activity's behalf.
 */
export interface ContributorReference {
  readonly id: ContributionClaimId;
  readonly projectId: ProjectId;
  readonly profileId: ProfileId;
  readonly role: ContributionRole;
  readonly subrole?: string;
  readonly description?: string;
  /**
   * When this claim was made, per the caller's own clock — never defaulted
   * to the wall clock (PROVENANCE_SPEC.md §12), same rule as every other
   * timestamp in this codebase.
   */
  readonly claimedAt: string;
}

export interface ContributorReferenceInput {
  id: ContributionClaimId;
  projectId: ProjectId;
  profileId: ProfileId;
  role: ContributionRole;
  subrole?: string;
  description?: string;
  claimedAt: string;
}

export function createContributorReference(input: ContributorReferenceInput): ContributorReference {
  if (input.subrole !== undefined && !isValidSubrole(input.role, input.subrole)) {
    throw new Error(`ContributorReference: "${input.subrole}" is not a valid subrole for role "${input.role}"`);
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    profileId: input.profileId,
    role: input.role,
    ...(input.subrole !== undefined ? { subrole: input.subrole } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    claimedAt: input.claimedAt,
  });
}
