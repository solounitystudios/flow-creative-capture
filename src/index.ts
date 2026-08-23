export * from './domain/index.js';
export * from './crypto/index.js';
export * from './provenance/index.js';
export * from './sync/contracts.js';

/**
 * Device signing (local evidence -> device signature). Curated, not a
 * blanket `export *` from `src/device`: raw keypair primitives
 * (src/device/keypair.ts — generateDeviceKeyPair, signBytes, verifyBytes,
 * DER export/import) are intentionally NOT part of the package surface.
 * Consumers should go through `DeviceIdentity` (create/loadDeviceIdentity)
 * rather than handling raw keys directly. `src/store/schema.ts` (proposed,
 * unwired local evidence persistence) is also deliberately excluded — it
 * is not part of this feature and is not consumed by anything exported
 * here.
 */
export type {
  CreateDeviceIdentityOptions,
  DeviceIdentity,
  DeviceIdentityResult,
} from './device/identity.js';
export { createDeviceIdentity, loadDeviceIdentity, verifyCanonicalSignature } from './device/identity.js';
export type { BatchSigningPayload, BatchVerificationFailureReason, BatchVerificationResult } from './device/batchSigning.js';
export { buildBatchSigningPayload, signProvenanceBatch, verifySignedBatch } from './device/batchSigning.js';
export type { DeviceTrustEvaluation } from './device/trust.js';
export { evaluateBatchTrust } from './device/trust.js';
export type { DeviceKeyStore, StoredKeyMaterial } from './device/keyStore.js';
export { FileDeviceKeyStore } from './device/keyStore.js';
