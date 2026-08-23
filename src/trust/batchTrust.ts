import type { BatchId, DeviceId } from '../domain/ids.js';
import { isDeviceActive } from '../domain/studioDevice.js';
import { verifySignedBatch, type BatchVerificationResult } from '../device/batchSigning.js';
import type { CheckpointChainValidationResult } from '../provenance/checkpoint.js';
import { validateBatchChain, type BatchChainValidationResult } from '../provenance/batch.js';
import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import type { StudioSession } from '../domain/studioSession.js';
import type { LocalEvidenceStore } from '../store/evidenceStore.js';

/**
 * Trust Evaluation (`src/trust`) sits between the Local Evidence Store and
 * any future export/sync path. It is a SIDE-EFFECT-FREE composition over
 * existing primitives (`verifySignedBatch`, `validateBatchChain`,
 * `LocalEvidenceStore.verifyCheckpointChainForProject`, `isDeviceActive`)
 * — it never reimplements hashing, canonicalization, or chain/signature
 * validation, and it never writes to the store. See ARCHITECTURE.md's
 * "Trust Evaluation" section and SECURITY.md for the full trust-boundary
 * statement this module exists to enforce in code.
 */

/**
 * Four distinct signature states, not a boolean plus an afterthought
 * `undefined`. `signer_unknown` means verification could not even be
 * ATTEMPTED (no public key on file for the claimed device) — this is
 * diagnostically different from `invalid` (verification ran and failed)
 * and must never be conflated with it, nor with `unsigned` (the batch
 * itself carries no signature at all, independent of whether a key is
 * available to check one against).
 */
export type StoredBatchSignatureStatus =
  | { readonly status: 'unsigned'; readonly verification: BatchVerificationResult }
  | { readonly status: 'valid'; readonly verification: BatchVerificationResult }
  | { readonly status: 'invalid'; readonly verification: BatchVerificationResult }
  | { readonly status: 'signer_unknown' };

/**
 * Structural integrity covers TWO independent chains, both reusing
 * existing provenance primitives verbatim:
 *  - `checkpointChain`: the batch's project's checkpoint hash chain
 *    (`LocalEvidenceStore.verifyCheckpointChainForProject`, resolved via
 *    the batch's session).
 *  - `batchChain`: this device's own batch-to-batch `previousBatchHash`
 *    chain (`validateBatchChain`), scoped to exactly this device's
 *    batches up to and including the target batch — never the whole
 *    database, and never batches created after the target (those say
 *    nothing about whether THIS batch's own link back is sound).
 * A break in either chain makes `valid` false; both underlying results
 * are preserved in full, not summarized away.
 */
export interface StoredBatchStructureStatus {
  readonly valid: boolean;
  readonly checkpointChain: CheckpointChainValidationResult;
  readonly batchChain: BatchChainValidationResult;
  readonly errors: readonly string[];
}

export interface DeviceTrustStatus {
  readonly deviceFound: boolean;
  readonly currentlyTrusted: boolean;
  readonly revokedAt?: string;
}

/**
 * The single rollup label. Always re-derivable from `signature`/
 * `structure`/`deviceTrust` — never itself a source of truth, never
 * persisted. See "Rollup priority" in `deriveClaimStatus` below.
 *
 * `locally_sound_unverified_claim` is the ceiling state and means ONLY:
 * the persisted batch exists, its signature verifies against an on-file
 * public key, its checkpoint chain and its device's batch chain are both
 * structurally sound, and its signing device is not currently revoked —
 * all according to what THIS local store currently believes. It does
 * NOT mean the claim is factually true, that any human identity or
 * authorship is verified, that a contribution or final use is verified,
 * that copyright or legal ownership is verified, or that FLOW Platform
 * (or anyone else) has verified anything at all. See PROVENANCE_SPEC.md
 * §3 and SECURITY.md.
 */
export type ClaimStatus =
  | 'unsigned'
  | 'signature_invalid'
  | 'signer_unknown'
  | 'structure_invalid'
  | 'device_untrusted'
  | 'locally_sound_unverified_claim';

/**
 * Typed, machine-readable reason codes. A rollup `claimStatus` names only
 * the highest-priority failure; `reasons` preserves EVERY simultaneous
 * failure found, so a batch that is both structurally broken and signed
 * by a revoked device reports both `checkpoint_chain_invalid` (or
 * `batch_chain_invalid`) and `device_revoked`, never just one.
 */
export type BatchTrustReason =
  | 'batch_unsigned'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'signer_device_unknown'
  | 'device_revoked'
  | 'session_missing'
  | 'checkpoint_chain_invalid'
  | 'batch_chain_invalid';

export interface BatchTrustEvaluation {
  readonly batchId: BatchId;
  readonly signature: StoredBatchSignatureStatus;
  readonly structure: StoredBatchStructureStatus;
  readonly deviceTrust: DeviceTrustStatus;
  readonly claimStatus: ClaimStatus;
  readonly reasons: readonly BatchTrustReason[];
}

function computeSignatureStatus(batch: ProvenanceBatch, publicKeySpkiDer: Buffer | undefined): StoredBatchSignatureStatus {
  if (publicKeySpkiDer === undefined) {
    return { status: 'signer_unknown' };
  }
  const verification = verifySignedBatch(batch, publicKeySpkiDer);
  if (verification.valid) {
    return { status: 'valid', verification };
  }
  if (verification.reason === 'missing_signature') {
    return { status: 'unsigned', verification };
  }
  return { status: 'invalid', verification };
}

