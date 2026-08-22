import type { ExternalProjectPassportId, ProjectId, WorkReferenceId } from './ids.js';

/**
 * A reference to a flow-platform Work Passport. Creative Capture does not
 * own Work Passports — it only carries a pointer so evidence produced here
 * can later be attached upstream.
 */
export interface WorkReference {
  readonly id: WorkReferenceId;
  readonly projectId: ProjectId;
  readonly externalWorkPassportId?: ExternalProjectPassportId;
  readonly title: string;
  readonly createdAt: string;
}

export interface WorkReferenceInput {
  id: WorkReferenceId;
  projectId: ProjectId;
  externalWorkPassportId?: ExternalProjectPassportId;
  title: string;
  createdAt: string;
}

export function createWorkReference(input: WorkReferenceInput): WorkReference {
  if (input.title.trim().length === 0) {
    throw new Error('WorkReference.title must not be empty');
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.externalWorkPassportId !== undefined
      ? { externalWorkPassportId: input.externalWorkPassportId }
      : {}),
    title: input.title,
    createdAt: input.createdAt,
  });
}
