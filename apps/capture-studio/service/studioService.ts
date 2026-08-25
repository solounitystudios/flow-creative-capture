import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  asAssetId,
  asCheckpointId,
  asContributionClaimId,
  asDeviceId,
  asEventId,
  asExternalProjectPassportId,
  asOrganizationId,
  asProfileId,
  asProjectId,
  asSessionId,
} from '../../../src/domain/ids.js';
import type { ProjectId } from '../../../src/domain/ids.js';
import {
  CHECKPOINT_TRIGGER_TYPES,
  SOURCE_TYPES,
  type CheckpointTriggerType,
  type Platform,
  type ProjectStatus,
  type ProjectType,
  type SourceType,
} from '../../../src/domain/enums.js';
import { createCreativeProject, type CreativeProject } from '../../../src/domain/creativeProject.js';
import { createStudioDevice } from '../../../src/domain/studioDevice.js';
import { createStudioSession, endStudioSession, type StudioSession } from '../../../src/domain/studioSession.js';
import { createProvenanceEvent, type ProvenanceEvent } from '../../../src/domain/provenanceEvent.js';
import { createProjectAsset, type ProjectAsset } from '../../../src/domain/projectAsset.js';
import { createContributorReference, type ContributorReference } from '../../../src/domain/contributorReference.js';
import { CONTRIBUTION_ROLES, type ContributionRole } from '../../../src/domain/roles.js';
import type { ProvenanceCheckpoint } from '../../../src/domain/provenanceCheckpoint.js';
import { hashBytes } from '../../../src/crypto/sha256.js';
import { createDeviceIdentity, loadDeviceIdentity, type DeviceIdentity } from '../../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../../src/device/keyStore.js';
import { signProvenanceCheckpoint } from '../../../src/device/checkpointSigning.js';
import { createCheckpointFromManifest, validateCheckpointChain } from '../../../src/provenance/checkpoint.js';
import type { CheckpointManifestAssetEntry } from '../../../src/provenance/manifest.js';
import { LocalEvidenceStore } from '../../../src/store/evidenceStore.js';
import { evaluateStoredCheckpointTrust, type CheckpointTrustEvaluation } from '../../../src/trust/checkpointTrust.js';
import { detectAssetType } from './mediaType.js';
import { shouldAutoCheckpointOnSessionEnd } from './checkpointPolicy.js';
import { badRequest, notFound, StudioServiceError } from './errors.js';

/**
 * Capture Studio V1's local Studio service boundary.
 *
 * This is the ONLY place in `apps/capture-studio` that touches
 * `node:sqlite`, `node:crypto`-backed device signing, or the filesystem —
 * exactly the boundary the approved pass specifies:
 *
 *   Capture Studio React UI -> local Studio service/API -> Creative
 *   Capture engine -> LocalEvidenceStore / SQLite
 *
 * The browser never receives private key material, never opens the
 * SQLite file, and never touches `node:crypto` — it only ever talks JSON
 * (plus raw file bytes for ingestion) to this service over HTTP
 * (`service/http.ts`). See that module for the request boundary itself.
 *
 * This service owns exactly ONE local device identity (`LOCAL_DEVICE_ID`)
 * — Capture Studio V1 has no accounts/auth system (see AGENTS.md's
 * repository boundary: that is flow-platform's concern, not this
 * repo's), so there is no notion of "which device" beyond "this local
 * Studio Companion install." `profileId` values throughout are plain
 * caller-supplied strings, exactly as the domain model already treats
 * them — this service does not invent an identity system on top.
 *
 * Capture Studio V2 (Live Signed Evidence Checkpoints) adds the checkpoint
 * write path V1 deliberately stopped short of: `createCheckpoint` builds a
 * `CheckpointManifest` from this project's currently known assets and the
 * events captured since the previous checkpoint, derives the checkpoint
 * hash (chained to the project's previous checkpoint via
 * `previousCheckpointHash`), signs it with this service's own persistent
 * `DeviceIdentity` (`signProvenanceCheckpoint`), and persists the signed
 * record. `endSession` automatically cuts a `session_end` checkpoint when
 * there is new evidence to close out (`checkpointPolicy.ts` — the ONE
 * centralized, testable trigger decision this service makes on its own;
 * every other checkpoint is caller-requested). No batch assembly/signing
 * is added by V2 — checkpoints are the live-signed-evidence unit this pass
 * implements; `ProvenanceBatch` remains available at the store/engine
 * layer for a future offline-capture capability, unused by this service.
 */

