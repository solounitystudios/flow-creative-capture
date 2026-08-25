import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asAssetId,
  asBatchId,
  asCheckpointId,
  asContributionClaimId,
  asDeviceId,
  asEventId,
  asProfileId,
  asProjectId,
  asSessionId,
  asWorkReferenceId,
} from '../../src/domain/ids.js';
import { createStudioDevice, isDeviceActive } from '../../src/domain/studioDevice.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createProvenanceCheckpoint } from '../../src/domain/provenanceCheckpoint.js';
import { createProvenanceBatch } from '../../src/domain/provenanceBatch.js';
import { createContributorReference } from '../../src/domain/contributorReference.js';
import { createProjectAsset } from '../../src/domain/projectAsset.js';
import { createCheckpointFromManifest } from '../../src/provenance/checkpoint.js';
import { closeEvidenceDatabase, openEvidenceDatabase } from '../../src/store/database.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { StoreConflictError } from '../../src/store/errors.js';

const tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flow-evidence-store-test-'));
  tempDirs.push(dir);
  return join(dir, 'evidence.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const FAKE_PUBLIC_KEY = Buffer.from('not-a-real-spki-der-just-a-persistence-layer-fixture');

function makeDevice(id = 'device-1') {
  return createStudioDevice({
    id: asDeviceId(id),
    profileId: asProfileId('profile-1'),
    devicePublicId: `pub-${id}`,
    platform: 'macos',
    appVersion: '1.0.0',
    deviceKeyFingerprint: 'f'.repeat(64),
  });
}

function makeSession(id = 'session-1', deviceId = 'device-1') {
  return createStudioSession({
    id: asSessionId(id),
    projectId: asProjectId('project-1'),
    actorProfileId: asProfileId('profile-1'),
    deviceId: asDeviceId(deviceId),
    daw: 'fl_studio',
    startedAt: '2026-01-01T00:00:00.000Z',
  });
}

function makeEvent(eventId = 'event-1', sessionId = 'session-1', occurredAt = '2026-01-01T00:01:00.000Z') {
  return createProvenanceEvent({
    eventId: asEventId(eventId),
    projectId: asProjectId('project-1'),
    sessionId: asSessionId(sessionId),
    actorProfileId: asProfileId('profile-1'),
    deviceId: asDeviceId('device-1'),
    source: 'studio_simulator',
    eventType: 'project_saved',
    occurredAt,
  });
}

function makeCheckpoint(id = 'checkpoint-1', sequence = 0, projectId = 'project-1') {
  return createProvenanceCheckpoint({
    id: asCheckpointId(id),
    projectId: asProjectId(projectId),
    sessionId: asSessionId('session-1'),
    actorProfileId: asProfileId('profile-1'),
    sequence,
    manifestHash: 'a'.repeat(64),
    checkpointHash: 'b'.repeat(64),
    triggerType: 'manual',
    createdAt: '2026-01-01T00:02:00.000Z',
  });
}

function makeContributorClaim(
  id = 'claim-1',
  projectId = 'project-1',
  overrides: Partial<Parameters<typeof createContributorReference>[0]> = {},
) {
  return createContributorReference({
    id: asContributionClaimId(id),
    projectId: asProjectId(projectId),
    profileId: asProfileId('profile-1'),
    role: 'producer',
    subrole: 'producer',
    claimedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function makeProjectAsset(
  id = 'asset-1',
  projectId = 'project-1',
  overrides: Partial<Parameters<typeof createProjectAsset>[0]> = {},
) {
  return createProjectAsset({
    id: asAssetId(id),
    projectId: asProjectId(projectId),
    introducedBySessionId: asSessionId('session-1'),
    assetType: 'audio',
    sourceType: 'human_recorded',
    sha256: 'a'.repeat(64),
    firstSeenAt: '2026-01-01T00:04:00.000Z',
    ...overrides,
  });
}

function makeBatch(id = 'batch-1', sessionId = 'session-1') {
  return createProvenanceBatch({
    id: asBatchId(id),
    profileId: asProfileId('profile-1'),
    deviceId: asDeviceId('device-1'),
    sessionId: asSessionId(sessionId),
    eventCount: 1,
    firstEventAt: '2026-01-01T00:01:00.000Z',
    lastEventAt: '2026-01-01T00:01:00.000Z',
    manifestHash: 'c'.repeat(64),
    createdAt: '2026-01-01T00:03:00.000Z',
  });
}

describe('LocalEvidenceStore — devices', () => {
  it('round-trips a device, including its public key', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const device = makeDevice();
    store.insertDevice(device, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');

    const loaded = store.getDevice(device.id);
    expect(loaded).toEqual(device);
    expect(store.getDevicePublicKey(device.id)?.equals(FAKE_PUBLIC_KEY)).toBe(true);
    store.close();
  });

  it('returns undefined for a device that was never inserted', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    expect(store.getDevice(asDeviceId('nope'))).toBeUndefined();
    store.close();
  });

  it('revoking a device is reflected on read, and isDeviceActive turns false', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const device = makeDevice();
    store.insertDevice(device, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    const loaded = store.getDevice(device.id);
    expect(loaded?.revokedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(isDeviceActive(loaded!)).toBe(false);
    store.close();
  });

  it('re-revoking with the identical revokedAt is an idempotent no-op', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const device = makeDevice();
    store.insertDevice(device, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    const first = store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    const second = store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    expect(first).toEqual({ inserted: true });
    expect(second).toEqual({ inserted: false, reason: 'duplicate' });
    store.close();
  });

  it('re-revoking with a DIFFERENT revokedAt throws StoreConflictError and does not change the stored revocation', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const device = makeDevice();
    store.insertDevice(device, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    expect(() => store.revokeDevice(device.id, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')).toThrow(
      StoreConflictError,
    );
    expect(store.getDevice(device.id)?.revokedAt).toBe('2026-02-01T00:00:00.000Z');
    store.close();
  });

  it('inserting a device with the same id but different content throws StoreConflictError, never overwriting', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const device = makeDevice();
    store.insertDevice(device, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');

    const conflicting = createStudioDevice({ ...device, appVersion: '2.0.0' });
    expect(() => store.insertDevice(conflicting, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z')).toThrow(
      StoreConflictError,
    );
    expect(store.getDevice(device.id)?.appVersion).toBe('1.0.0');
    store.close();
  });
});

describe('LocalEvidenceStore — sessions', () => {
  it('round-trips a session', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    const session = makeSession();
    store.insertSession(session, '2026-01-01T00:00:00.000Z');
    expect(store.getSession(session.id)).toEqual(session);
    store.close();
  });

  it('ending a session is reflected on read', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    const session = makeSession();
    store.insertSession(session, '2026-01-01T00:00:00.000Z');
    store.endSession(session.id, '2026-01-01T01:00:00.000Z', 'ended', '2026-01-01T01:00:00.000Z');

    const loaded = store.getSession(session.id);
    expect(loaded?.endedAt).toBe('2026-01-01T01:00:00.000Z');
    expect(loaded?.status).toBe('ended');
    store.close();
  });
});

describe('LocalEvidenceStore — events', () => {
  it('round-trips an event, including optional fields and payload content', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');

    const event = createProvenanceEvent({
      eventId: asEventId('event-full'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId: asDeviceId('device-1'),
      source: 'studio_simulator',
      eventType: 'asset_created',
      assetId: asAssetId('asset-1'),
      trackReference: 'track-1',
      occurredAt: '2026-01-01T00:01:00.000Z',
      receivedAt: '2026-01-01T00:02:00.000Z',
      payload: { nested: { array: [1, 2, 3], flag: true }, note: 'hello' },
    });
    store.insertEvent(event, '2026-01-01T00:05:00.000Z');
    expect(store.getEvent(event.eventId)).toEqual(event);
    store.close();
  });

  it('duplicate insertion of the exact same event is an idempotent no-op', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const event = makeEvent();
    const first = store.insertEvent(event, '2026-01-01T00:05:00.000Z');
    const second = store.insertEvent(event, '2026-01-01T00:05:00.000Z');
    expect(first).toEqual({ inserted: true });
    expect(second).toEqual({ inserted: false, reason: 'duplicate' });
    store.close();
  });

  it('a conflicting event (same eventId, different content) throws and never overwrites the original', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const original = makeEvent('event-x', 'session-1', '2026-01-01T00:01:00.000Z');
    store.insertEvent(original, '2026-01-01T00:05:00.000Z');

    const conflicting = makeEvent('event-x', 'session-1', '2026-01-01T00:09:00.000Z');
    expect(() => store.insertEvent(conflicting, '2026-01-01T00:05:00.000Z')).toThrow(StoreConflictError);
    expect(store.getEvent(asEventId('event-x'))?.occurredAt).toBe('2026-01-01T00:01:00.000Z');
    store.close();
  });

  it('lists a session\'s events ordered by occurredAt', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const e2 = makeEvent('event-2', 'session-1', '2026-01-01T00:02:00.000Z');
    const e1 = makeEvent('event-1', 'session-1', '2026-01-01T00:01:00.000Z');
    // Inserted out of chronological order on purpose.
    store.insertEvent(e2, '2026-01-01T00:05:00.000Z');
    store.insertEvent(e1, '2026-01-01T00:05:01.000Z');

    const listed = store.listEventsForSession(asSessionId('session-1'));
    expect(listed.map((e) => e.eventId)).toEqual(['event-1', 'event-2']);
    store.close();
  });

  it('isolates events between sessions — session A\'s events never appear when listing session B', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession('session-a'), '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession('session-b'), '2026-01-01T00:00:00.000Z');
    store.insertEvent(makeEvent('event-a', 'session-a'), '2026-01-01T00:05:00.000Z');
    store.insertEvent(makeEvent('event-b', 'session-b'), '2026-01-01T00:05:00.000Z');

    expect(store.listEventsForSession(asSessionId('session-a')).map((e) => e.eventId)).toEqual(['event-a']);
    expect(store.listEventsForSession(asSessionId('session-b')).map((e) => e.eventId)).toEqual(['event-b']);
    store.close();
  });
});

