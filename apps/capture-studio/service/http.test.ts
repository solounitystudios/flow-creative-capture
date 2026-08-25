import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStudioHttpServer } from './http.js';
import { StudioService } from './studioService.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';

let dataDir: string;
let service: StudioService;
let server: ReturnType<typeof createStudioHttpServer>;
let baseUrl: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'flow-studio-http-test-'));
  service = new StudioService(dataDir);
  server = createStudioHttpServer(service, { allowedOrigin: ALLOWED_ORIGIN });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  service.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function createProject(title = 'Cold Nights') {
  const res = await fetch(`${baseUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerProfileId: 'profile-1', title, projectType: 'song' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function startSession(projectId: string) {
  const res = await fetch(`${baseUrl}/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorProfileId: 'profile-1' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe('Studio HTTP service — end to end', () => {
  it('responds to /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('sets CORS headers scoped to the configured allowed origin, not a wildcard', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('creates a project, starts a session, ingests a file, and adds a contributor claim end to end', async () => {
    const project = await createProject();
    const session = await startSession(project.id);

    const fileBytes = new TextEncoder().encode('fake audio bytes for the http round trip');
    const ingestUrl = `${baseUrl}/projects/${project.id}/sessions/${session.id}/assets?originalFilename=take.wav&mimeType=audio%2Fwav`;
    const ingestRes = await fetch(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileBytes,
    });
    expect(ingestRes.status).toBe(201);
    const asset = (await ingestRes.json()) as { id: string; sha256: string; sizeBytes: number; assetType: string };
    expect(asset.sizeBytes).toBe(fileBytes.length);
    expect(asset.assetType).toBe('audio');

    const claimRes = await fetch(`${baseUrl}/projects/${project.id}/contributor-claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, profileId: 'profile-2', role: 'musician', subrole: 'lead_guitar' }),
    });
    expect(claimRes.status).toBe(201);

    const snapshotRes = await fetch(`${baseUrl}/projects/${project.id}/snapshot`);
    expect(snapshotRes.status).toBe(200);
    const snapshot = (await snapshotRes.json()) as {
      sessions: unknown[];
      assets: { id: string }[];
      contributorClaims: unknown[];
      events: unknown[];
    };
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.assets.map((a) => a.id)).toEqual([asset.id]);
    expect(snapshot.contributorClaims).toHaveLength(1);
    expect(snapshot.events.length).toBeGreaterThanOrEqual(3); // session_started, asset_imported, contributor_added
  });

  it('returns 404 for an unknown project snapshot', async () => {
    const res = await fetch(`${baseUrl}/projects/does-not-exist/snapshot`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 400 (not 500, not a stack trace) for a missing required field', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Missing owner' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ownerProfileId/);
    expect(body.error).not.toMatch(/at\s+\S+\.(ts|js):\d+/); // no stack-trace-shaped content
  });

  it('returns 404 for an unrouted path', async () => {
    const res = await fetch(`${baseUrl}/not-a-real-route`);
    expect(res.status).toBe(404);
  });

  it('rejects ingestion for a session that does not belong to the given project (400/404, no server crash)', async () => {
    const projectA = await createProject('Project A');
    const projectB = await createProject('Project B');
    const sessionA = await startSession(projectA.id);

    const res = await fetch(`${baseUrl}/projects/${projectB.id}/sessions/${sessionA.id}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new TextEncoder().encode('bytes'),
    });
    expect(res.status).toBe(404);
  });

  it('never leaks private key material in any HTTP response across a full create -> session -> ingest -> claim -> snapshot flow', async () => {
    const project = await createProject();
    const session = await startSession(project.id);
    await fetch(`${baseUrl}/projects/${project.id}/sessions/${session.id}/assets?originalFilename=take.wav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new TextEncoder().encode('bytes'),
    });
    await fetch(`${baseUrl}/projects/${project.id}/contributor-claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, profileId: 'profile-2', role: 'musician' }),
    });
    const snapshotRes = await fetch(`${baseUrl}/projects/${project.id}/snapshot`);
    const snapshotText = await snapshotRes.text();

    expect(snapshotText).not.toMatch(/privateKey/i);
    expect(snapshotText).not.toMatch(/pkcs8/i);
    expect(snapshotText).not.toMatch(/publicKeySpkiDer/i);
    expect(snapshotText).not.toMatch(/deviceKeyFingerprint/i);
  });
});