const LOCAL_DEVICE_ID = asDeviceId('device-capture-studio-local');
const LOCAL_DEVICE_OWNER_PROFILE_ID = asProfileId('local-studio-device-owner');
const STUDIO_SERVICE_APP_VERSION = 'capture-studio-service-0.1.0';

function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'other';
  }
}

export interface ProjectSnapshot {
  readonly project: CreativeProject;
  readonly sessions: readonly StudioSession[];
  readonly assets: readonly ProjectAsset[];
  readonly contributorClaims: readonly ContributorReference[];
  readonly events: readonly ProvenanceEvent[];
}

export interface CreateProjectInput {
  readonly ownerProfileId: string;
  readonly title: string;
  readonly projectType: ProjectType;
  readonly status?: ProjectStatus;
  readonly organizationId?: string;
  readonly externalProjectPassportId?: string;
}

export interface StartSessionInput {
  readonly actorProfileId: string;
}

export interface IngestAssetInput {
  readonly originalFilename?: string;
  readonly mimeType?: string;
  readonly createdByProfileId?: string;
  readonly sourceType?: string;
}

export interface AddContributorClaimInput {
  readonly sessionId: string;
  readonly profileId: string;
  readonly role: string;
  readonly subrole?: string;
  readonly description?: string;
}

export interface CreateCheckpointInput {
  readonly actorProfileId: string;
  readonly triggerType?: string;
}

export class StudioService {
  private readonly store: LocalEvidenceStore;
  private readonly deviceIdentity: DeviceIdentity;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.store = new LocalEvidenceStore(join(dataDir, 'evidence.db'));

    const keyStore = new FileDeviceKeyStore(join(dataDir, 'keys'));
    const now = new Date().toISOString();
    const existing = loadDeviceIdentity(keyStore, LOCAL_DEVICE_ID);
    if (existing !== undefined) {
      this.deviceIdentity = existing;
    } else {
      const created = createDeviceIdentity(keyStore, {
        deviceId: LOCAL_DEVICE_ID,
        profileId: LOCAL_DEVICE_OWNER_PROFILE_ID,
        platform: detectPlatform(),
        appVersion: STUDIO_SERVICE_APP_VERSION,
        verifiedAt: now,
      });
      this.deviceIdentity = created.identity;
    }