describe('LocalEvidenceStore — checkpoints', () => {
  it('round-trips a checkpoint', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const checkpoint = makeCheckpoint();
    store.insertCheckpoint(checkpoint, '2026-01-01T00:05:00.000Z');
    expect(store.getCheckpoint(checkpoint.id)).toEqual(checkpoint);
    store.close();
  });

  it('lists a project\'s checkpoints ordered by sequence, and a genuinely valid chain reads back as valid', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');

    const c0 = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-0'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      sequence: 0,
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:05:00.000Z',
    });
    store.insertCheckpoint(c0, '2026-01-01T00:05:00.000Z');

    const c1 = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-1'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      sequence: 1,
      previousCheckpointHash: c0.checkpointHash,
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [asEventId('event-1')] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:06:00.000Z',
    });
    store.insertCheckpoint(c1, '2026-01-01T00:06:00.000Z');

    const listed = store.listCheckpointsForProject(asProjectId('project-1'));
    expect(listed.map((c) => c.id)).toEqual(['checkpoint-0', 'checkpoint-1']);
    expect(store.verifyCheckpointChainForProject(asProjectId('project-1')).valid).toBe(true);
    store.close();
  });

  it('isolates checkpoints between projects', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    store.insertCheckpoint(makeCheckpoint('checkpoint-a', 0, 'project-a'), '2026-01-01T00:05:00.000Z');
    store.insertCheckpoint(makeCheckpoint('checkpoint-b', 0, 'project-b'), '2026-01-01T00:05:00.000Z');

    expect(store.listCheckpointsForProject(asProjectId('project-a')).map((c) => c.id)).toEqual(['checkpoint-a']);
    expect(store.listCheckpointsForProject(asProjectId('project-b')).map((c) => c.id)).toEqual(['checkpoint-b']);
    store.close();
  });
});

