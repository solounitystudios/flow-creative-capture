import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asBatchId, asCheckpointId, asDeviceId, asEventId, asProfileId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createStudioDevice } from '../../src/domain/studioDevice.js';
import { createStudioSession } from '../../src/domain/studioSession.js';
import { createProvenanceEvent } from '../../src/domain/provenanceEvent.js';
import { createProvenanceBatch } from '../../src/domain/provenanceBatch.js';
import { createCheckpointFromManifest } from '../../src/provenance/checkpoint.js';
import { LocalEvidenceStore } from '../../src/store/evidenceStore.js';
import { StoreConflictError } from '../../src/store/errors.js';

const tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flow-store-tx-test-'));
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

const FAKE_PUBLIC_KEY = Buffer.from('fixture-public-key-bytes');

function setUpStore(): LocalEvidenceStore {
  const store = new LocalEvidenceStore(makeDbPath());
  store.insertDevice(
    createStudioDevice({
      id: asDeviceId('device-1'),
      profileId: asProfileId('profile-1'),
      devicePublicId: 'pub-1',
      platform: 'macos',
      appVersion: '1.0.0',
      deviceKeyFingerprint: 'f'.repeat(64),
    }),
    FAKE_PUBLIC_KEY,
    '2026-01-01T00:00:00.000Z',
  );
  store.insertSession(
    createStudioSession({
      id: asSessionId('session-1'),
      projectId: asProjectId('project-1'),
      actorProfileId: asProfileId('profile-1'),
      deviceId: asDeviceId('device-1'),
      daw: 'fl_studio',
      startedAt: '2026-01-01T00:00:00.000Z',
    }),
    '2026-01-01T00:00:00.000Z',
  );
  return store;
}

function makeEvent(eventId: string, occurredAt: string) {
  return createProvenanceEvent({
    eventId: asEventId(eventId),
    projectId: asProjectId('project-1'),
    sessionId: asSessionId('session-1'),
    actorProfileId: asProfileId('profile-1'),
    deviceId: asDeviceId('device-1'),
    source: 'studio_simulator',
    eventType: 'project_saved',
    occurredAt,
  });
}

describe('insertEvidenceBundle — atomicity', () => {
  it('persists events, a checkpoint, and a batch together on success', () => {
    const store = setUpStore();
    const events = [makeEvent('event-1', '2026-01-01T00:01:00.000Z'), makeEvent('event-2', '2026-01-01T00:02:00.000Z')];
    const checkpoint = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-1'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      sequence: 0,
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: events.map((e) => e.eventId) },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:03:00.000Z',
    });
    const batch = createProvenanceBatch({
      id: asBatchId('batch-1'),
      profileId: asProfileId('profile-1'),
      deviceId: asDeviceId('device-1'),
      sessionId: asSessionId('session-1'),
      eventCount: 2,
      firstEventAt: '2026-01-01T00:01:00.000Z',
      lastEventAt: '2026-01-01T00:02:00.000Z',
      manifestHash: checkpoint.manifestHash,
      createdAt: '2026-01-01T00:03:00.000Z',
    });

    store.insertEvidenceBundle({ events, checkpoint, batch, storedAt: '2026-01-01T00:04:00.000Z' });

    expect(store.listEventsForSession(asSessionId('session-1'))).toHaveLength(2);
    expect(store.getCheckpoint(checkpoint.id)).toBeDefined();
    expect(store.getBatch(batch.id)).toBeDefined();
    store.close();
  });

  it('a failure partway through leaves NO partial evidence: nothing from the bundle is durably persisted', () => {
    const store = setUpStore();

    // Pre-existing event that will conflict with one inside the bundle below.
    store.insertEvent(makeEvent('event-conflict', '2026-01-01T00:01:00.000Z'), '2026-01-01T00:01:30.000Z');

    const events = [
      makeEvent('event-ok-1', '2026-01-01T00:02:00.000Z'),
      // Same id as the pre-existing event above, but different content — this must throw.
      makeEvent('event-conflict', '2026-01-01T00:09:00.000Z'),
      makeEvent('event-ok-2', '2026-01-01T00:03:00.000Z'),
    ];
    const checkpoint = createCheckpointFromManifest({
      id: asCheckpointId('checkpoint-would-be-orphaned'),
      projectId: asProjectId('project-1'),
      sessionId: asSessionId('session-1'),
      actorProfileId: asProfileId('profile-1'),
      sequence: 0,
      manifest: { projectId: asProjectId('project-1'), assets: [], eventIds: [] },
      triggerType: 'manual',
      createdAt: '2026-01-01T00:04:00.000Z',
    });
    const batch = createProvenanceBatch({
      id: asBatchId('batch-would-be-orphaned'),
      profileId: asProfileId('profile-1'),
      deviceId: asDeviceId('device-1'),
      sessionId: asSessionId('session-1'),
      eventCount: 3,
      firstEventAt: '2026-01-01T00:02:00.000Z',
      lastEventAt: '2026-01-01T00:03:00.000Z',
      manifestHash: checkpoint.manifestHash,
      createdAt: '2026-01-01T00:04:00.000Z',
    });

    expect(() =>
      store.insertEvidenceBundle({ events, checkpoint, batch, storedAt: '2026-01-01T00:05:00.000Z' }),
    ).toThrow(StoreConflictError);

    // None of the other events in the same bundle survived, despite being inserted before the conflict.
    expect(store.getEvent(asEventId('event-ok-1'))).toBeUndefined();
    expect(store.getEvent(asEventId('event-ok-2'))).toBeUndefined();
    // The checkpoint and batch that would have depended on those events never landed either.
    expect(store.getCheckpoint(checkpoint.id)).toBeUndefined();
    expect(store.getBatch(batch.id)).toBeUndefined();
    // The original, pre-existing event is untouched.
    expect(store.getEvent(asEventId('event-conflict'))?.occurredAt).toBe('2026-01-01T00:01:00.000Z');
    store.close();
  });
});
