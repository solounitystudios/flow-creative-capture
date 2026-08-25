import type { CheckpointId, DeviceId } from '../domain/ids.js';
import { isDeviceActive } from '../domain/studioDevice.js';
import { verifySignedCheckpoint, type CheckpointVerificationResult } from '../device/checkpointSigning.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import type { CheckpointChainValidationResult } from '../provenance/checkpoint.js';
import type { LocalEvidenceStore } from '../store/evidenceStore.js';
import type { ClaimStatus, DeviceTrustStatus } from './batchTrust.js';

/**
 * Checkpoint Trust Evaluation. Mirrors `src/trust/batchTrust.ts` exactly —
 * same SIDE-EFFECT-FREE posture, same composition-over-existing-primitives
 * rule (`verifySignedCheckpoint`, `LocalEvidenceStore.
 * verifyCheckpointChainForProject`, `isDeviceActive` — never a
 * reimplementation), and the SAME `ClaimStatus` rollup type (imported from
 * `batchTrust.ts`, not redefined) — a checkpoint's local trust posture is
 * the same kind of claim a batch's is, evaluated over a different evidence
 * unit. See AGENTS.md: "use existing repository vocabulary... do not
 * duplicate trust terminology unnecessarily."
 */

/**
 * Four distinct signature states, identical in spirit to
 * `StoredBatchSignatureStatus` — `signer_unknown` means verification could
 * not even be ATTEMPTED (no public key on file for the claimed device).
 */
export type StoredCheckpointSignatureStatus =
  | { readonly status: 'unsigned'; readonly verification: CheckpointVerificationResult }
  | { readonly status: 'valid'; readonly verification: CheckpointVerificationResult }
  | { readonly status: 'invalid'; readonly verification: CheckpointVerificationResult }
  | { readonly status: 'signer_unknown' };

/**
 * Structural integrity here is exactly the checkpoint chain
 * (`LocalEvidenceStore.verifyCheckpointChainForProject`) — unlike a
 * batch's structure (which also covers a device-scoped batch chain),
 * a checkpoint has no second, parallel chain of its own to check.
 */
export interface StoredCheckpointStructureStatus {
  readonly valid: boolean;
  readonly checkpointChain: CheckpointChainValidationResult;
  readonly errors: readonly string[];
}

/**
 * Typed, machine-readable reason codes for a checkpoint's trust
 * evaluation — the checkpoint-scoped counterpart to `BatchTrustReason`.
 */
export type CheckpointTrustReason =
  | 'checkpoint_unsigned'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'signer_device_unknown'
  | 'device_revoked'
  | 'checkpoint_chain_invalid';

export interface CheckpointTrustEvaluation {
  readonly checkpointId: CheckpointId;
  readonly signature: StoredCheckpointSignatureStatus;
  readonly structure: StoredCheckpointStructureStatus;
  readonly deviceTrust: DeviceTrustStatus;
  readonly claimStatus: ClaimStatus;
  readonly reasons: readonly CheckpointTrustReason[];
}

function computeSignatureStatus(
  checkpoint: ProvenanceCheckpoint,
  publicKeySpkiDer: Buffer | undefined,
): StoredCheckpointSignatureStatus {
  if (publicKeySpkiDer === undefined) {
    return { status: 'signer_unknown' };
  }
  const verification = verifySignedCheckpoint(checkpoint, publicKeySpkiDer);
  if (verification.valid) {
    return { status: 'valid', verification };
  }
  if (verification.reason === 'missing_signature') {
    return { status: 'unsigned', verification };
  }
  return { status: 'invalid', verification };
}

function computeStructureStatus(store: LocalEvidenceStore, checkpoint: ProvenanceCheckpoint): StoredCheckpointStructureStatus {
  const checkpointChain = store.verifyCheckpointChainForProject(checkpoint.projectId);
  return {
    valid: checkpointChain.valid,
    checkpointChain,
    errors: [...checkpointChain.errors],
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
 * Rollup priority — identical ordering to `batchTrust.ts`'s
 * `deriveClaimStatus`: signer unknown > unsigned > signature invalid >
 * structure invalid > device untrusted > locally sound unverified claim.
 */
function deriveClaimStatus(
  signature: StoredCheckpointSignatureStatus,
  structure: StoredCheckpointStructureStatus,
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
  signature: StoredCheckpointSignatureStatus,
  structure: StoredCheckpointStructureStatus,
  deviceTrust: DeviceTrustStatus,
): CheckpointTrustReason[] {
  const reasons: CheckpointTrustReason[] = [];

  switch (signature.status) {
    case 'unsigned':
      reasons.push('checkpoint_unsigned');
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

  if (!structure.checkpointChain.valid) {
    reasons.push('checkpoint_chain_invalid');
  }

  return reasons;
}

/**
 * Evaluates a persisted checkpoint's local trust posture. SIDE-EFFECT-FREE:
 * every dimension is recomputed from current store state on every call —
 * nothing is cached or persisted. Returns `undefined` ONLY when
 * `checkpointId` itself was never persisted — every other kind of missing
 * reference (unknown device) is represented as an explicit status/reason
 * on the returned evaluation, never by returning `undefined` or
 * fabricating a passing default.
 */
export function evaluateStoredCheckpointTrust(
  store: LocalEvidenceStore,
  checkpointId: CheckpointId,
): CheckpointTrustEvaluation | undefined {
  const checkpoint = store.getCheckpoint(checkpointId);
  if (checkpoint === undefined) {
    return undefined;
  }

  const deviceTrust = computeDeviceTrust(store, checkpoint.deviceId);
  const publicKey = deviceTrust.deviceFound ? store.getDevicePublicKey(checkpoint.deviceId) : undefined;
  const signature = computeSignatureStatus(checkpoint, publicKey);
  const structure = computeStructureStatus(store, checkpoint);

  const claimStatus = deriveClaimStatus(signature, structure, deviceTrust);
  const reasons = collectReasons(signature, structure, deviceTrust);

  return {
    checkpointId,
    signature,
    structure,
    deviceTrust,
    claimStatus,
    reasons,
  };
}