describe('LocalEvidenceStore — batches', () => {
  it('round-trips a batch, with validationStatus composed back in', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const batch = makeBatch();
    store.insertBatch(batch, '2026-01-01T00:05:00.000Z');
    expect(store.getBatch(batch.id)).toEqual(batch);
    store.close();
  });

  it('setBatchValidationStatus mutates freely (no conflict) and is reflected on read', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const batch = makeBatch();
    store.insertBatch(batch, '2026-01-01T00:05:00.000Z');

    store.setBatchValidationStatus(batch.id, 'valid', '2026-01-01T00:10:00.000Z', '2026-01-01T00:10:00.000Z');
    expect(store.getBatch(batch.id)?.validationStatus).toBe('valid');

    store.setBatchValidationStatus(batch.id, 'invalid', '2026-01-01T00:20:00.000Z', '2026-01-01T00:20:00.000Z');
    expect(store.getBatch(batch.id)?.validationStatus).toBe('invalid');
    store.close();
  });

  it('a conflicting batch (same id, different signed content) throws and never overwrites the original', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    const batch = makeBatch();
    store.insertBatch(batch, '2026-01-01T00:05:00.000Z');

    const conflicting = createProvenanceBatch({ ...batch, eventCount: 99 });
    expect(() => store.insertBatch(conflicting, '2026-01-01T00:05:00.000Z')).toThrow(StoreConflictError);
    expect(store.getBatch(batch.id)?.eventCount).toBe(1);
    store.close();
  });

  it('lists batches for a device and for a session', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    store.insertBatch(makeBatch('batch-1'), '2026-01-01T00:05:00.000Z');
    store.insertBatch(makeBatch('batch-2'), '2026-01-01T00:06:00.000Z');

    expect(store.listBatchesForDevice(asDeviceId('device-1')).map((b) => b.id)).toEqual(['batch-1', 'batch-2']);
    expect(store.listBatchesForSession(asSessionId('session-1')).map((b) => b.id)).toEqual(['batch-1', 'batch-2']);
    store.close();
  });
});

