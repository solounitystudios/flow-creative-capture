import type { BatchId, DeviceId, ProfileId, SessionId } from './ids.js';
import { isSha256Hex } from '../crypto/sha256.js';
import { BATCH_VALIDATION_STATUSES, type BatchValidationStatus } from './enums.js';

/**
 * An offline-capture batch: a signed (eventually) bundle of events recorded
 * without connectivity, uploaded once it returns. `firstEventAt`/`lastEventAt`
 * are the events' own occurredAt range — never confuse them with when the
 * batch was actually received by a server.
 */
export interface ProvenanceBatch {
  readonly id: BatchId;
  readonly profileId: ProfileId;
  readonly deviceId: DeviceId;
  readonly sessionId: SessionId;
  readonly eventCount: number;
  readonly firstEventAt: string;
  readonly lastEventAt: string;
  readonly previousBatchHash?: string;
  readonly manifestHash: string;
  readonly signature?: string;
  readonly validationStatus: BatchValidationStatus;
  readonly createdAt: string;
}

export interface ProvenanceBatchInput {
  id: BatchId;
  profileId: ProfileId;
  deviceId: DeviceId;
  sessionId: SessionId;
  eventCount: number;
  firstEventAt: string;
  lastEventAt: string;
  previousBatchHash?: string;
  manifestHash: string;
  signature?: string;
  validationStatus?: BatchValidationStatus;
  createdAt: string;
}

export function createProvenanceBatch(input: ProvenanceBatchInput): ProvenanceBatch {
  if (input.eventCount <= 0 || !Number.isInteger(input.eventCount)) {
    throw new Error('ProvenanceBatch.eventCount must be a positive integer');
  }
  if (input.lastEventAt < input.firstEventAt) {
    throw new Error('ProvenanceBatch.lastEventAt cannot precede firstEventAt');
  }
  if (!isSha256Hex(input.manifestHash)) {
    throw new Error('ProvenanceBatch.manifestHash must be a valid SHA-256 hex digest');
  }
  if (input.previousBatchHash !== undefined && !isSha256Hex(input.previousBatchHash)) {
    throw new Error('ProvenanceBatch.previousBatchHash must be a valid SHA-256 hex digest');
  }
  const validationStatus = input.validationStatus ?? 'pending';
  if (!BATCH_VALIDATION_STATUSES.includes(validationStatus)) {
    throw new Error(`ProvenanceBatch.validationStatus "${validationStatus}" is not recognized`);
  }

  return Object.freeze({
    id: input.id,
    profileId: input.profileId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    eventCount: input.eventCount,
    firstEventAt: input.firstEventAt,
    lastEventAt: input.lastEventAt,
    ...(input.previousBatchHash !== undefined ? { previousBatchHash: input.previousBatchHash } : {}),
    manifestHash: input.manifestHash,
    ...(input.signature !== undefined ? { signature: input.signature } : {}),
    validationStatus,
    createdAt: input.createdAt,
  });
}
