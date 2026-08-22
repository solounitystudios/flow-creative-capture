import type { CheckpointId, HandoffId, ProfileId, ProjectId, WorkReferenceId } from './ids.js';
import { isSha256Hex } from '../crypto/sha256.js';
import { HANDOFF_STATUSES, type HandoffStatus } from './enums.js';

/**
 * Establishes: sender created exact state X, sent it to recipient,
 * recipient accepted X, recipient's subsequent work began from X.
 */
export interface ProjectHandoff {
  readonly id: HandoffId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly senderProfileId: ProfileId;
  readonly recipientProfileId: ProfileId;
  readonly checkpointId: CheckpointId;
  readonly manifestHash: string;
  readonly status: HandoffStatus;
  readonly sentAt: string;
  readonly acceptedAt?: string;
}

export interface ProjectHandoffInput {
  id: HandoffId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  senderProfileId: ProfileId;
  recipientProfileId: ProfileId;
  checkpointId: CheckpointId;
  manifestHash: string;
  status?: HandoffStatus;
  sentAt: string;
  acceptedAt?: string;
}

export function createProjectHandoff(input: ProjectHandoffInput): ProjectHandoff {
  if (input.senderProfileId === input.recipientProfileId) {
    throw new Error('ProjectHandoff sender and recipient cannot be the same profile');
  }
  if (!isSha256Hex(input.manifestHash)) {
    throw new Error('ProjectHandoff.manifestHash must be a valid SHA-256 hex digest');
  }
  const status = input.status ?? 'pending';
  if (!HANDOFF_STATUSES.includes(status)) {
    throw new Error(`ProjectHandoff.status "${status}" is not recognized`);
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    senderProfileId: input.senderProfileId,
    recipientProfileId: input.recipientProfileId,
    checkpointId: input.checkpointId,
    manifestHash: input.manifestHash,
    status,
    sentAt: input.sentAt,
    ...(input.acceptedAt !== undefined ? { acceptedAt: input.acceptedAt } : {}),
  });
}

export function acceptProjectHandoff(handoff: ProjectHandoff, acceptedAt: string): ProjectHandoff {
  if (handoff.status !== 'pending') {
    throw new Error(`ProjectHandoff ${handoff.id} cannot be accepted from status "${handoff.status}"`);
  }
  if (acceptedAt < handoff.sentAt) {
    throw new Error('ProjectHandoff.acceptedAt cannot precede sentAt');
  }
  return Object.freeze({ ...handoff, status: 'accepted', acceptedAt });
}
