import type { ExternalProjectPassportId, OrganizationId, ProfileId, ProjectId } from './ids.js';
import { PROJECT_STATUSES, PROJECT_TYPES, type ProjectStatus, type ProjectType } from './enums.js';

export interface CreativeProject {
  readonly id: ProjectId;
  readonly ownerProfileId: ProfileId;
  readonly organizationId?: OrganizationId;
  readonly externalProjectPassportId?: ExternalProjectPassportId;
  readonly title: string;
  readonly projectType: ProjectType;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreativeProjectInput {
  id: ProjectId;
  ownerProfileId: ProfileId;
  organizationId?: OrganizationId;
  externalProjectPassportId?: ExternalProjectPassportId;
  title: string;
  projectType: ProjectType;
  status?: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export function createCreativeProject(input: CreativeProjectInput): CreativeProject {
  if (input.title.trim().length === 0) {
    throw new Error('CreativeProject.title must not be empty');
  }
  if (!PROJECT_TYPES.includes(input.projectType)) {
    throw new Error(`CreativeProject.projectType "${input.projectType}" is not a recognized project type`);
  }
  const status = input.status ?? 'draft';
  if (!PROJECT_STATUSES.includes(status)) {
    throw new Error(`CreativeProject.status "${status}" is not a recognized status`);
  }

  return Object.freeze({
    id: input.id,
    ownerProfileId: input.ownerProfileId,
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.externalProjectPassportId !== undefined
      ? { externalProjectPassportId: input.externalProjectPassportId }
      : {}),
    title: input.title,
    projectType: input.projectType,
    status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}