describe('LocalEvidenceStore — contributor references', () => {
  it('round-trips a contributor reference, including optional subrole and description', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const claim = makeContributorClaim('claim-nightwire-producer', 'project-cold-nights', {
      role: 'producer',
      subrole: 'producer',
      description: 'Tracked and produced the full session',
      claimedAt: '2026-01-05T18:10:00.000Z',
    });
    store.insertContributorReference(claim, '2026-01-05T18:15:00.000Z');

    const loaded = store.getContributorReference(claim.id);
    expect(loaded).toEqual(claim);
    store.close();
  });

  it('returns undefined for a contributor reference that was never inserted', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    expect(store.getContributorReference(asContributionClaimId('nope'))).toBeUndefined();
    store.close();
  });

  it('persists a claim with no subrole/description and reconstructs it without those fields (never as null on the domain object)', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    const claim = createContributorReference({
      id: asContributionClaimId('claim-bare'),
      projectId: asProjectId('project-1'),
      profileId: asProfileId('profile-1'),
      role: 'composer',
      claimedAt: '2026-01-01T00:00:00.000Z',
    });
    store.insertContributorReference(claim, '2026-01-01T00:05:00.000Z');

    const loaded = store.getContributorReference(claim.id);
    expect(loaded).toEqual(claim);
    expect(loaded?.subrole).toBeUndefined();
    expect(loaded?.description).toBeUndefined();
    expect('subrole' in (loaded ?? {})).toBe(false);
    expect('description' in (loaded ?? {})).toBe(false);
    store.close();
  });

  it('lists a project\'s contributor claims ordered by claimedAt (rowid as tiebreaker), never another project\'s claims', () => {
    const store = new LocalEvidenceStore(makeDbPath());

    // Cold Nights-style realistic claims, inserted deliberately out of
    // chronological order, across two different projects.
    const producerClaim = makeContributorClaim('claim-nightwire-producer', 'project-cold-nights', {
      profileId: asProfileId('profile-nightwire'),
      role: 'producer',
      subrole: 'producer',
      claimedAt: '2026-01-05T18:10:00.000Z',
    });
    const songwriterClaim = makeContributorClaim('claim-nightwire-songwriter', 'project-cold-nights', {
      profileId: asProfileId('profile-nightwire'),
      role: 'songwriter',
      subrole: 'melody',
      claimedAt: '2026-01-05T18:05:00.000Z',
    });
    const musicianClaim = makeContributorClaim('claim-marcus-musician', 'project-cold-nights', {
      profileId: asProfileId('profile-marcus'),
      role: 'musician',
      subrole: 'lead_guitar',
      claimedAt: '2026-01-06T09:00:00.000Z',
    });
    const otherProjectClaim = makeContributorClaim('claim-other-project', 'project-other-song', {
      profileId: asProfileId('profile-nightwire'),
      role: 'producer',
      subrole: 'producer',
      claimedAt: '2026-01-05T18:00:00.000Z',
    });

    // Inserted out of chronological order on purpose, and interleaved
    // with a different project's claim.
    store.insertContributorReference(producerClaim, '2026-01-05T18:15:00.000Z');
    store.insertContributorReference(otherProjectClaim, '2026-01-05T18:16:00.000Z');
    store.insertContributorReference(musicianClaim, '2026-01-06T09:05:00.000Z');
    store.insertContributorReference(songwriterClaim, '2026-01-05T18:17:00.000Z');

    const coldNightsClaims = store.listContributorReferencesForProject(asProjectId('project-cold-nights'));
    expect(coldNightsClaims.map((c) => c.id)).toEqual([
      'claim-nightwire-songwriter',
      'claim-nightwire-producer',
      'claim-marcus-musician',
    ]);
    expect(coldNightsClaims).toEqual([songwriterClaim, producerClaim, musicianClaim]);

    const otherProjectClaims = store.listContributorReferencesForProject(asProjectId('project-other-song'));
    expect(otherProjectClaims.map((c) => c.id)).toEqual(['claim-other-project']);

    // Never leaks across projects in either direction.
    expect(coldNightsClaims.some((c) => c.id === otherProjectClaim.id)).toBe(false);
    expect(otherProjectClaims.some((c) => c.projectId === producerClaim.projectId)).toBe(false);

    store.close();
  });

  it('returns an empty list for a project with no contributor claims', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    expect(store.listContributorReferencesForProject(asProjectId('no-claims-here'))).toEqual([]);
    store.close();
  });
});

