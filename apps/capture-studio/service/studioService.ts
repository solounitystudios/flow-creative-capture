import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  asAssetId,
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
import { SOURCE_TYPES, type Platform, type ProjectStatus, type ProjectType, type SourceType } from '../../../src/domain/enums.js';
import { createCreativeProject, type CreativeProject } from '../../../src/domain/creativeProject.js';
import { createStudioDevice } from '../../../src/domain/studioDevice.js';
import { createStudioSession, type StudioSession } from '../../../src/domain/studioSession.js';
import { createProvenanceEvent, type ProvenanceEvent } from '../../../src/domain/provenanceEvent.js';
import { createProjectAsset, type ProjectAsset } from '../../../src/domain/projectAsset.js';
import { createContributorReference, type ContributorReference } from '../../../src/domain/contributorReference.js';
import { CONTRIBUTION_ROLES, type ContributionRole } from '../../../src/domain/roles.js';
import { hashBytes } from '../../../src/crypto/sha256.js';
import { createDeviceIdentity, loadDeviceIdentity, type DeviceIdentity } from '../../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../../src/device/keyStore.js';
import { LocalEvidenceStore } from '../../../src/store/evidenceStore.js';
import { detectAssetType } from './mediaType.js';
import { badRequest, notFound } from './errors.js';

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
 * No signed batch is created by this service. Capture Studio V1's write
 * path persists real sessions/events/assets/contributor claims through
 * the real engine, but stops short of checkpoint/batch assembly and
 * signing — those remain a separate, later capability over the same
 * store, exactly like any other `LocalEvidenceStore` consumer. See the
 * final implementation report for why this line was drawn here.
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
    const events = sessions
      .flatMap((session) => this.store.listEventsForSession(session.id))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.eventId < b.eventId ? -1 : 1));

    return { project, sessions, assets, contributorClaims, events };
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
