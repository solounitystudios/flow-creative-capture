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

  it('rejects an unrecognized role even when a subrole is also supplied, as a clean StudioServiceError rather than a raw TypeError', () => {
    // Regression guard for the documented gap: createContributorReference
    // (src/domain/contributorReference.ts) only validates subrole-against-role
    // when a subrole is present, and its isValidSubrole lookup
    // (SUBROLES_BY_ROLE[role]) throws a raw TypeError for an unrecognized
    // role rather than a clean domain error. validateContributionRole in
    // studioService.ts must reject the bad role BEFORE that lookup ever
    // runs, for every input shape — including this one.
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });

    expect(() =>
      service.addContributorClaim(project.id, {
        sessionId: session.id,
        profileId: 'profile-2',
        role: 'not-a-role',
        subrole: 'also-not-real',
      }),
    ).toThrow(StudioServiceError);

    const snapshot = service.getProjectSnapshot(project.id);
    expect(snapshot.contributorClaims).toHaveLength(0);
    service.close();
  });
});

describe('StudioService — asset ingestion: duplicate filenames', () => {
  it('two assets with the identical originalFilename but different byte content persist as two distinct, non-overwriting records', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });

    const first = service.ingestAsset(project.id, session.id, Buffer.from('take one'), { originalFilename: 'take.wav' });
    const second = service.ingestAsset(project.id, session.id, Buffer.from('take two, completely different content'), {
      originalFilename: 'take.wav',
    });

    expect(first.id).not.toBe(second.id);
    expect(first.sha256).not.toBe(second.sha256);

    const snapshot = service.getProjectSnapshot(project.id);
    expect(snapshot.assets).toHaveLength(2);
    expect(snapshot.assets.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
    // Neither record's own bytes/hash were overwritten by the other's ingest.
    expect(snapshot.assets.find((a) => a.id === first.id)?.sha256).toBe(first.sha256);
    expect(snapshot.assets.find((a) => a.id === second.id)?.sha256).toBe(second.sha256);
    service.close();
  });
});

describe('StudioService — device identity stability across restart', () => {
  it('the local device identity (fingerprint, deviceId) is identical across a close/reopen at the same data dir — not regenerated', () => {
    const dataDir = makeDataDir();
    const first = new StudioService(dataDir);
    const projectA = first.createProject({ ownerProfileId: 'profile-1', title: 'A', projectType: 'song' });
    const sessionA = first.startSession(projectA.id, { actorProfileId: 'profile-1' });
    first.close();

    const second = new StudioService(dataDir);
    const projectB = second.createProject({ ownerProfileId: 'profile-1', title: 'B', projectType: 'song' });
    const sessionB = second.startSession(projectB.id, { actorProfileId: 'profile-1' });

    // Both sessions were opened by the "same" local device, across a real
    // process boundary (a fresh StudioService instance = a fresh
    // FileDeviceKeyStore load, not an in-memory identity reused by
    // accident) — deviceId is the visible proxy for that here, since
    // fingerprint/public key are deliberately never returned by any
    // public method (see the private-key-boundary test above).
    expect(sessionB.deviceId).toBe(sessionA.deviceId);
    second.close();
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

  it('never returns private key bytes anywhere in a checkpoint or checkpoint verification result', () => {
    const service = new StudioService(makeDataDir());
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });
    service.ingestAsset(project.id, session.id, Buffer.from('some bytes'), { originalFilename: 'take.wav' });
    const checkpoint = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    const evaluation = service.verifyCheckpoint(project.id, checkpoint.id);

    const serialized = JSON.stringify({ checkpoint, evaluation, list: service.listCheckpoints(project.id) });
    expect(serialized).not.toMatch(/privateKey/i);
    expect(serialized).not.toMatch(/pkcs8/i);
    expect(serialized).not.toMatch(/publicKeySpkiDer/i);
    expect(serialized).not.toMatch(/deviceKeyFingerprint/i);
    service.close();
  });
});

