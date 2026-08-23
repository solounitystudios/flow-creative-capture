import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

// See src/store/database.ts's docstring: node:sqlite is an experimental
// builtin omitted from module.builtinModules, so this project's build
// tooling (Vite, under vitest run) can't statically resolve a plain
// `import { DatabaseSync } from 'node:sqlite'`. createRequire sidesteps it.
interface SqliteModule {
  DatabaseSync: new (path: string) => DatabaseSyncType;
}
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as SqliteModule;
import {
  closeEvidenceDatabase,
  isUniqueConstraintError,
  openEvidenceDatabase,
  UnsupportedSchemaVersionError,
  withTransaction,
} from '../../src/store/database.js';
import { CURRENT_SCHEMA_VERSION } from '../../src/store/schema.js';

const tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flow-store-db-test-'));
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

describe('openEvidenceDatabase — fresh / reopen / version handling', () => {
  it('initializes a fresh database to CURRENT_SCHEMA_VERSION', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(CURRENT_SCHEMA_VERSION);
    closeEvidenceDatabase(db);
  });

  it('reopens an existing, current-version database normally', () => {
    const path = makeDbPath();
    const first = openEvidenceDatabase(path);
    first.prepare('INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    closeEvidenceDatabase(first);

    const second = openEvidenceDatabase(path);
    const row = second.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(row).toBeDefined();
    closeEvidenceDatabase(second);
  });

  it('rejects an unsupported (future/mismatched) schema version safely, without deleting or rewriting the database', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    closeEvidenceDatabase(db);

    // Simulate a database written by some other, incompatible schema version.
    const raw = new DatabaseSync(path);
    raw.exec('UPDATE schema_version SET version = 999');
    raw.close();

    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);

    // The database must be untouched — still reporting the version we set, not silently reset to 1.
    const verify = new DatabaseSync(path);
    const row = verify.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(999);
    verify.close();
  });
});

// The exact schema version 1 DDL from before the Contributor Claims
// Persistence batch (see `src/store/schema.ts`'s `SCHEMA_V1_DDL` history —
// recovered from git, not reconstructed from memory) — i.e. everything
// this store persisted BEFORE `contributor_references` existed. Used to
// build a genuine v1-shaped database fixture, not a reinterpretation of
// the current schema with a table removed.
const SCHEMA_V1_DDL = `
CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  profileId TEXT NOT NULL,
  devicePublicId TEXT NOT NULL,
  platform TEXT NOT NULL,
  appVersion TEXT NOT NULL,
  deviceKeyFingerprint TEXT NOT NULL,
  publicKeySpkiDer TEXT NOT NULL,
  verifiedAt TEXT,
  storedAt TEXT NOT NULL
);

CREATE TABLE device_revocations (
  deviceId TEXT PRIMARY KEY REFERENCES devices(id),
  revokedAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  workReference TEXT,
  actorProfileId TEXT NOT NULL,
  deviceId TEXT NOT NULL REFERENCES devices(id),
  daw TEXT NOT NULL,
  dawVersion TEXT,
  startedAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_sessions_project ON sessions(projectId);
CREATE INDEX idx_sessions_device ON sessions(deviceId);

CREATE TABLE session_ends (
  sessionId TEXT PRIMARY KEY REFERENCES sessions(id),
  endedAt TEXT NOT NULL,
  status TEXT NOT NULL,
  storedAt TEXT NOT NULL
);

CREATE TABLE events (
  eventId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  workReference TEXT,
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  actorProfileId TEXT NOT NULL,
  deviceId TEXT NOT NULL REFERENCES devices(id),
  source TEXT NOT NULL,
  eventType TEXT NOT NULL,
  assetId TEXT,
  trackReference TEXT,
  occurredAt TEXT NOT NULL,
  receivedAt TEXT,
  payload TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_events_session ON events(sessionId);
CREATE INDEX idx_events_project ON events(projectId);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  workReference TEXT,
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  actorProfileId TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  previousCheckpointHash TEXT,
  manifestHash TEXT NOT NULL,
  checkpointHash TEXT NOT NULL,
  triggerType TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_checkpoints_project_seq ON checkpoints(projectId, sequence);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  profileId TEXT NOT NULL,
  deviceId TEXT NOT NULL REFERENCES devices(id),
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  eventCount INTEGER NOT NULL,
  firstEventAt TEXT NOT NULL,
  lastEventAt TEXT NOT NULL,
  previousBatchHash TEXT,
  manifestHash TEXT NOT NULL,
  signature TEXT,
  createdAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_batches_device ON batches(deviceId, createdAt);
CREATE INDEX idx_batches_session ON batches(sessionId);

CREATE TABLE batch_validation_state (
  batchId TEXT PRIMARY KEY REFERENCES batches(id),
  validationStatus TEXT NOT NULL,
  statusAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);

CREATE TRIGGER trg_devices_no_update BEFORE UPDATE ON devices BEGIN SELECT RAISE(ABORT, 'devices is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_devices_no_delete BEFORE DELETE ON devices BEGIN SELECT RAISE(ABORT, 'devices is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_device_revocations_no_update BEFORE UPDATE ON device_revocations BEGIN SELECT RAISE(ABORT, 'device_revocations is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_device_revocations_no_delete BEFORE DELETE ON device_revocations BEGIN SELECT RAISE(ABORT, 'device_revocations is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_sessions_no_update BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_sessions_no_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_session_ends_no_update BEFORE UPDATE ON session_ends BEGIN SELECT RAISE(ABORT, 'session_ends is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_session_ends_no_delete BEFORE DELETE ON session_ends BEGIN SELECT RAISE(ABORT, 'session_ends is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_checkpoints_no_update BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT, 'checkpoints is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_checkpoints_no_delete BEFORE DELETE ON checkpoints BEGIN SELECT RAISE(ABORT, 'checkpoints is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_batches_no_update BEFORE UPDATE ON batches BEGIN SELECT RAISE(ABORT, 'batches is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_batches_no_delete BEFORE DELETE ON batches BEGIN SELECT RAISE(ABORT, 'batches is append-only: rows cannot be deleted'); END;
`;