describe('LocalEvidenceStore — project assets', () => {
  function seedSession(store: LocalEvidenceStore, sessionId = 'session-1') {
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(sessionId), '2026-01-01T00:00:00.000Z');
  }

  it('round-trips an asset with full metadata (workReference, createdByProfileId, originalFilename, sizeBytes, rightsStatus)', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    seedSession(store);
    const asset = makeProjectAsset('asset-full', 'project-1', {
      workReference: asWorkReferenceId('work-1'),
      createdByProfileId: asProfileId('profile-1'),
      originalFilename: 'guitar_lead_take.wav',
      sizeBytes: 48_213_000,
      originStatus: 'declared',
      rightsStatus: 'claimed',
    });
    store.insertProjectAsset(asset, '2026-01-01T00:05:00.000Z');

    const loaded = store.getProjectAsset(asset.id);
    expect(loaded).toEqual(asset);
    store.close();
  });

  it('round-trips an asset with every optional field omitted, never reconstructing them as null', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    seedSession(store);
    const asset = makeProjectAsset('asset-bare');
    store.insertProjectAsset(asset, '2026-01-01T00:05:00.000Z');

    const loaded = store.getProjectAsset(asset.id);
    expect(loaded).toEqual(asset);
    expect('workReference' in (loaded ?? {})).toBe(false);
    expect('createdByProfileId' in (loaded ?? {})).toBe(false);
    expect('originalFilename' in (loaded ?? {})).toBe(false);
    expect('sizeBytes' in (loaded ?? {})).toBe(false);
    expect('rightsStatus' in (loaded ?? {})).toBe(false);
    store.close();
  });

  it('returns undefined for an asset that was never inserted', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    expect(store.getProjectAsset(asAssetId('nope'))).toBeUndefined();
    store.close();
  });

  it('duplicate insertion of the exact same asset is an idempotent no-op', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    seedSession(store);
    const asset = makeProjectAsset();
    const first = store.insertProjectAsset(asset, '2026-01-01T00:05:00.000Z');
    const second = store.insertProjectAsset(asset, '2026-01-01T00:05:00.000Z');
    expect(first).toEqual({ inserted: true });
    expect(second).toEqual({ inserted: false, reason: 'duplicate' });
    store.close();
  });

  it('a conflicting asset (same id, different content) throws and never overwrites the original', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    seedSession(store);
    const original = makeProjectAsset('asset-x', 'project-1', { originalFilename: 'v1.wav' });
    store.insertProjectAsset(original, '2026-01-01T00:05:00.000Z');

    const conflicting = makeProjectAsset('asset-x', 'project-1', { originalFilename: 'v2.wav' });
    expect(() => store.insertProjectAsset(conflicting, '2026-01-01T00:05:00.000Z')).toThrow(StoreConflictError);
    expect(store.getProjectAsset(asAssetId('asset-x'))?.originalFilename).toBe('v1.wav');
    store.close();
  });

  it('lists a project\'s assets ordered by firstSeenAt (rowid as tiebreaker), never another project\'s assets', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    seedSession(store);

    const midi = makeProjectAsset('asset-midi', 'project-cold-nights', { firstSeenAt: '2026-01-05T18:05:00.000Z' });
    const stem = makeProjectAsset('asset-stem', 'project-cold-nights', { firstSeenAt: '2026-01-05T18:10:00.000Z' });
    const guitar = makeProjectAsset('asset-guitar', 'project-cold-nights', { firstSeenAt: '2026-01-06T09:00:00.000Z' });
    const otherProjectAsset = makeProjectAsset('asset-other', 'project-other-song', {
      firstSeenAt: '2026-01-05T18:00:00.000Z',
    });

    // Inserted out of chronological order on purpose, interleaved with a different project's asset.
    store.insertProjectAsset(stem, '2026-01-05T18:15:00.000Z');
    store.insertProjectAsset(otherProjectAsset, '2026-01-05T18:16:00.000Z');
    store.insertProjectAsset(guitar, '2026-01-06T09:05:00.000Z');
    store.insertProjectAsset(midi, '2026-01-05T18:17:00.000Z');

    const coldNightsAssets = store.listProjectAssetsForProject(asProjectId('project-cold-nights'));
    expect(coldNightsAssets.map((a) => a.id)).toEqual(['asset-midi', 'asset-stem', 'asset-guitar']);
    expect(coldNightsAssets).toEqual([midi, stem, guitar]);

    const otherProjectAssets = store.listProjectAssetsForProject(asProjectId('project-other-song'));
    expect(otherProjectAssets.map((a) => a.id)).toEqual(['asset-other']);

    // Never leaks across projects in either direction.
    expect(coldNightsAssets.some((a) => a.id === otherProjectAsset.id)).toBe(false);
    expect(otherProjectAssets.some((a) => a.projectId === midi.projectId)).toBe(false);

    store.close();
  });

  it('returns an empty list for a project with no assets', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    expect(store.listProjectAssetsForProject(asProjectId('no-assets-here'))).toEqual([]);
    store.close();
  });

  it('allows the exact same sha256 to appear under multiple distinct asset ids — duplicate content is not a conflict', () => {
    const store = new LocalEvidenceStore(makeDbPath());
    seedSession(store);
    const sharedHash = 'd'.repeat(64);
    const purchased = makeProjectAsset('asset-sample-purchase-1', 'project-1', { sha256: sharedHash });
    const reused = makeProjectAsset('asset-sample-purchase-2', 'project-1', { sha256: sharedHash });

    expect(store.insertProjectAsset(purchased, '2026-01-01T00:05:00.000Z')).toEqual({ inserted: true });
    expect(store.insertProjectAsset(reused, '2026-01-01T00:05:01.000Z')).toEqual({ inserted: true });
    expect(store.getProjectAsset(purchased.id)?.sha256).toBe(sharedHash);
    expect(store.getProjectAsset(reused.id)?.sha256).toBe(sharedHash);
    store.close();
  });

  it('an asset survives a store close/reopen at the same path', () => {
    const path = makeDbPath();
    const first = new LocalEvidenceStore(path);
    seedSession(first);
    const asset = makeProjectAsset('asset-durable', 'project-1', {
      createdByProfileId: asProfileId('profile-1'),
      originalFilename: 'cold_nights_final_master.wav',
    });
    first.insertProjectAsset(asset, '2026-01-01T00:05:00.000Z');
    first.close();

    const second = new LocalEvidenceStore(path);
    expect(second.getProjectAsset(asset.id)).toEqual(asset);
    expect(second.listProjectAssetsForProject(asProjectId('project-1')).map((a) => a.id)).toEqual(['asset-durable']);
    second.close();
  });
});

