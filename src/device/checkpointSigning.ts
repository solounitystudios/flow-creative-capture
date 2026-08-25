import type { JsonValue } from '../crypto/json.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import { verifyCanonicalSignature, type DeviceIdentity } from './identity.js';

/**
 * The exact set of fields a checkpoint signature binds. Mirrors
 * `BatchSigningPayload` (`src/device/batchSigning.ts`) field-for-field —
 * every checkpoint field except `signature` itself (a value cannot be part
 * of what it signs). `checkpointHash` IS bound here even though it is
 * itself derived from `manifestHash`/`previousCheckpointHash`/`sessionId`/
 * `actorProfileId`/`createdAt` (see `computeCheckpointHash`): binding the
 * derived hash, not just its inputs, means a signature also detects a
 * checkpoint whose `checkpointHash` was recomputed inconsistently with its
 * own stored fields — the exact tampering `validateCheckpointChain`
 * already catches independently. Two independent checks over the same
 * tamper is intentional defense in depth, not redundancy to prune.
 *
 * The raw chain fields (`previousCheckpointHash`, `manifestHash`,
 * `sequence`) are ALSO bound directly, not just folded into
 * `checkpointHash` — exactly like `BatchSigningPayload` binds both
 * `manifestHash` and `previousBatchHash` even though `validateBatchChain`
 * separately checks chain validity. Binding the raw fields, not just the
 * derived hash, means a signature fails the instant any bound field
 * changes, independent of whether `validateCheckpointChain` is also run.
 */
export interface CheckpointSigningPayload {
  readonly checkpointId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly actorProfileId: string;
  readonly deviceId: string;
  readonly sequence: number;
  readonly previousCheckpointHash: string | null;
  readonly manifestHash: string;
  readonly checkpointHash: string;
  readonly triggerType: string;
  readonly createdAt: string;
}

export function buildCheckpointSigningPayload(checkpoint: ProvenanceCheckpoint): CheckpointSigningPayload {
  return {
    checkpointId: checkpoint.id,
    projectId: checkpoint.projectId,
    sessionId: checkpoint.sessionId,
    actorProfileId: checkpoint.actorProfileId,
    deviceId: checkpoint.deviceId,
    sequence: checkpoint.sequence,
    previousCheckpointHash: checkpoint.previousCheckpointHash ?? null,
    manifestHash: checkpoint.manifestHash,
    checkpointHash: checkpoint.checkpointHash,
    triggerType: checkpoint.triggerType,
    createdAt: checkpoint.createdAt,
  };
}

function payloadAsJsonValue(payload: CheckpointSigningPayload): JsonValue {
  return { ...payload };
}

/**
 * Signs a checkpoint's canonical signing payload with the given device
 * identity and returns a NEW `ProvenanceCheckpoint` with `signature`
 * populated — it does not mutate the input. Never signs raw JSON; always
 * signs the canonical serialization of `CheckpointSigningPayload` (see
 * src/crypto/canonical.ts), so signature validity is independent of key
 * insertion order or incidental formatting.
 */
export function signProvenanceCheckpoint(checkpoint: ProvenanceCheckpoint, identity: DeviceIdentity): ProvenanceCheckpoint {
  if (checkpoint.deviceId !== identity.deviceId) {
    throw new Error(
      `Refusing to sign checkpoint ${checkpoint.id}: checkpoint.deviceId (${checkpoint.deviceId}) does not match the signing identity's device (${identity.deviceId})`,
    );
  }
  const signature = identity.signCanonical(payloadAsJsonValue(buildCheckpointSigningPayload(checkpoint)));
  return Object.freeze({ ...checkpoint, signature });
}

export type CheckpointVerificationFailureReason =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch';

export interface CheckpointVerificationResult {
  readonly valid: boolean;
  readonly reason?: CheckpointVerificationFailureReason;
}

/**
 * Verifies that `checkpoint.signature` is a valid Ed25519 signature, by
 * the holder of `signerPublicKeySpkiDer`, over exactly `checkpoint`'s
 * current signing payload. If ANY bound field has changed since signing,
 * this fails — verification recomputes the payload from the checkpoint it
 * was actually given, it never trusts a cached/prior payload.
 */
export function verifySignedCheckpoint(
  checkpoint: ProvenanceCheckpoint,
  signerPublicKeySpkiDer: Buffer,
): CheckpointVerificationResult {
  if (checkpoint.signature === undefined || checkpoint.signature.trim().length === 0) {
    return { valid: false, reason: 'missing_signature' };
  }

  // Ed25519 signatures are exactly 64 bytes; base64 decoding itself never
  // throws in Node, so length is the meaningful structural check here.
  const signatureBytes = Buffer.from(checkpoint.signature, 'base64');
  if (signatureBytes.length !== 64) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const payload = payloadAsJsonValue(buildCheckpointSigningPayload(checkpoint));
  const valid = verifyCanonicalSignature(signerPublicKeySpkiDer, payload, checkpoint.signature);
  return valid ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}