describe('StudioService — checkpoints (Capture Studio V2)', () => {
  function setUpProjectAndSession(service: StudioService) {
    const project = service.createProject({ ownerProfileId: 'profile-1', title: 'Cold Nights', projectType: 'song' });
    const session = service.startSession(project.id, { actorProfileId: 'profile-1' });
    return { project, session };
  }

  it('creates a real, live signed checkpoint from actual project state', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    service.ingestAsset(project.id, session.id, Buffer.from('take one'), { originalFilename: 'vocals.wav' });

    const checkpoint = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });

    expect(checkpoint.projectId).toBe(project.id);
    expect(checkpoint.sessionId).toBe(session.id);
    expect(checkpoint.sequence).toBe(0);
    expect(checkpoint.previousCheckpointHash).toBeUndefined();
    expect(checkpoint.triggerType).toBe('manual');
    expect(checkpoint.signature).toBeDefined();
    expect(Buffer.from(checkpoint.signature as string, 'base64')).toHaveLength(64);
    expect(service.listCheckpoints(project.id).map((c) => c.id)).toEqual([checkpoint.id]);
    service.close();
  });

  it('defaults triggerType to manual, and accepts an explicit recognized triggerType', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const c0 = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    expect(c0.triggerType).toBe('manual');
    const c1 = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1', triggerType: 'major_import' });
    expect(c1.triggerType).toBe('major_import');
    service.close();
  });

  it('a rejected checkpoint request (bad triggerType) leaves no orphaned checkpoint behind', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const before = service.listCheckpoints(project.id);

    expect(() =>
      service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1', triggerType: 'not-a-real-trigger' }),
    ).toThrow(StudioServiceError);

    const after = service.listCheckpoints(project.id);
    expect(after).toHaveLength(before.length);
    service.close();
  });

  it('a second checkpoint links to the first via previousCheckpointHash, with sequence advancing predictably', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const c0 = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    service.ingestAsset(project.id, session.id, Buffer.from('stems'), { originalFilename: 'stems.zip' });
    const c1 = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });

    expect(c1.sequence).toBe(c0.sequence + 1);
    expect(c1.previousCheckpointHash).toBe(c0.checkpointHash);

    const c2 = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    expect(c2.sequence).toBe(c1.sequence + 1);
    expect(c2.previousCheckpointHash).toBe(c1.checkpointHash);
    service.close();
  });

  it('a checkpoint never links to a checkpoint from another project', () => {
    const service = new StudioService(makeDataDir());
    const projectA = service.createProject({ ownerProfileId: 'profile-1', title: 'Project A', projectType: 'song' });
    const sessionA = service.startSession(projectA.id, { actorProfileId: 'profile-1' });
    const projectB = service.createProject({ ownerProfileId: 'profile-1', title: 'Project B', projectType: 'song' });
    const sessionB = service.startSession(projectB.id, { actorProfileId: 'profile-1' });

    service.createCheckpoint(projectA.id, sessionA.id, { actorProfileId: 'profile-1' });
    const checkpointB = service.createCheckpoint(projectB.id, sessionB.id, { actorProfileId: 'profile-1' });

    // Project B's first checkpoint chains from ITS OWN (empty) history,
    // never from project A's, even though project A already has one.
    expect(checkpointB.sequence).toBe(0);
    expect(checkpointB.previousCheckpointHash).toBeUndefined();
    service.close();
  });

  it('the checkpoint manifest folds in only the assets and events accumulated so far, and each checkpoint verifies as locally sound', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    service.ingestAsset(project.id, session.id, Buffer.from('vocals'), { originalFilename: 'vocals.wav' });

    const checkpoint = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    const evaluation = service.verifyCheckpoint(project.id, checkpoint.id);

    expect(evaluation.signature.status).toBe('valid');
    expect(evaluation.structure.valid).toBe(true);
    expect(evaluation.deviceTrust.currentlyTrusted).toBe(true);
    expect(evaluation.claimStatus).toBe('locally_sound_unverified_claim');
    service.close();
  });

  it('rejects a checkpoint request against a session that does not belong to the given project', () => {
    const service = new StudioService(makeDataDir());
    const projectA = service.createProject({ ownerProfileId: 'profile-1', title: 'A', projectType: 'song' });
    const projectB = service.createProject({ ownerProfileId: 'profile-1', title: 'B', projectType: 'song' });
    const sessionA = service.startSession(projectA.id, { actorProfileId: 'profile-1' });
    expect(() => service.createCheckpoint(projectB.id, sessionA.id, { actorProfileId: 'profile-1' })).toThrow(
      StudioServiceError,
    );
    service.close();
  });

  it('getCheckpoint 404s for an unknown checkpoint id, and for a checkpoint that belongs to a different project', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    const checkpoint = service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    const otherProject = service.createProject({ ownerProfileId: 'profile-1', title: 'Other', projectType: 'song' });

    expect(() => service.getCheckpoint(project.id, 'does-not-exist')).toThrow(StudioServiceError);
    expect(() => service.getCheckpoint(otherProject.id, checkpoint.id)).toThrow(StudioServiceError);
    service.close();
  });

  it('a checkpoint survives service restart with identical id, hash, signature, chain, and device identity', () => {
    const dataDir = makeDataDir();
    const first = new StudioService(dataDir);
    const { project, session } = setUpProjectAndSession(first);
    first.ingestAsset(project.id, session.id, Buffer.from('vocals'), { originalFilename: 'vocals.wav' });
    const checkpoint = first.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    first.close();

    const second = new StudioService(dataDir);
    const reloaded = second.getCheckpoint(project.id, checkpoint.id);
    expect(reloaded).toEqual(checkpoint);
    const evaluation = second.verifyCheckpoint(project.id, checkpoint.id);
    expect(evaluation.claimStatus).toBe('locally_sound_unverified_claim');

    // A second checkpoint created after restart still links correctly.
    const c2 = second.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });
    expect(c2.previousCheckpointHash).toBe(checkpoint.checkpointHash);
    expect(c2.sequence).toBe(checkpoint.sequence + 1);
    second.close();
  });

  it('ending a session with new evidence since the previous checkpoint automatically cuts a session_end checkpoint', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    service.ingestAsset(project.id, session.id, Buffer.from('vocals'), { originalFilename: 'vocals.wav' });

    const ended = service.endSession(project.id, session.id);
    expect(ended.status).toBe('ended');

    const checkpoints = service.listCheckpoints(project.id);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.triggerType).toBe('session_end');
    service.close();
  });

  it('ending a session with NO new evidence since the previous checkpoint does not create a duplicate checkpoint', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    // A manual checkpoint immediately closes out all current evidence.
    service.createCheckpoint(project.id, session.id, { actorProfileId: 'profile-1' });

    const ended = service.endSession(project.id, session.id);
    expect(ended.status).toBe('ended');

    // Only the manual checkpoint exists — session end found nothing new
    // to close out, so the policy skipped an automatic checkpoint.
    expect(service.listCheckpoints(project.id)).toHaveLength(1);
    service.close();
  });

  it('rejects ending a session that does not belong to the given project', () => {
    const service = new StudioService(makeDataDir());
    const projectA = service.createProject({ ownerProfileId: 'profile-1', title: 'A', projectType: 'song' });
    const projectB = service.createProject({ ownerProfileId: 'profile-1', title: 'B', projectType: 'song' });
    const sessionA = service.startSession(projectA.id, { actorProfileId: 'profile-1' });
    expect(() => service.endSession(projectB.id, sessionA.id)).toThrow(StudioServiceError);
    service.close();
  });

  it('rejects ending an already-ended session', () => {
    const service = new StudioService(makeDataDir());
    const { project, session } = setUpProjectAndSession(service);
    service.endSession(project.id, session.id);
    expect(() => service.endSession(project.id, session.id)).toThrow();
    service.close();
  });
});
