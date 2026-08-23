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
 * rather than handling raw keys directly.
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

/**
 * Local Evidence Store V1 (durable, append-oriented persistence for
 * devices, sessions, events, checkpoints, and signed batches — see
 * src/store/schema.ts). Curated: the underlying `node:sqlite` handle,
 * raw SQL, and row-mapping internals (src/store/rows.ts,
 * src/store/database.ts's lower-level open/transaction primitives) are
 * NOT part of the package surface — `LocalEvidenceStore` is the only
 * intended entry point for consumers.
 */
export { LocalEvidenceStore, type InsertResult } from './store/evidenceStore.js';
export { StoreConflictError } from './store/errors.js';
export { UnsupportedSchemaVersionError } from './store/database.js';
export { CURRENT_SCHEMA_VERSION } from './store/schema.js';
