import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioService } from './studioService.js';
import { StudioServiceError } from './errors.js';

const tempDirs: string[] = [];

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flow-studio-service-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('StudioService — projects', () => {
  it('creates and lists a real project', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });

    expect(project.title).toBe('Cold Nights');
    expect(project.status).toBe('draft');
    expect(service.listProjects().map((p) => p.id)).toEqual([project.id]);
    service.close();
  });

  it('rejects an empty title before it ever reaches the domain factory', () => {
    const service = new StudioService(makeDataDir());
    expect(() => service.createProject({ ownerProfileId: 'profile-1', title: '  ', projectType: 'song' })).toThrow(
      StudioServiceError,
    );
    service.close();
  });

  it('a project created in one service instance is visible after closing and reopening at the same data dir', () => {
    const dataDir = makeDataDir();
    const first = new StudioService(dataDir);
    const project = first.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    first.close();

    const second = new StudioService(dataDir);
    expect(second.listProjects().map((p) => p.id)).toEqual([project.id]);
    expect(second.getProjectSnapshot(project.id).project).toEqual(project);
    second.close();
  });

  it('getProjectSnapshot throws a 404-shaped error for an unknown project', () => {
    const service = new StudioService(makeDataDir());
    expect(() => service.getProjectSnapshot('does-not-exist')).toThrow(StudioServiceError);
    try {
      service.getProjectSnapshot('does-not-exist');
    } catch (error) {
      expect((error as StudioServiceError).statusCode).toBe(404);
    }
    service.close();
  });
});

describe('StudioService — sessions', () => {
  it('starts a real session for an existing project, bound to the service\'s own local device', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });

    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });

    expect(session.projectId).toBe(project.id);
    expect(session.actorProfileId).toBe('profile-1');
    expect(session.status).toBe('active');

    const snapshot = service.getProjectSnapshot(project.id);
    expect(snapshot.sessions.map((s) => s.id)).toEqual([session.id]);
    // A real session_started provenance event was recorded through the
    // existing engine — not a parallel Studio-specific history record.
    expect(snapshot.events.some((e) => e.eventType === 'session_started' && e.sessionId === session.id)).toBe(true);
    service.close();
  });

  it('refuses to start a session for a project that does not exist', () => {
    const service = new StudioService(makeDataDir());
    expect(() => service.startSession('does-not-exist', { actorProfileId: 'profile-1' })).toThrow(StudioServiceError);
    service.close();
  });
});

describe('StudioService — asset ingestion', () => {
  function setUpProjectAndSession(service: StudioService) {
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });
    return { project, session };
  }

  it('computes the real SHA-256 and byte size of the uploaded bytes', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const bytes = Buffer.from('this is not really an audio file, just test bytes');
    const expectedHash = createHash('sha256').update(bytes).digest('hex');

    const asset = service.ingestAsset(project.id, session.id, bytes, { originalFilename: 'take.wav' });

    expect(asset.sha256).toBe(expectedHash);
    expect(asset.sizeBytes).toBe(bytes.length);
    expect(asset.assetType).toBe('audio');
    expect(asset.sourceType).toBe('imported_unknown');
    expect(asset.introducedBySessionId).toBe(session.id);
    service.close();
  });

  it('persists the ingested asset and it appears in the project snapshot', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const asset = service.ingestAsset(project.id, session.id, Buffer.from('bytes'), { originalFilename: 'sample.png' });

    const snapshot = service.getProjectSnapshot(project.id);
    expect(snapshot.assets.map((a) => a.id)).toEqual([asset.id]);
    expect(snapshot.assets[0]?.assetType).toBe('image');
    expect(snapshot.events.some((e) => e.eventType === 'asset_imported' && e.assetId === asset.id)).toBe(true);
    service.close();
  });

  it('rejects an empty file upload', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    expect(() => service.ingestAsset(project.id, session.id, Buffer.alloc(0), {})).toThrow(StudioServiceError);
    service.close();
  });

  it('rejects ingestion against a session that does not belong to the given project', () => {
    const service = new StudioService(makeDataDir());
    const projectA = service.createProject({ ownerProfileId: 'profile-1', title: 'Project A', projectType: 'song' });
    const projectB = service.createProject({ ownerProfileId: 'profile-1', title: 'Project B', projectType: 'song' });
    const sessionA = service.startSession(projectA.id, { actorProfileId: 'profile-1' });

    expect(() => service.ingestAsset(projectB.id, sessionA.id, Buffer.from('x'), {})).toThrow(StudioServiceError);
    service.close();
  });

  it('rejects an unrecognized sourceType override rather than silently accepting an arbitrary string', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    expect(() =>
      service.ingestAsset(project.id, session.id, Buffer.from('x'), { sourceType: 'not-a-real-source-type' }),
    ).toThrow(StudioServiceError);
    service.close();
  });

  it('a failed ingest (bad sourceType) leaves no orphaned asset or event behind', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const before = service.getProjectSnapshot(project.id);

    expect(() =>
      service.ingestAsset(project.id, session.id, Buffer.from('x'), { sourceType: 'bogus' }),
    ).toThrow();

    const after = service.getProjectSnapshot(project.id);
    expect(after.assets).toHaveLength(before.assets.length);
    expect(after.events).toHaveLength(before.events.length);
    service.close();
  });
});

describe('StudioService — contributor claims', () => {
  it('persists an explicit contributor claim, tied to a real session', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });

    const claim = service.addContributorClaim(project.id, {
      sessionId: session.id,
      profileId: 'profile-2',
      role: 'musician',
      subrole: 'lead_guitar',
    });

    expect(claim.role).toBe('musician');
    const snapshot = service.getProjectSnapshot(project.id);
    expect(snapshot.contributorClaims.map((c) => c.id)).toEqual([claim.id]);
    expect(snapshot.events.some((e) => e.eventType === 'contributor_added')).toBe(true);
    service.close();
  });

  it('rejects an unrecognized role', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });

    expect(() =>
      service.addContributorClaim(project.id, { sessionId: session.id, profileId: 'profile-2', role: 'not-a-role' }),
    ).toThrow();
    service.close();
  });
});

describe('StudioService — private key boundary', () => {
  it('never returns private key bytes (raw or base64) anywhere in a snapshot, project, session, asset, or claim', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });
    service.ingestAsset(project.id, session.id, Buffer.from('some bytes'), { originalFilename: 'take.wav' });
    service.addContributorClaim(project.id, { sessionId: session.id, profileId: 'profile-2', role: 'musician' });

    const snapshot = service.getProjectSnapshot(project.id);
    const serialized = JSON.stringify({ project, session, snapshot, projects: service.listProjects() });

    // The service's own device identity is never part of any public
    // return value — these fields simply must not exist anywhere in what
    // callers (ultimately the HTTP layer, ultimately the browser) can see.
    expect(serialized).not.toMatch(/privateKey/i);
    expect(serialized).not.toMatch(/pkcs8/i);
    expect(serialized).not.toMatch(/publicKeySpkiDer/i);
    expect(serialized).not.toMatch(/deviceKeyFingerprint/i);
    service.close();
  });
});
