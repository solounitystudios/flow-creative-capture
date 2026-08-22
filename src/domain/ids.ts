/**
 * Nominal ID types. At runtime these are plain strings; the brand exists
 * only to stop a SessionId from being passed where an AssetId is expected.
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type WorkReferenceId = Brand<string, 'WorkReferenceId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type AssetRelationshipId = Brand<string, 'AssetRelationshipId'>;
export type EventId = Brand<string, 'EventId'>;
export type CheckpointId = Brand<string, 'CheckpointId'>;
export type BatchId = Brand<string, 'BatchId'>;
export type HandoffId = Brand<string, 'HandoffId'>;
export type ReleaseCandidateId = Brand<string, 'ReleaseCandidateId'>;
export type RightsClaimId = Brand<string, 'RightsClaimId'>;

/** External identifiers owned by flow-platform. Opaque here by design. */
export type ExternalProjectPassportId = Brand<string, 'ExternalProjectPassportId'>;

function makeBrander<T extends string>() {
  return (value: string): Brand<string, T> => value as Brand<string, T>;
}

export const asProjectId = makeBrander<'ProjectId'>();
export const asProfileId = makeBrander<'ProfileId'>();
export const asOrganizationId = makeBrander<'OrganizationId'>();
export const asWorkReferenceId = makeBrander<'WorkReferenceId'>();
export const asDeviceId = makeBrander<'DeviceId'>();
export const asSessionId = makeBrander<'SessionId'>();
export const asAssetId = makeBrander<'AssetId'>();
export const asAssetRelationshipId = makeBrander<'AssetRelationshipId'>();
export const asEventId = makeBrander<'EventId'>();
export const asCheckpointId = makeBrander<'CheckpointId'>();
export const asBatchId = makeBrander<'BatchId'>();
export const asHandoffId = makeBrander<'HandoffId'>();
export const asReleaseCandidateId = makeBrander<'ReleaseCandidateId'>();
export const asRightsClaimId = makeBrander<'RightsClaimId'>();
export const asExternalProjectPassportId = makeBrander<'ExternalProjectPassportId'>();