describe('openEvidenceDatabase — pre-Contributor-Claims (schema version 1) database rejection', () => {
  it('rejects a pre-Contributor-Claims (schema version 1) database safely', () => {
    const path = makeDbPath();

    // Build a genuine v1-shaped database: no contributor_references table,
    // no migration engine involved — just the historical V1 DDL, exactly
    // as a real pre-Batch-6 install would have on disk.
    const v1 = new DatabaseSync(path);
    v1.exec(SCHEMA_V1_DDL);
    v1.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
    v1.prepare(
      'INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    v1.close();

    // Confirm the fixture really is schema version 1 before touching it
    // with current code.
    const preCheck = new DatabaseSync(path);
    expect((preCheck.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(1);
    const preTables = preCheck
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(preTables.map((t) => t.name)).not.toContain('contributor_references');
    preCheck.close();

    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);

    // No automatic upgrade: the historical database's schema and content
    // are left exactly as they were, never silently migrated or rewritten
    // to version 2.
    const verify = new DatabaseSync(path);
    expect((verify.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(1);
    const postTables = verify
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(postTables.map((t) => t.name)).not.toContain('contributor_references');
    const device = verify.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(device).toBeDefined();
    verify.close();
  });
});

describe('withTransaction', () => {
  it('commits durably on success', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    withTransaction(db, () => {
      db.prepare('INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    });
    const row = db.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(row).toBeDefined();
    closeEvidenceDatabase(db);
  });

  it('rolls back and rethrows on failure, leaving no partial writes', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
        throw new Error('simulated mid-transaction failure');
      }),
    ).toThrow('simulated mid-transaction failure');

    const row = db.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(row).toBeUndefined();
    closeEvidenceDatabase(db);
  });
});

describe('isUniqueConstraintError', () => {
  it('recognizes a real UNIQUE/PRIMARY KEY constraint violation', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    db.prepare('INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    try {
      db.prepare('INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('device-1', 'profile-2', 'pub-2', 'windows', '2.0.0', 'e'.repeat(64), 'BBBB', '2026-01-02T00:00:00.000Z');
      expect.unreachable('expected a UNIQUE constraint violation');
    } catch (error) {
      expect(isUniqueConstraintError(error)).toBe(true);
    }
    closeEvidenceDatabase(db);
  });

  it('does not misclassify an unrelated error (e.g. a FOREIGN KEY violation) as a unique constraint error', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    try {
      db.prepare(
        'INSERT INTO sessions (id, projectId, actorProfileId, deviceId, daw, startedAt, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('session-1', 'project-1', 'profile-1', 'device-does-not-exist', 'fl_studio', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      expect.unreachable('expected a FOREIGN KEY violation');
    } catch (error) {
      expect(isUniqueConstraintError(error)).toBe(false);
    }
    closeEvidenceDatabase(db);
  });

  it('returns false for a non-Error value', () => {
    expect(isUniqueConstraintError('not an error')).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
  });
});