    if (this.store.getDevice(LOCAL_DEVICE_ID) === undefined) {
      this.store.insertDevice(
        // Reconstructed the same way `createDeviceIdentity` would have —
        // see `service/studioService.ts`'s own device-bootstrap logic
        // above, which already derived `this.deviceIdentity` either way.
        createLocalDeviceRecord(this.deviceIdentity, now),
        this.deviceIdentity.publicKeySpkiDer,
        now,
      );
    }
  }

  close(): void {
    this.store.close();
  }

  // ---- Projects ---------------------------------------------------------

  createProject(input: CreateProjectInput): CreativeProject {
    if (input.title.trim().length === 0) {
      throw badRequest('title must not be empty');
    }
    const now = new Date().toISOString();
    const project = createCreativeProject({
      id: asProjectId(randomUUID()),
      ownerProfileId: asProfileId(input.ownerProfileId),
      title: input.title,
      projectType: input.projectType,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.organizationId !== undefined ? { organizationId: asOrganizationId(input.organizationId) } : {}),
      ...(input.externalProjectPassportId !== undefined
        ? { externalProjectPassportId: asExternalProjectPassportId(input.externalProjectPassportId) }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    this.store.insertProject(project, now);
    return project;
  }

  listProjects(): CreativeProject[] {
    return this.store.listProjects();
  }

  getProjectSnapshot(projectIdRaw: string): ProjectSnapshot {
    const projectId = asProjectId(projectIdRaw);
    const project = this.store.getProject(projectId);
    if (project === undefined) {
      throw notFound(`Project ${projectIdRaw} was not found`);
    }
    const sessions = this.store.listSessionsForProject(projectId);
    const assets = this.store.listProjectAssetsForProject(projectId);
    const contributorClaims = this.store.listContributorReferencesForProject(projectId);
    const events = this.listProjectEventsSorted(projectId, sessions);

    return { project, sessions, assets, contributorClaims, events };
  }

  /**
   * All of a project's events, across all of its sessions, in chronological
   * order (occurredAt, then eventId as a deterministic tiebreaker) — the
   * same ordering rule `getProjectSnapshot` already used. Shared with
   * `createCheckpoint`, which needs exactly this to compute a checkpoint's
   * event boundary (the events folded in since the previous checkpoint).
   */
  private listProjectEventsSorted(projectId: ProjectId, sessions?: readonly StudioSession[]): ProvenanceEvent[] {
    const projectSessions = sessions ?? this.store.listSessionsForProject(projectId);
    return projectSessions
      .flatMap((session) => this.store.listEventsForSession(session.id))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.eventId < b.eventId ? -1 : 1));
  }

  private requireProject(projectIdRaw: string): ProjectId {
    const projectId = asProjectId(projectIdRaw);
    if (this.store.getProject(projectId) === undefined) {
      throw notFound(`Project ${projectIdRaw} was not found`);
    }
    return projectId;
  }

  private requireSessionInProject(projectId: ProjectId, sessionIdRaw: string): StudioSession {
    const session = this.store.getSession(asSessionId(sessionIdRaw));
    if (session === undefined || session.projectId !== projectId) {
      throw notFound(`Session ${sessionIdRaw} was not found in project ${projectId}`);
    }
    return session;
  }

  // ---- Sessions -----------------------------------------------------------

  startSession(projectIdRaw: string, input: StartSessionInput): StudioSession {
    const projectId = this.requireProject(projectIdRaw);
    const now = new Date().toISOString();
    const actorProfileId = asProfileId(input.actorProfileId);

    const session = createStudioSession({
      id: asSessionId(randomUUID()),
      projectId,
      actorProfileId,
      deviceId: this.deviceIdentity.deviceId,
      daw: 'other',
      startedAt: now,
    });
    const sessionStarted = createProvenanceEvent({
      eventId: asEventId(randomUUID()),
      projectId,
      sessionId: session.id,
      actorProfileId,
      deviceId: this.deviceIdentity.deviceId,
      source: 'capture_studio',
      eventType: 'session_started',
      occurredAt: now,
    });

    this.store.insertEvidenceBundle({ session, events: [sessionStarted], storedAt: now });
    return session;
  }

  /**
   * Ends a session and records the ending event. Deliberately NOT wrapped
   * in `insertEvidenceBundle`'s atomic grouping — `store.endSession` writes
   * to the separate, exactly-once `session_ends` table (see schema.ts),
   * the same "terminal transition as its own fact table" posture
   * `revokeDevice` already has, and `addContributorClaim` already
   * establishes the precedent of a session-adjacent write plus its event
   * happening sequentially rather than transactionally here.
   *
   * After ending, applies Capture Studio V2's ONE automatic checkpoint
   * trigger (`checkpointPolicy.ts`'s `shouldAutoCheckpointOnSessionEnd`):
   * if there is new evidence since the project's previous checkpoint, a
   * `session_end`-triggered signed checkpoint is cut. This keeps the
   * policy decision centralized and testable rather than inlined here.
   */
  endSession(projectIdRaw: string, sessionIdRaw: string): StudioSession {
    const projectId = this.requireProject(projectIdRaw);
    const session = this.requireSessionInProject(projectId, sessionIdRaw);
    const now = new Date().toISOString();

    // Domain-level validation (rejects double-ending, endedAt < startedAt)
    // happens here, through the same factory every other transition in
    // this codebase goes through — the store write below only persists
    // what this already validated. `endStudioSession` always produces
    // status 'ended'; 'abandoned' has no caller-facing trigger in V1/V2.
    endStudioSession(session, now);

    // Decide whether there is new evidence worth an automatic checkpoint
    // BEFORE recording the session_ended event itself — the lifecycle
    // marker for "this session ended" must never itself count as the
    // "new evidence" that justifies cutting a checkpoint, or every
    // session end would trigger one regardless of whether anything was
    // actually captured.
    const previousCheckpoint = this.store.listCheckpointsForProject(projectId).at(-1);
    const pendingEventCount = this.eventsFoldedIntoNextCheckpoint(projectId, previousCheckpoint).length;
    const shouldCheckpoint = shouldAutoCheckpointOnSessionEnd(pendingEventCount);

    this.store.endSession(session.id, now, 'ended', now);
    const sessionEndedEvent = createProvenanceEvent({
      eventId: asEventId(randomUUID()),
      projectId,
      sessionId: session.id,
      actorProfileId: session.actorProfileId,
      deviceId: this.deviceIdentity.deviceId,
      source: 'capture_studio',
      eventType: 'session_ended',
      occurredAt: now,
    });
    this.store.insertEvent(sessionEndedEvent, now);

    if (shouldCheckpoint) {
      this.createCheckpoint(projectIdRaw, sessionIdRaw, {
        actorProfileId: session.actorProfileId,
        triggerType: 'session_end',
      });
    }

    const ended = this.store.getSession(session.id);
    if (ended === undefined) {
      throw notFound(`Session ${sessionIdRaw} was not found in project ${projectIdRaw}`);
    }
    return ended;
  }

  // ---- Asset ingestion ------------------------------------------------------

  ingestAsset(projectIdRaw: string, sessionIdRaw: string, fileBytes: Buffer, input: IngestAssetInput): ProjectAsset {
    const projectId = this.requireProject(projectIdRaw);
    const session = this.requireSessionInProject(projectId, sessionIdRaw);

    if (fileBytes.length === 0) {
      throw badRequest('Uploaded file is empty');
    }
    const sourceType: SourceType = validateSourceType(input.sourceType);
    const assetType = detectAssetType(input.originalFilename, input.mimeType);
    const sha256 = hashBytes(fileBytes);
    const now = new Date().toISOString();

    const asset = createProjectAsset({
      id: asAssetId(randomUUID()),
      projectId,
      ...(input.createdByProfileId !== undefined ? { createdByProfileId: asProfileId(input.createdByProfileId) } : {}),
      introducedBySessionId: session.id,
      assetType,
      sourceType,
      ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
      sha256,
      sizeBytes: fileBytes.length,
      firstSeenAt: now,
    });
    const ingestEvent = createProvenanceEvent({
      eventId: asEventId(randomUUID()),
      projectId,
      sessionId: session.id,
      actorProfileId: session.actorProfileId,
      deviceId: this.deviceIdentity.deviceId,
      source: 'capture_studio',
      eventType: 'asset_imported',
      assetId: asset.id,
      occurredAt: now,
    });

    this.store.insertEvidenceBundle({ events: [ingestEvent], asset, storedAt: now });
    return asset;
  }

  // ---- Contributor claims ---------------------------------------------------

  addContributorClaim(projectIdRaw: string, input: AddContributorClaimInput): ContributorReference {
    const projectId = this.requireProject(projectIdRaw);
    const session = this.requireSessionInProject(projectId, input.sessionId);
    const now = new Date().toISOString();
    const profileId = asProfileId(input.profileId);
    const role = validateContributionRole(input.role);

    const claim = createContributorReference({
      id: asContributionClaimId(randomUUID()),
      projectId,
      profileId,
      role,
      ...(input.subrole !== undefined ? { subrole: input.subrole } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      claimedAt: now,
    });
    // Deliberately NOT part of insertEvidenceBundle's atomic grouping —
    // see LocalEvidenceStore.insertContributorReference's own docstring:
    // a contribution claim is a separate kind of act from captured
    // evidence, kept structurally outside that transaction on purpose.
    this.store.insertContributorReference(claim, now);

    const claimEvent = createProvenanceEvent({
      eventId: asEventId(randomUUID()),
      projectId,
      sessionId: session.id,
      actorProfileId: session.actorProfileId,
      deviceId: this.deviceIdentity.deviceId,
      source: 'capture_studio',
      eventType: 'contributor_added',
      occurredAt: now,
      payload: {
        profileId: claim.profileId,
        role: claim.role,
        ...(claim.subrole !== undefined ? { subrole: claim.subrole } : {}),
      },
    });
    this.store.insertEvent(claimEvent, now);

    return claim;
  }

  // ---- Checkpoints (Capture Studio V2 — Live Signed Evidence Checkpoints) ---

  /**
   * The project's events folded into the NEXT checkpoint: everything
   * after `previous`'s `createdAt` (all project events if there is no
   * previous checkpoint yet), in the same chronological order
   * `listProjectEventsSorted` already establishes — never reordered, per
   * PROVENANCE_SPEC.md §6 ("eventIds order is semantic... never sorted").
   */
  private eventsFoldedIntoNextCheckpoint(projectId: ProjectId, previous: ProvenanceCheckpoint | undefined): ProvenanceEvent[] {
    const allEvents = this.listProjectEventsSorted(projectId);
    return previous === undefined ? allEvents : allEvents.filter((event) => event.occurredAt > previous.createdAt);
  }

  /**
   * Creates a real, live signed checkpoint from this project's current
   * state: a `CheckpointManifest` built from the project's currently known
   * assets (`ProjectAsset` rows) and the events captured since the
   * project's previous checkpoint (project-WIDE chaining — see this
   * method's own sequence/previousCheckpointHash derivation below, always
   * scoped to `projectId`, never to one session; a checkpoint therefore
   * can never link to another project's checkpoint, by construction). The
   * checkpoint is signed with this service's own persistent
   * `DeviceIdentity` before ever being persisted, so there is no
   * checkpoint-without-signature intermediate state to leave orphaned —
   * `signature` is a column on the same row `insertEvidenceBundle` writes
   * atomically, not a separate write that could fail independently.
   */
  createCheckpoint(projectIdRaw: string, sessionIdRaw: string, input: CreateCheckpointInput): ProvenanceCheckpoint {
    const projectId = this.requireProject(projectIdRaw);
    const session = this.requireSessionInProject(projectId, sessionIdRaw);
    const actorProfileId = asProfileId(input.actorProfileId);
    const triggerType = validateCheckpointTriggerType(input.triggerType);
    const now = new Date().toISOString();

    const existingCheckpoints = this.store.listCheckpointsForProject(projectId);
    const previous = existingCheckpoints.at(-1);
    const sequence = previous !== undefined ? previous.sequence + 1 : 0;

    const assets = this.store.listProjectAssetsForProject(projectId);
    const manifestAssets: CheckpointManifestAssetEntry[] = assets.map((asset) => ({
      assetId: asset.id,
      sha256: asset.sha256,
      assetType: asset.assetType,
    }));
    const eventIds = this.eventsFoldedIntoNextCheckpoint(projectId, previous).map((event) => event.eventId);

    const unsigned = createCheckpointFromManifest({
      id: asCheckpointId(randomUUID()),
      projectId,
      sessionId: session.id,
      actorProfileId,
      deviceId: this.deviceIdentity.deviceId,
      sequence,
      ...(previous !== undefined ? { previousCheckpointHash: previous.checkpointHash } : {}),
      manifest: { projectId, assets: manifestAssets, eventIds },
      triggerType,
      createdAt: now,
    });

    // Defense in depth: confirm the freshly built checkpoint actually
    // extends the project's existing chain validly before ever persisting
    // it — "detect and reject inconsistent sequence/hash state" (V2
    // mission brief), even though sequence/previousCheckpointHash above
    // are always derived from the store's own current state in this
    // single-writer local service, so this should never actually fail in
    // practice; it is a cheap, explicit guard rather than an assumption.
    const chainCheck = validateCheckpointChain([...existingCheckpoints, unsigned]);
    if (!chainCheck.valid) {
      throw new StudioServiceError(`Refusing to create an inconsistent checkpoint: ${chainCheck.errors.join('; ')}`, 409);
    }

    const signed = signProvenanceCheckpoint(unsigned, this.deviceIdentity);
    this.store.insertEvidenceBundle({ checkpoint: signed, storedAt: now });
    return signed;
  }

  listCheckpoints(projectIdRaw: string): ProvenanceCheckpoint[] {
    const projectId = this.requireProject(projectIdRaw);
    return this.store.listCheckpointsForProject(projectId);
  }

  getCheckpoint(projectIdRaw: string, checkpointIdRaw: string): ProvenanceCheckpoint {
    const projectId = this.requireProject(projectIdRaw);
    const checkpoint = this.store.getCheckpoint(asCheckpointId(checkpointIdRaw));
    if (checkpoint === undefined || checkpoint.projectId !== projectId) {
      throw notFound(`Checkpoint ${checkpointIdRaw} was not found in project ${projectIdRaw}`);
    }
    return checkpoint;
  }

  /**
   * Independently verifies a persisted checkpoint's manifest hash,
   * signature, chain linkage, sequence, and signing-device trust —
   * without ever touching private key material (`evaluateStoredCheckpointTrust`
   * reads only the device's stored PUBLIC key). See `src/trust/
   * checkpointTrust.ts` for the returned `CheckpointTrustEvaluation`'s
   * exact status/reason vocabulary.
   */
  verifyCheckpoint(projectIdRaw: string, checkpointIdRaw: string): CheckpointTrustEvaluation {
    const checkpoint = this.getCheckpoint(projectIdRaw, checkpointIdRaw);
    const evaluation = evaluateStoredCheckpointTrust(this.store, checkpoint.id);
    if (evaluation === undefined) {
      throw notFound(`Checkpoint ${checkpointIdRaw} was not found`);
    }
    return evaluation;
  }
}

