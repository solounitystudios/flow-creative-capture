/**
 * The ONLY thing in `apps/capture-studio/src` (the browser bundle) that
 * talks to the local Studio service. Every type below is `import type`
 * only — erased at compile time, zero runtime dependency on the core
 * engine, exactly like `../data/fixtureTypes.ts` already establishes for
 * the Cold Nights demo fixture. This file never imports a runtime value
 * from `src/domain`/`src/store`/`src/device`/etc., and never will: those
 * modules ultimately touch `node:crypto`/`node:sqlite`, which the local
 * Studio service (`apps/capture-studio/service`) owns on this app's
 * behalf. See `service/studioService.ts`'s docstring for the full
 * boundary statement this file is the browser-side half of.
 */
import type { CreativeProject } from '../../../../src/domain/creativeProject.js';
import type { StudioSession } from '../../../../src/domain/studioSession.js';
import type { ProjectAsset } from '../../../../src/domain/projectAsset.js';
import type { ContributorReference } from '../../../../src/domain/contributorReference.js';
import type { ProvenanceEvent } from '../../../../src/domain/provenanceEvent.js';
import type { ProvenanceCheckpoint } from '../../../../src/domain/provenanceCheckpoint.js';
import type { CheckpointTrustEvaluation } from '../../../../src/trust/checkpointTrust.js';

const BASE_URL: string =
  (import.meta.env['VITE_STUDIO_SERVICE_URL'] as string | undefined) ?? 'http://localhost:4756';

export class StudioClientError extends Error {}

export interface ProjectSnapshot {
  readonly project: CreativeProject;
  readonly sessions: readonly StudioSession[];
  readonly assets: readonly ProjectAsset[];
  readonly contributorClaims: readonly ContributorReference[];
  readonly events: readonly ProvenanceEvent[];
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Studio service request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // Response body wasn't JSON — keep the generic status-based message.
    }
    throw new StudioClientError(message);
  }
  return (await res.json()) as T;
}

export async function listProjects(): Promise<CreativeProject[]> {
  const res = await fetch(`${BASE_URL}/projects`);
  return parseJsonOrThrow<CreativeProject[]>(res);
}

export interface CreateProjectInput {
  readonly ownerProfileId: string;
  readonly title: string;
  readonly projectType: string;
}

export async function createProject(input: CreateProjectInput): Promise<CreativeProject> {
  const res = await fetch(`${BASE_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<CreativeProject>(res);
}

export async function getProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const res = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/snapshot`);
  return parseJsonOrThrow<ProjectSnapshot>(res);
}

export async function startSession(projectId: string, actorProfileId: string): Promise<StudioSession> {
  const res = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorProfileId }),
  });
  return parseJsonOrThrow<StudioSession>(res);
}

export interface IngestAssetInput {
  readonly createdByProfileId?: string;
}

export async function ingestAsset(
  projectId: string,
  sessionId: string,
  file: File,
  input: IngestAssetInput = {},
): Promise<ProjectAsset> {
  const params = new URLSearchParams();
  params.set('originalFilename', file.name);
  if (file.type.length > 0) {
    params.set('mimeType', file.type);
  }
  if (input.createdByProfileId !== undefined && input.createdByProfileId.trim().length > 0) {
    params.set('createdByProfileId', input.createdByProfileId);
  }

  const res = await fetch(
    `${BASE_URL}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/assets?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    },
  );
  return parseJsonOrThrow<ProjectAsset>(res);
}

export interface AddContributorClaimInput {
  readonly sessionId: string;
  readonly profileId: string;
  readonly role: string;
  readonly subrole?: string;
  readonly description?: string;
}

export async function addContributorClaim(
  projectId: string,
  input: AddContributorClaimInput,
): Promise<ContributorReference> {
  const res = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/contributor-claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<ContributorReference>(res);
}

export async function endSession(projectId: string, sessionId: string): Promise<StudioSession> {
  const res = await fetch(
    `${BASE_URL}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST' },
  );
  return parseJsonOrThrow<StudioSession>(res);
}

export interface CreateCheckpointInput {
  readonly actorProfileId: string;
  readonly triggerType?: string;
}

export async function createCheckpoint(
  projectId: string,
  sessionId: string,
  input: CreateCheckpointInput,
): Promise<ProvenanceCheckpoint> {
  const res = await fetch(
    `${BASE_URL}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return parseJsonOrThrow<ProvenanceCheckpoint>(res);
}

export async function listCheckpoints(projectId: string): Promise<ProvenanceCheckpoint[]> {
  const res = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/checkpoints`);
  return parseJsonOrThrow<ProvenanceCheckpoint[]>(res);
}

export async function verifyCheckpoint(projectId: string, checkpointId: string): Promise<CheckpointTrustEvaluation> {
  const res = await fetch(
    `${BASE_URL}/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}/verify`,
    { method: 'POST' },
  );
  return parseJsonOrThrow<CheckpointTrustEvaluation>(res);
}
