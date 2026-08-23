import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import { isDeviceActive, type StudioDevice } from '../domain/studioDevice.js';
import { verifySignedBatch, type BatchVerificationResult } from './batchSigning.js';

/**
 * Combines two independent signals that must never be conflated:
 *
 *  - `signature`: a mathematical fact about the past. Once a batch is
 *    validly signed, that fact never changes — revoking a device does
 *    not and cannot make its prior signatures invalid.
 *  - `deviceCurrentlyTrusted`: a LOCAL, forward-looking policy decision
 *    based on the device's latest known state. Revoking a device flips
 *    this to false for that device going forward, without touching any
 *    previously recorded signature or evidence.
 *
 * There is no server-side/global revocation authority in this batch —
 * `deviceCurrentlyTrusted` reflects only what this local evidence store
 * currently believes about the device.
 */
export interface DeviceTrustEvaluation {
  readonly signature: BatchVerificationResult;
  readonly deviceCurrentlyTrusted: boolean;
}

export function evaluateBatchTrust(
  batch: ProvenanceBatch,
  signerPublicKeySpkiDer: Buffer,
  currentDeviceState: StudioDevice,
): DeviceTrustEvaluation {
  return {
    signature: verifySignedBatch(batch, signerPublicKeySpkiDer),
    deviceCurrentlyTrusted: isDeviceActive(currentDeviceState),
  };
}