function validateSourceType(raw: string | undefined): SourceType {
  if (raw === undefined) {
    return 'imported_unknown';
  }
  if (!(SOURCE_TYPES as readonly string[]).includes(raw)) {
    throw badRequest(`sourceType "${raw}" is not recognized`);
  }
  return raw as SourceType;
}

/**
 * `createContributorReference` (`src/domain/contributorReference.ts`)
 * validates `subrole` against `role` when a subrole is given, but does
 * NOT validate `role` itself against `CONTRIBUTION_ROLES` — an
 * unrecognized role passed with no subrole is silently accepted, and one
 * passed WITH a subrole throws a raw `TypeError` from
 * `isValidSubrole`'s `SUBROLES_BY_ROLE[role]` lookup rather than a clean
 * domain validation error. This is a pre-existing gap in shared engine
 * code, out of scope to fix in this pass (see the final implementation
 * report) — this service validates `role` itself, at its own boundary,
 * before ever calling the domain factory, exactly like `validateSourceType`
 * above.
 */
function validateContributionRole(raw: string): ContributionRole {
  if (!(CONTRIBUTION_ROLES as readonly string[]).includes(raw)) {
    throw badRequest(`role "${raw}" is not recognized`);
  }
  return raw as ContributionRole;
}

function validateCheckpointTriggerType(raw: string | undefined): CheckpointTriggerType {
  if (raw === undefined) {
    return 'manual';
  }
  if (!(CHECKPOINT_TRIGGER_TYPES as readonly string[]).includes(raw)) {
    throw badRequest(`triggerType "${raw}" is not recognized`);
  }
  return raw as CheckpointTriggerType;
}

function createLocalDeviceRecord(identity: DeviceIdentity, verifiedAt: string) {
  // Mirrors exactly what `createDeviceIdentity` would have produced for
  // this fingerprint, going through the same domain factory every other
  // device record in this codebase goes through — kept in one small
  // local helper (rather than exporting a second device-record
  // constructor from `src/device`) since it only ever needs to run once
  // per fresh `dataDir`.
  return createStudioDevice({
    id: identity.deviceId,
    profileId: LOCAL_DEVICE_OWNER_PROFILE_ID,
    devicePublicId: `pub-${identity.fingerprint.slice(0, 32)}`,
    platform: detectPlatform(),
    appVersion: STUDIO_SERVICE_APP_VERSION,
    deviceKeyFingerprint: identity.fingerprint,
    verifiedAt,
  });
}
