import type { ProfileId } from './ids.js';
import { isValidSubrole, type ContributionRole } from './roles.js';

/**
 * A reference to a contributor's involvement, expressed in the canonical
 * role/subrole vocabulary. This is a provenance-side signal only — it is
 * NOT a verified credit and NOT a rights claim. See PROVENANCE_SPEC.md.
 */
export interface ContributorReference {
  readonly profileId: ProfileId;
  readonly role: ContributionRole;
  readonly subrole?: string;
  readonly description?: string;
}

export interface ContributorReferenceInput {
  profileId: ProfileId;
  role: ContributionRole;
  subrole?: string;
  description?: string;
}

export function createContributorReference(input: ContributorReferenceInput): ContributorReference {
  if (input.subrole !== undefined && !isValidSubrole(input.role, input.subrole)) {
    throw new Error(`ContributorReference: "${input.subrole}" is not a valid subrole for role "${input.role}"`);
  }

  return Object.freeze({
    profileId: input.profileId,
    role: input.role,
    ...(input.subrole !== undefined ? { subrole: input.subrole } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
}
