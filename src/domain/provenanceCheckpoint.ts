import type { CheckpointId, ProfileId, ProjectId, SessionId, WorkReferenceId } from './ids.js';
import { isSha256Hex } from '../crypto/sha256.js';
import { CHECKPOINT_TRIGGER_TYPES, type CheckpointTriggerType } from './enums.js';

/**
 * A tamper-evident checkpoint. `checkpointHash` is derived from
 * `manifestHash`, `previousCheckpointHash`, `sessionId`, `actorProfileId`,
 * and `createdAt` — see src/provenance/checkpoint.ts for the derivation.
 * This module only shapes and validates the resulting record; it does not
 * compute hashes itself, to keep the domain layer free of hashing policy.
 */
export interface ProvenanceCheckpoint {
  readonly id: CheckpointId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly sessionId: SessionId;
  readonly actorProfileId: ProfileId;
  readonly sequence: number;
  readonly previousCheckpointHash?: string;
  readonly manifestHash: string;
  readonly checkpointHash: string;
  readonly triggerType: CheckpointTriggerType;
  readonly createdAt: string;
}

export interface ProvenanceCheckpointInput {
  id: CheckpointId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  sessionId: SessionId;
  actorProfileId: ProfileId;
  sequence: number;
  previousCheckpointHash?: string;
  manifestHash: string;
  checkpointHash: string;
  triggerType: CheckpointTriggerType;
  createdAt: string;
}

export function createProvenanceCheckpoint(input: ProvenanceCheckpointInput): ProvenanceCheckpoint {
  if (!CHECKPOINT_TRIGGER_TYPES.includes(input.triggerType)) {
    throw new Error(`ProvenanceCheckpoint.triggerType "${input.triggerType}" is not recognized`);
  }
  if (!isSha256Hex(input.manifestHash)) {
    throw new Error('ProvenanceCheckpoint.manifestHash must be a valid SHA-256 hex digest');
  }
  if (!isSha256Hex(input.checkpointHash)) {
    throw new Error('ProvenanceCheckpoint.checkpointHash must be a valid SHA-256 hex digest');
  }
  if (input.previousCheckpointHash !== undefined && !isSha256Hex(input.previousCheckpointHash)) {
    throw new Error('ProvenanceCheckpoint.previousCheckpointHash must be a valid SHA-256 hex digest');
  }
  if (input.sequence < 0 || !Number.isInteger(input.sequence)) {
    throw new Error('ProvenanceCheckpoint.sequence must be a non-negative integer');
  }
  if (input.sequence === 0 && input.previousCheckpointHash !== undefined) {
    throw new Error('ProvenanceCheckpoint at sequence 0 cannot have a previousCheckpointHash');
  }
  if (input.sequence > 0 && input.previousCheckpointHash === undefined) {
    throw new Error(`ProvenanceCheckpoint at sequence ${input.sequence} requires previousCheckpointHash`);
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    sessionId: input.sessionId,
    actorProfileId: input.actorProfileId,
    sequence: input.sequence,
    ...(input.previousCheckpointHash !== undefined ? { previousCheckpointHash: input.previousCheckpointHash } : {}),
    manifestHash: input.manifestHash,
    checkpointHash: input.checkpointHash,
    triggerType: input.triggerType,
    createdAt: input.createdAt,
  });
}