describe('LocalEvidenceStore — append-only enforcement (direct SQL against the persisted file)', () => {
  function reopenRaw(path: string) {
    return openEvidenceDatabase(path);
  }

  it('blocks UPDATE and DELETE on events', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    store.insertEvent(makeEvent(), '2026-01-01T00:05:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE events SET eventType = 'project_opened'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM events')).toThrow(/append-only/);
    closeEvidenceDatabase(raw);
  });

  it('blocks UPDATE and DELETE on checkpoints', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    store.insertCheckpoint(makeCheckpoint(), '2026-01-01T00:05:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE checkpoints SET triggerType = 'export'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM checkpoints')).toThrow(/append-only/);
    closeEvidenceDatabase(raw);
  });

  it('blocks UPDATE and DELETE on batches (the immutable signed fact) but allows batch_validation_state to change', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    store.insertBatch(makeBatch(), '2026-01-01T00:05:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE batches SET signature = 'forged'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM batches')).toThrow(/append-only/);
    // The isolated mutable table is NOT protected by these triggers — that's deliberate.
    expect(() => raw.exec("UPDATE batch_validation_state SET validationStatus = 'valid'")).not.toThrow();
    closeEvidenceDatabase(raw);
  });

  it('blocks UPDATE and DELETE on devices and device_revocations', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    const device = makeDevice();
    store.insertDevice(device, FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.revokeDevice(device.id, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE devices SET appVersion = '9.9.9'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM devices')).toThrow(/append-only/);
    expect(() => raw.exec("UPDATE device_revocations SET revokedAt = '2030-01-01T00:00:00.000Z'")).toThrow(
      /append-only/,
    );
    expect(() => raw.exec('DELETE FROM device_revocations')).toThrow(/append-only/);
    closeEvidenceDatabase(raw);
  });

  it('blocks UPDATE and DELETE on contributor_references — a historical claim cannot be mutated or withdrawn by rewriting the row', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    store.insertContributorReference(makeContributorClaim(), '2026-01-01T00:05:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE contributor_references SET role = 'musician'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM contributor_references')).toThrow(/append-only/);
    closeEvidenceDatabase(raw);
  });

  it('blocks UPDATE and DELETE on project_assets — a persisted asset record cannot be mutated or removed by rewriting the row', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    store.insertSession(makeSession(), '2026-01-01T00:00:00.000Z');
    store.insertProjectAsset(makeProjectAsset(), '2026-01-01T00:05:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE project_assets SET originalFilename = 'renamed.wav'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM project_assets')).toThrow(/append-only/);
    closeEvidenceDatabase(raw);
  });

  it('blocks UPDATE and DELETE on sessions and session_ends', () => {
    const path = makeDbPath();
    const store = new LocalEvidenceStore(path);
    store.insertDevice(makeDevice(), FAKE_PUBLIC_KEY, '2026-01-01T00:00:00.000Z');
    const session = makeSession();
    store.insertSession(session, '2026-01-01T00:00:00.000Z');
    store.endSession(session.id, '2026-01-01T01:00:00.000Z', 'ended', '2026-01-01T01:00:00.000Z');
    store.close();

    const raw = reopenRaw(path);
    expect(() => raw.exec("UPDATE sessions SET daw = 'reaper'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM sessions')).toThrow(/append-only/);
    expect(() => raw.exec("UPDATE session_ends SET status = 'abandoned'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM session_ends')).toThrow(/append-only/);
    closeEvidenceDatabase(raw);
  });
});
