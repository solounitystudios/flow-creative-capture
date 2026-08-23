import type { JsonValue } from '../crypto/json.js';
import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import { verifyCanonicalSignature, type DeviceIdentity } from './identity.js';

/**
 * The exact set of fields a batch signature binds.
 *
 * `createdAt` IS bound: it is the device's own declared claim of when it
 * assembled this batch, per its own clock — the same category of
 * device-originated evidence as `firstEventAt`/`lastEventAt`, not a
 * server- or downstream-assigned value. Nothing else stamps it. If it
 * could be changed after signing without invalidating the signature, the
 * device's claimed recording/bundling time — part of the timeline this
 * evidence attests to — would be forgeable independent of key possession.
 * See PROVENANCE_SPEC.md §9 and ARCHITECTURE.md's occurredAt/receivedAt
 * distinction: `createdAt` sits on the device side of that line.
 *
 * `validationStatus` is deliberately EXCLUDED: it is local, downstream
 * bookkeeping — this evidence store's own record of whether
 * `validateBatchChain` (or, eventually, a server) has evaluated the batch
 * — never something the device is attesting to about its own evidence.
 * It is expected to change after signing (e.g. pending -> valid) without
 * that being tampering; binding it would make routine local processing
 * look like evidence forgery.
 *
 * `signature` itself is excluded for the obvious reason: a value cannot
 * be part of what it signs.
 */
export interface BatchSigningPayload {
  readonly batchId: string;
  readonly profileId: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly eventCount: number;
  readonly firstEventAt: string;
  readonly lastEventAt: string;
  readonly previousBatchHash: string | null;
  readonly manifestHash: string;
  readonly createdAt: string;
}

export function buildBatchSigningPayload(batch: ProvenanceBatch): BatchSigningPayload {
  return {
    batchId: batch.id,
    profileId: batch.profileId,
    deviceId: batch.deviceId,
    sessionId: batch.sessionId,
    eventCount: batch.eventCount,
    firstEventAt: batch.firstEventAt,
    lastEventAt: batch.lastEventAt,
    previousBatchHash: batch.previousBatchHash ?? null,
    manifestHash: batch.manifestHash,
    createdAt: batch.createdAt,
  };
}

function payloadAsJsonValue(payload: BatchSigningPayload): JsonValue {
  return { ...payload };
}

/**
 * Signs a batch's canonical signing payload with the given device
 * identity and returns a NEW `ProvenanceBatch` with `signature` populated
 * — it does not mutate the input. Never signs the batch's raw JSON;
 * always signs the canonical serialization of `BatchSigningPayload` (see
 * src/crypto/canonical.ts), so signature validity is independent of key
 * insertion order or incidental formatting.
 */
export function signProvenanceBatch(batch: ProvenanceBatch, identity: DeviceIdentity): ProvenanceBatch {
  if (batch.deviceId !== identity.deviceId) {
    throw new Error(
      `Refusing to sign batch ${batch.id}: batch.deviceId (${batch.deviceId}) does not match the signing identity's device (${identity.deviceId})`,
    );
  }
  const signature = identity.signCanonical(payloadAsJsonValue(buildBatchSigningPayload(batch)));
  return Object.freeze({ ...batch, signature });
}

export type BatchVerificationFailureReason =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch';

export interface BatchVerificationResult {
  readonly valid: boolean;
  readonly reason?: BatchVerificationFailureReason;
}

/**
 * Verifies that `batch.signature` is a valid Ed25519 signature, by the
 * holder of `signerPublicKeySpkiDer`, over exactly `batch`'s current
 * signing payload. If ANY bound field (event count, manifest hash,
 * session id, timestamps, ...) has changed since signing, this fails —
 * verification recomputes the payload from the batch it was actually
 * given, it never trusts a cached/prior payload.
 */
export function verifySignedBatch(batch: ProvenanceBatch, signerPublicKeySpkiDer: Buffer): BatchVerificationResult {
  if (batch.signature === undefined || batch.signature.trim().length === 0) {
    return { valid: false, reason: 'missing_signature' };
  }

  // Ed25519 signatures are exactly 64 bytes; base64 decoding itself never
  // throws in Node, so length is the meaningful structural check here.
  const signatureBytes = Buffer.from(batch.signature, 'base64');
  if (signatureBytes.length !== 64) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const payload = payloadAsJsonValue(buildBatchSigningPayload(batch));
  const valid = verifyCanonicalSignature(signerPublicKeySpkiDer, payload, batch.signature);
  return valid ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}
