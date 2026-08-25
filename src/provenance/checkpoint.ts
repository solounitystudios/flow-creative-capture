import type { JsonValue } from '../crypto/json.js';
import { hashCanonicalValue } from '../crypto/sha256.js';
import {
  createProvenanceCheckpoint,
  type ProvenanceCheckpoint,
} from '../domain/provenanceCheckpoint.js';
import type { CheckpointId, DeviceId, ProfileId, ProjectId, SessionId, WorkReferenceId } from '../domain/ids.js';
import type { CheckpointTriggerType } from '../domain/enums.js';
import { buildCheckpointManifest, hashCheckpointManifest, type CheckpointManifestInput } from './manifest.js';

export interface CheckpointHashInput {
  manifestHash: string;
  previousCheckpointHash?: string;
  sessionId: SessionId;
  actorProfileId: ProfileId;
  createdAt: string;
}

/**
 * Derives a checkpoint's hash from an explicit canonical structure —
 * never from unsafe string concatenation, which is ambiguous under field
 * truncation/reordering (e.g. "ab"+"c" == "a"+"bc").
 */
export function computeCheckpointHash(input: CheckpointHashInput): string {
  const structure: JsonValue = {
    manifestHash: input.manifestHash,
    previousCheckpointHash: input.previousCheckpointHash ?? null,
    sessionId: input.sessionId,
    actorProfileId: input.actorProfileId,
    createdAt: input.createdAt,
  };
  return hashCanonicalValue(structure);
}

export interface CreateCheckpointOptions {
  id: CheckpointId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  sessionId: SessionId;
  actorProfileId: ProfileId;
  deviceId: DeviceId;
  sequence: number;
  previousCheckpointHash?: string;
  manifest: CheckpointManifestInput;
  triggerType: CheckpointTriggerType;
  createdAt: string;
}

/**
 * Builds a manifest, hashes it, derives the checkpoint hash, and produces
 * a validated, UNSIGNED checkpoint record — `deviceId` is carried onto the
 * record (see `ProvenanceCheckpoint`'s docstring), but signing is a
 * separate, explicit step (`signProvenanceCheckpoint`,
 * `src/device/checkpointSigning.ts`), never performed implicitly here.
 */
export function createCheckpointFromManifest(options: CreateCheckpointOptions): ProvenanceCheckpoint {
  const manifest = buildCheckpointManifest({
    projectId: options.projectId,
    ...(options.workReference !== undefined ? { workReference: options.workReference } : {}),
    assets: options.manifest.assets,
    eventIds: options.manifest.eventIds,
  });
  const manifestHash = hashCheckpointManifest(manifest);
  const checkpointHash = computeCheckpointHash({
    manifestHash,
    ...(options.previousCheckpointHash !== undefined ? { previousCheckpointHash: options.previousCheckpointHash } : {}),
    sessionId: options.sessionId,
    actorProfileId: options.actorProfileId,
    createdAt: options.createdAt,
  });

  return createProvenanceCheckpoint({
    id: options.id,
    projectId: options.projectId,
    ...(options.workReference !== undefined ? { workReference: options.workReference } : {}),
    sessionId: options.sessionId,
    actorProfileId: options.actorProfileId,
    deviceId: options.deviceId,
    sequence: options.sequence,
    ...(options.previousCheckpointHash !== undefined ? { previousCheckpointHash: options.previousCheckpointHash } : {}),
    manifestHash,
    checkpointHash,
    triggerType: options.triggerType,
    createdAt: options.createdAt,
  });
}

export interface CheckpointChainValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates a chain of checkpoints for one project/session lineage:
 *  - sequence numbers are contiguous starting at 0
 *  - each checkpoint's previousCheckpointHash matches the prior checkpoint's checkpointHash
 *  - each checkpoint's checkpointHash is exactly what recomputing from its
 *    own stored fields produces (catches any field tampered with in isolation)
 *
 * Checkpoints must be passed in ascending sequence order.
 */
export function validateCheckpointChain(checkpoints: readonly ProvenanceCheckpoint[]): CheckpointChainValidationResult {
  const errors: string[] = [];

  checkpoints.forEach((checkpoint, index) => {
    if (checkpoint.sequence !== index) {
      errors.push(
        `Checkpoint ${checkpoint.id} has sequence ${checkpoint.sequence}, expected ${index} at position ${index}`,
      );
    }

    const previous = index > 0 ? checkpoints[index - 1] : undefined;
    if (previous !== undefined && checkpoint.previousCheckpointHash !== previous.checkpointHash) {
      errors.push(
        `Checkpoint ${checkpoint.id} previousCheckpointHash does not match checkpoint ${previous.id}'s checkpointHash`,
      );
    }
    if (previous === undefined && checkpoint.previousCheckpointHash !== undefined) {
      errors.push(`Checkpoint ${checkpoint.id} is first in chain but declares a previousCheckpointHash`);
    }

    const recomputed = computeCheckpointHash({
      manifestHash: checkpoint.manifestHash,
      ...(checkpoint.previousCheckpointHash !== undefined
        ? { previousCheckpointHash: checkpoint.previousCheckpointHash }
        : {}),
      sessionId: checkpoint.sessionId,
      actorProfileId: checkpoint.actorProfileId,
      createdAt: checkpoint.createdAt,
    });
    if (recomputed !== checkpoint.checkpointHash) {
      errors.push(`Checkpoint ${checkpoint.id} checkpointHash does not match its recomputed hash — tampering detected`);
    }
  });

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
