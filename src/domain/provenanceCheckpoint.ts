import type { CheckpointId, DeviceId, ProfileId, ProjectId, SessionId, WorkReferenceId } from './ids.js';
import { isSha256Hex } from '../crypto/sha256.js';
import { CHECKPOINT_TRIGGER_TYPES, type CheckpointTriggerType } from './enums.js';

/**
 * A tamper-evident checkpoint. `checkpointHash` is derived from
 * `manifestHash`, `previousCheckpointHash`, `sessionId`, `actorProfileId`,
 * and `createdAt` — see src/provenance/checkpoint.ts for the derivation.
 * This module only shapes and validates the resulting record; it does not
 * compute hashes itself, to keep the domain layer free of hashing policy.
 *
 * `deviceId` identifies which `StudioDevice` recorded this checkpoint — the
 * same posture `ProvenanceBatch.deviceId` already has, and required for the
 * same reason: signature verification (`src/device/checkpointSigning.ts`)
 * needs an explicit device claim on the record itself, not one resolved
 * indirectly through `sessionId`. `signature`, like `ProvenanceBatch.signature`,
 * is optional at construction (an unsigned checkpoint is still a
 * structurally valid, hash-chained record) and is populated after the fact
 * by `signProvenanceCheckpoint` — never by this factory. Deliberately does
 * NOT change `checkpointHash`'s own derivation: exactly like
 * `ProvenanceBatch.deviceId` is not part of `computeBatchManifestHash`,
 * `deviceId` is bound by the checkpoint's SIGNATURE payload
 * (`CheckpointSigningPayload`), not by the pre-existing hash-chain formula
 * `PROVENANCE_SPEC.md` §7 already documents — that formula is unchanged.
 */
export interface ProvenanceCheckpoint {
  readonly id: CheckpointId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly sessionId: SessionId;
  readonly actorProfileId: ProfileId;
  readonly deviceId: DeviceId;
  readonly sequence: number;
  readonly previousCheckpointHash?: string;
  readonly manifestHash: string;
  readonly checkpointHash: string;
  readonly signature?: string;
  readonly triggerType: CheckpointTriggerType;
  readonly createdAt: string;
}

export interface ProvenanceCheckpointInput {
  id: CheckpointId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  sessionId: SessionId;
  actorProfileId: ProfileId;
  deviceId: DeviceId;
  sequence: number;
  previousCheckpointHash?: string;
  manifestHash: string;
  checkpointHash: string;
  signature?: string;
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
    deviceId: input.deviceId,
    sequence: input.sequence,
    ...(input.previousCheckpointHash !== undefined ? { previousCheckpointHash: input.previousCheckpointHash } : {}),
    manifestHash: input.manifestHash,
    checkpointHash: input.checkpointHash,
    ...(input.signature !== undefined ? { signature: input.signature } : {}),
    triggerType: input.triggerType,
    createdAt: input.createdAt,
  });
}
