import type { JsonValue } from '../crypto/json.js';
import {
  asAssetId,
  asBatchId,
  asCheckpointId,
  asContributionClaimId,
  asDeviceId,
  asEventId,
  asExternalProjectPassportId,
  asOrganizationId,
  asProfileId,
  asProjectId,
  asSessionId,
  asWorkReferenceId,
} from '../domain/ids.js';
import type {
  Daw,
  EventSource,
  EventType,
  CheckpointTriggerType,
  Platform,
  ProjectStatus,
  ProjectType,
  SessionStatus,
} from '../domain/enums.js';
import { createCreativeProject, type CreativeProject } from '../domain/creativeProject.js';
import { createStudioDevice, type StudioDevice } from '../domain/studioDevice.js';
import { createStudioSession, type StudioSession } from '../domain/studioSession.js';
import { createProvenanceEvent, type ProvenanceEvent } from '../domain/provenanceEvent.js';
import { createProvenanceCheckpoint, type ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import { createProvenanceBatch, type ProvenanceBatch } from '../domain/provenanceBatch.js';
import { createContributorReference, type ContributorReference } from '../domain/contributorReference.js';
import { createProjectAsset, type ProjectAsset } from '../domain/projectAsset.js';
import type { ContributionRole } from '../domain/roles.js';
import type { AssetType, BatchValidationStatus, OriginStatus, RightsVerificationStatus, SourceType } from '../domain/enums.js';

/**
 * Row shapes exactly mirror the columns in schema.ts. Reconstruction always
 * goes back through the existing domain factories (`createStudioDevice`,
 * `createProvenanceEvent`, ...) rather than building a domain object by
 * hand — this reuses their existing structural validation instead of
 * duplicating it, and guarantees a reconstructed object has exactly the
 * shape the rest of the codebase already expects.
 */

export interface ProjectRow {
  readonly id: string;
  readonly ownerProfileId: string;
  readonly organizationId: string | null;
  readonly externalProjectPassportId: string | null;
  readonly title: string;
  readonly projectType: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly storedAt: string;
}

export function projectToRow(project: CreativeProject, storedAt: string): ProjectRow {
  return {
    id: project.id,
    ownerProfileId: project.ownerProfileId,
    organizationId: project.organizationId ?? null,
    externalProjectPassportId: project.externalProjectPassportId ?? null,
    title: project.title,
    projectType: project.projectType,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    storedAt,
  };
}

export function rowToProject(row: ProjectRow): CreativeProject {
  return createCreativeProject({
    id: asProjectId(row.id),
    ownerProfileId: asProfileId(row.ownerProfileId),
    ...(row.organizationId !== null ? { organizationId: asOrganizationId(row.organizationId) } : {}),
    ...(row.externalProjectPassportId !== null
      ? { externalProjectPassportId: asExternalProjectPassportId(row.externalProjectPassportId) }
      : {}),
    title: row.title,
    projectType: row.projectType as ProjectType,
    status: row.status as ProjectStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export interface DeviceRow {
  readonly id: string;
  readonly profileId: string;
  readonly devicePublicId: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly deviceKeyFingerprint: string;
  readonly publicKeySpkiDer: string;
  readonly verifiedAt: string | null;
  readonly storedAt: string;
}

export interface DeviceRevocationRow {
  readonly deviceId: string;
  readonly revokedAt: string;
  readonly storedAt: string;
}

export function deviceToRow(device: StudioDevice, publicKeySpkiDer: Buffer, storedAt: string): DeviceRow {
  return {
    id: device.id,
    profileId: device.profileId,
    devicePublicId: device.devicePublicId,
    platform: device.platform,
    appVersion: device.appVersion,
    deviceKeyFingerprint: device.deviceKeyFingerprint,
    publicKeySpkiDer: publicKeySpkiDer.toString('base64'),
    verifiedAt: device.verifiedAt ?? null,
    storedAt,
  };
}

export function rowToDevice(row: DeviceRow, revocation: DeviceRevocationRow | undefined): StudioDevice {
  return createStudioDevice({
    id: asDeviceId(row.id),
    profileId: asProfileId(row.profileId),
    devicePublicId: row.devicePublicId,
    platform: row.platform as Platform,
    appVersion: row.appVersion,
    deviceKeyFingerprint: row.deviceKeyFingerprint,
    ...(row.verifiedAt !== null ? { verifiedAt: row.verifiedAt } : {}),
    ...(revocation !== undefined ? { revokedAt: revocation.revokedAt } : {}),
  });
}

export function rowToDevicePublicKeySpkiDer(row: DeviceRow): Buffer {
  return Buffer.from(row.publicKeySpkiDer, 'base64');
}

export interface SessionRow {
  readonly id: string;
  readonly projectId: string;
  readonly workReference: string | null;
  readonly actorProfileId: string;
  readonly deviceId: string;
  readonly daw: string;
  readonly dawVersion: string | null;
  readonly startedAt: string;
  readonly storedAt: string;
}

export interface SessionEndRow {
  readonly sessionId: string;
  readonly endedAt: string;
  readonly status: string;
  readonly storedAt: string;
}

export function sessionToRow(session: StudioSession, storedAt: string): SessionRow {
  return {
    id: session.id,
    projectId: session.projectId,
    workReference: session.workReference ?? null,
    actorProfileId: session.actorProfileId,
    deviceId: session.deviceId,
    daw: session.daw,
    dawVersion: session.dawVersion ?? null,
    startedAt: session.startedAt,
    storedAt,
  };
}

export function rowToSession(row: SessionRow, end: SessionEndRow | undefined): StudioSession {
  return createStudioSession({
    id: asSessionId(row.id),
    projectId: asProjectId(row.projectId),
    ...(row.workReference !== null ? { workReference: asWorkReferenceId(row.workReference) } : {}),
    actorProfileId: asProfileId(row.actorProfileId),
    deviceId: asDeviceId(row.deviceId),
    daw: row.daw as Daw,
    ...(row.dawVersion !== null ? { dawVersion: row.dawVersion } : {}),
    startedAt: row.startedAt,
    ...(end !== undefined ? { endedAt: end.endedAt, status: end.status as SessionStatus } : {}),
  });
}

export interface EventRow {
  readonly eventId: string;
  readonly projectId: string;
  readonly workReference: string | null;
  readonly sessionId: string;
  readonly actorProfileId: string;
  readonly deviceId: string;
  readonly source: string;
  readonly eventType: string;
  readonly assetId: string | null;
  readonly trackReference: string | null;
  readonly occurredAt: string;
  readonly receivedAt: string | null;
  readonly payload: string;
  readonly storedAt: string;
}

export function eventToRow(event: ProvenanceEvent, storedAt: string): EventRow {
  return {
    eventId: event.eventId,
    projectId: event.projectId,
    workReference: event.workReference ?? null,
    sessionId: event.sessionId,
    actorProfileId: event.actorProfileId,
    deviceId: event.deviceId,
    source: event.source,
    eventType: event.eventType,
    assetId: event.assetId ?? null,
    trackReference: event.trackReference ?? null,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt ?? null,
    // Plain JSON, not canonicalize() — this is storage, not hashing. Any
    // future hash over this payload goes back through hashCanonicalValue,
    // which sorts keys itself regardless of how they come back from
    // JSON.parse. Inventing a second canonical form here would violate
    // PROVENANCE_SPEC.md §4's "one canonical form" rule, not honor it.
    payload: JSON.stringify(event.payload),
    storedAt,
  };
}

export function rowToEvent(row: EventRow): ProvenanceEvent {
  return createProvenanceEvent({
    eventId: asEventId(row.eventId),
    projectId: asProjectId(row.projectId),
    ...(row.workReference !== null ? { workReference: asWorkReferenceId(row.workReference) } : {}),
    sessionId: asSessionId(row.sessionId),
    actorProfileId: asProfileId(row.actorProfileId),
    deviceId: asDeviceId(row.deviceId),
    source: row.source as EventSource,
    eventType: row.eventType as EventType,
    ...(row.assetId !== null ? { assetId: asAssetId(row.assetId) } : {}),
    ...(row.trackReference !== null ? { trackReference: row.trackReference } : {}),
    occurredAt: row.occurredAt,
    ...(row.receivedAt !== null ? { receivedAt: row.receivedAt } : {}),
    payload: JSON.parse(row.payload) as Record<string, JsonValue>,
  });
}

export interface CheckpointRow {
  readonly id: string;
  readonly projectId: string;
  readonly workReference: string | null;
  readonly sessionId: string;
  readonly actorProfileId: string;
  readonly sequence: number;
  readonly previousCheckpointHash: string | null;
  readonly manifestHash: string;
  readonly checkpointHash: string;
  readonly triggerType: string;
  readonly createdAt: string;
  readonly storedAt: string;
}

export function checkpointToRow(checkpoint: ProvenanceCheckpoint, storedAt: string): CheckpointRow {
  return {
    id: checkpoint.id,
    projectId: checkpoint.projectId,
    workReference: checkpoint.workReference ?? null,
    sessionId: checkpoint.sessionId,
    actorProfileId: checkpoint.actorProfileId,
    sequence: checkpoint.sequence,
    previousCheckpointHash: checkpoint.previousCheckpointHash ?? null,
    manifestHash: checkpoint.manifestHash,
    checkpointHash: checkpoint.checkpointHash,
    triggerType: checkpoint.triggerType,
    createdAt: checkpoint.createdAt,
    storedAt,
  };
}

export function rowToCheckpoint(row: CheckpointRow): ProvenanceCheckpoint {
  return createProvenanceCheckpoint({
    id: asCheckpointId(row.id),
    projectId: asProjectId(row.projectId),
    ...(row.workReference !== null ? { workReference: asWorkReferenceId(row.workReference) } : {}),
    sessionId: asSessionId(row.sessionId),
    actorProfileId: asProfileId(row.actorProfileId),
    sequence: row.sequence,
    ...(row.previousCheckpointHash !== null ? { previousCheckpointHash: row.previousCheckpointHash } : {}),
    manifestHash: row.manifestHash,
    checkpointHash: row.checkpointHash,
    triggerType: row.triggerType as CheckpointTriggerType,
    createdAt: row.createdAt,
  });
}

export interface BatchRow {
  readonly id: string;
  readonly profileId: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly eventCount: number;
  readonly firstEventAt: string;
  readonly lastEventAt: string;
  readonly previousBatchHash: string | null;
  readonly manifestHash: string;
  readonly signature: string | null;
  readonly createdAt: string;
  readonly storedAt: string;
}

export interface BatchValidationStateRow {
  readonly batchId: string;
  readonly validationStatus: string;
  readonly statusAt: string;
  readonly storedAt: string;
}

/** `batches` never carries `validationStatus` — see schema.ts's docstring. */
export function batchToRow(batch: ProvenanceBatch, storedAt: string): BatchRow {
  return {
    id: batch.id,
    profileId: batch.profileId,
    deviceId: batch.deviceId,
    sessionId: batch.sessionId,
    eventCount: batch.eventCount,
    firstEventAt: batch.firstEventAt,
    lastEventAt: batch.lastEventAt,
    previousBatchHash: batch.previousBatchHash ?? null,
    manifestHash: batch.manifestHash,
    signature: batch.signature ?? null,
    createdAt: batch.createdAt,
    storedAt,
  };
}

/**
 * Reconstructs a full `ProvenanceBatch`, including `validationStatus`
 * composed back in from the separate `batch_validation_state` row. This is
 * the object shape `verifySignedBatch` expects — its signature-relevant
 * fields (everything except `validationStatus` itself) come only from the
 * immutable `batches` row, which is exactly what makes the round-trip
 * signature invariant hold: `validationStatus` can never have been part of
 * what made a stored batch's signature valid or invalid in the first place.
 */
export function rowToBatch(row: BatchRow, validationState: BatchValidationStateRow | undefined): ProvenanceBatch {
  return createProvenanceBatch({
    id: asBatchId(row.id),
    profileId: asProfileId(row.profileId),
    deviceId: asDeviceId(row.deviceId),
    sessionId: asSessionId(row.sessionId),
    eventCount: row.eventCount,
    firstEventAt: row.firstEventAt,
    lastEventAt: row.lastEventAt,
    ...(row.previousBatchHash !== null ? { previousBatchHash: row.previousBatchHash } : {}),
    manifestHash: row.manifestHash,
    ...(row.signature !== null ? { signature: row.signature } : {}),
    validationStatus: (validationState?.validationStatus as BatchValidationStatus | undefined) ?? 'pending',
    createdAt: row.createdAt,
  });
}

export interface ContributorReferenceRow {
  readonly id: string;
  readonly projectId: string;
  readonly profileId: string;
  readonly role: string;
  readonly subrole: string | null;
  readonly description: string | null;
  readonly claimedAt: string;
  readonly storedAt: string;
}

export function contributorReferenceToRow(claim: ContributorReference, storedAt: string): ContributorReferenceRow {
  return {
    id: claim.id,
    projectId: claim.projectId,
    profileId: claim.profileId,
    role: claim.role,
    subrole: claim.subrole ?? null,
    description: claim.description ?? null,
    claimedAt: claim.claimedAt,
    storedAt,
  };
}

export function rowToContributorReference(row: ContributorReferenceRow): ContributorReference {
  return createContributorReference({
    id: asContributionClaimId(row.id),
    projectId: asProjectId(row.projectId),
    profileId: asProfileId(row.profileId),
    role: row.role as ContributionRole,
    ...(row.subrole !== null ? { subrole: row.subrole } : {}),
    ...(row.description !== null ? { description: row.description } : {}),
    claimedAt: row.claimedAt,
  });
}

export interface ProjectAssetRow {
  readonly id: string;
  readonly projectId: string;
  readonly workReference: string | null;
  readonly createdByProfileId: string | null;
  readonly introducedBySessionId: string;
  readonly assetType: string;
  readonly sourceType: string;
  readonly originalFilename: string | null;
  readonly sha256: string;
  readonly sizeBytes: number | null;
  readonly firstSeenAt: string;
  readonly originStatus: string;
  readonly rightsStatus: string | null;
  readonly storedAt: string;
}

export function projectAssetToRow(asset: ProjectAsset, storedAt: string): ProjectAssetRow {
  return {
    id: asset.id,
    projectId: asset.projectId,
    workReference: asset.workReference ?? null,
    createdByProfileId: asset.createdByProfileId ?? null,
    introducedBySessionId: asset.introducedBySessionId,
    assetType: asset.assetType,
    sourceType: asset.sourceType,
    originalFilename: asset.originalFilename ?? null,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes ?? null,
    firstSeenAt: asset.firstSeenAt,
    originStatus: asset.originStatus,
    rightsStatus: asset.rightsStatus ?? null,
    storedAt,
  };
}

export function rowToProjectAsset(row: ProjectAssetRow): ProjectAsset {
  return createProjectAsset({
    id: asAssetId(row.id),
    projectId: asProjectId(row.projectId),
    ...(row.workReference !== null ? { workReference: asWorkReferenceId(row.workReference) } : {}),
    ...(row.createdByProfileId !== null ? { createdByProfileId: asProfileId(row.createdByProfileId) } : {}),
    introducedBySessionId: asSessionId(row.introducedBySessionId),
    assetType: row.assetType as AssetType,
    sourceType: row.sourceType as SourceType,
    ...(row.originalFilename !== null ? { originalFilename: row.originalFilename } : {}),
    sha256: row.sha256,
    ...(row.sizeBytes !== null ? { sizeBytes: row.sizeBytes } : {}),
    firstSeenAt: row.firstSeenAt,
    originStatus: row.originStatus as OriginStatus,
    ...(row.rightsStatus !== null ? { rightsStatus: row.rightsStatus as RightsVerificationStatus } : {}),
  });
}