/**
 * Batch-chain scope: this device's own batches, ordered exactly as
 * `LocalEvidenceStore.listBatchesForDevice` already orders them
 * (createdAt, then insertion order), truncated to end at the target
 * batch. Batches created after the target are excluded — they cannot
 * affect whether THIS batch's own `previousBatchHash` link is sound, and
 * including them would validate evidence unrelated to the batch being
 * evaluated.
 */
function deviceBatchChainUpTo(store: LocalEvidenceStore, batch: ProvenanceBatch): readonly ProvenanceBatch[] {
  const deviceBatches = store.listBatchesForDevice(batch.deviceId);
  const targetIndex = deviceBatches.findIndex((candidate) => candidate.id === batch.id);
  return targetIndex === -1 ? [batch] : deviceBatches.slice(0, targetIndex + 1);
}

function computeStructureStatus(
  store: LocalEvidenceStore,
  batch: ProvenanceBatch,
  session: StudioSession | undefined,
): StoredBatchStructureStatus {
  const checkpointChain: CheckpointChainValidationResult =
    session === undefined
      ? {
          valid: false,
          errors: [`Session ${batch.sessionId} not found — cannot resolve a project to validate the checkpoint chain against`],
        }
      : store.verifyCheckpointChainForProject(session.projectId);

  const batchChain = validateBatchChain(deviceBatchChainUpTo(store, batch));

  return {
    valid: checkpointChain.valid && batchChain.valid,
    checkpointChain,
    batchChain,
    errors: [...checkpointChain.errors, ...batchChain.errors],
  };
}

function computeDeviceTrust(store: LocalEvidenceStore, deviceId: DeviceId): DeviceTrustStatus {
  const device = store.getDevice(deviceId);
  if (device === undefined) {
    return { deviceFound: false, currentlyTrusted: false };
  }
  return {
    deviceFound: true,
    currentlyTrusted: isDeviceActive(device),
    ...(device.revokedAt !== undefined ? { revokedAt: device.revokedAt } : {}),
  };
}

/**
 * Rollup priority (fixed, documented, and tested): signer unknown >
 * unsigned > signature invalid > structure invalid > device untrusted >
 * locally sound unverified claim. This picks ONE label for convenience
 * display; it never removes information — every dimension remains fully
 * available on the returned `BatchTrustEvaluation`, and every
 * simultaneously-failing dimension is still represented in `reasons`.
 */
function deriveClaimStatus(
  signature: StoredBatchSignatureStatus,
  structure: StoredBatchStructureStatus,
  deviceTrust: DeviceTrustStatus,
): ClaimStatus {
  if (signature.status === 'signer_unknown') {
    return 'signer_unknown';
  }
  if (signature.status === 'unsigned') {
    return 'unsigned';
  }
  if (signature.status === 'invalid') {
    return 'signature_invalid';
  }
  if (!structure.valid) {
    return 'structure_invalid';
  }
  if (!deviceTrust.currentlyTrusted) {
    return 'device_untrusted';
  }
  return 'locally_sound_unverified_claim';
}

function collectReasons(
  signature: StoredBatchSignatureStatus,
  structure: StoredBatchStructureStatus,
  deviceTrust: DeviceTrustStatus,
  sessionFound: boolean,
): BatchTrustReason[] {
  const reasons: BatchTrustReason[] = [];

  switch (signature.status) {
    case 'unsigned':
      reasons.push('batch_unsigned');
      break;
    case 'invalid':
      if (signature.verification.reason === 'malformed_signature') {
        reasons.push('signature_malformed');
      } else if (signature.verification.reason === 'signature_mismatch') {
        reasons.push('signature_mismatch');
      }
      break;
    case 'signer_unknown':
      reasons.push('signer_device_unknown');
      break;
    case 'valid':
      break;
  }

  if (deviceTrust.deviceFound && !deviceTrust.currentlyTrusted) {
    reasons.push('device_revoked');
  }

  // session_missing and checkpoint_chain_invalid are mutually exclusive:
  // an absent session means the checkpoint chain could not be attempted
  // at all, which is diagnostically different from attempting it and
  // finding it broken.
  if (!sessionFound) {
    reasons.push('session_missing');
  } else if (!structure.checkpointChain.valid) {
    reasons.push('checkpoint_chain_invalid');
  }

  if (!structure.batchChain.valid) {
    reasons.push('batch_chain_invalid');
  }

  return reasons;
}

/**
 * Evaluates a persisted batch's local trust posture. SIDE-EFFECT-FREE:
 * every dimension is recomputed from current store state on every call —
 * nothing is cached or persisted by this function, including
 * `claimStatus` itself. `batch_validation_state` (the store's own,
 * separate downstream bookkeeping) is neither read nor written here.
 *
 * Returns `undefined` ONLY when `batchId` itself was never persisted —
 * every other kind of missing reference (unknown device, missing
 * session) is represented as an explicit status/reason on the returned
 * evaluation, never by returning `undefined` or fabricating a passing
 * default.
 */
export function evaluateStoredBatchTrust(store: LocalEvidenceStore, batchId: BatchId): BatchTrustEvaluation | undefined {
  const batch = store.getBatch(batchId);
  if (batch === undefined) {
    return undefined;
  }

  const deviceTrust = computeDeviceTrust(store, batch.deviceId);
  const publicKey = deviceTrust.deviceFound ? store.getDevicePublicKey(batch.deviceId) : undefined;
  const signature = computeSignatureStatus(batch, publicKey);

  const session = store.getSession(batch.sessionId);
  const structure = computeStructureStatus(store, batch, session);

  const claimStatus = deriveClaimStatus(signature, structure, deviceTrust);
  const reasons = collectReasons(signature, structure, deviceTrust, session !== undefined);

  return {
    batchId,
    signature,
    structure,
    deviceTrust,
    claimStatus,
    reasons,
  };
}
