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
export type {
  CheckpointSigningPayload,
  CheckpointVerificationFailureReason,
  CheckpointVerificationResult,
} from './device/checkpointSigning.js';
export { buildCheckpointSigningPayload, signProvenanceCheckpoint, verifySignedCheckpoint } from './device/checkpointSigning.js';
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

/**
 * Trust Evaluation (`src/trust`) — a side-effect-free composition over
 * `LocalEvidenceStore` and the existing signature/chain primitives above.
 * Curated: internal derivation helpers (how `claimStatus` is rolled up,
 * how the device batch chain is scoped) are NOT exported —
 * `evaluateStoredBatchTrust` is the only intended entry point.
 */
export type {
  BatchTrustEvaluation,
  BatchTrustReason,
  ClaimStatus,
  DeviceTrustStatus,
  StoredBatchSignatureStatus,
  StoredBatchStructureStatus,
} from './trust/batchTrust.js';
export { evaluateStoredBatchTrust } from './trust/batchTrust.js';
export type {
  CheckpointTrustEvaluation,
  CheckpointTrustReason,
  StoredCheckpointSignatureStatus,
  StoredCheckpointStructureStatus,
} from './trust/checkpointTrust.js';
export { evaluateStoredCheckpointTrust } from './trust/checkpointTrust.js';

/**
 * Evidence Bundle Export (`src/evidence`) — a pure, read-only assembly
 * over `LocalEvidenceStore` + Trust Evaluation into a portable,
 * integrity-hashed snapshot. Curated: internal comparators, device-id
 * collection, and the pre-hash payload construction are NOT exported —
 * `assembleEvidenceBundle` is the only intended entry point.
 */
export type {
  AssembleEvidenceBundleOptions,
  DocumentationProfile,
  EvidenceBundleDevice,
  EvidenceBundleDocumentationEnvelope,
  EvidenceBundleExport,
  EvidenceBundleIntegrityManifest,
  EvidenceBundleProject,
  TrustEvaluationSnapshot,
} from './evidence/bundle.js';
export { assembleEvidenceBundle } from './evidence/bundle.js';
export { EvidenceBundleAssemblyError } from './evidence/errors.js';

/**
 * Document Architecture V1 (`src/documents`) — Project Dossier and
 * Delivery Package, both thin derived views over `EvidenceBundleExport`.
 * Curated: internal derivation helpers (participant/activity aggregation,
 * evidence-reference sorting) are NOT exported — `buildProjectDossier`
 * and `buildDeliveryPackage` are the only intended entry points. See
 * ARCHITECTURE.md's "Project Dossier" / "Delivery Package" sections for
 * what each is, and is explicitly not (a rights/ownership determination,
 * a contract, or a Passport credential in itself).
 */
export type {
  BuildProjectDossierOptions,
  DossierActivity,
  DossierAsset,
  DossierContributionClaim,
  DossierDisclaimers,
  DossierParticipant,
  DossierTrustSummary,
  ProjectDossier,
  ProjectDossierSourceRef,
} from './documents/dossier.js';
export { buildProjectDossier, DOSSIER_NOT_CLAIMED_NOTICES, DOSSIER_UNVERIFIED_NOTICES } from './documents/dossier.js';
export type {
  BuildDeliveryPackageOptions,
  DeliveryPackage,
  DeliveryPackageAudience,
  DeliveryPackageIntegrityManifest,
  DeliveryPackagePurpose,
  DeliveryPackageSectionKey,
  DeliveryPackageSections,
  DeliveryPackageSourceRefs,
  EvidenceRecordReference,
} from './documents/deliveryPackage.js';
export {
  buildDeliveryPackage,
  DELIVERY_PACKAGE_AUDIENCES,
  DELIVERY_PACKAGE_PURPOSES,
  DELIVERY_PACKAGE_SECTION_KEYS,
} from './documents/deliveryPackage.js';
export { DocumentAssemblyError } from './documents/errors.js';
