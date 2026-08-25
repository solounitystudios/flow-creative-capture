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
    expect(row.version).toBe(5);
    closeEvidenceDatabase(db);
  });

  it('initializes a fresh database with the project_assets table present', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('project_assets');
    closeEvidenceDatabase(db);
  });

  it('initializes a fresh database with the projects table present', () => {
    const path = makeDbPath();
    const db = openEvidenceDatabase(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('projects');
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

// The exact schema version 2 DDL from before the ProjectAsset Persistence
// batch (see `src/store/schema.ts`'s `SCHEMA_V3_DDL` history — recovered
// from the file as it stood immediately before this batch's changes, not
// reconstructed from memory) — i.e. everything this store persisted
// BEFORE `project_assets` existed. Used to build a genuine v2-shaped
// database fixture, not a reinterpretation of the current schema with a
// table removed.
const SCHEMA_V2_DDL = `
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

CREATE TABLE contributor_references (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  profileId TEXT NOT NULL,
  role TEXT NOT NULL,
  subrole TEXT,
  description TEXT,
  claimedAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_contributor_references_project ON contributor_references(projectId);

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

CREATE TRIGGER trg_contributor_references_no_update BEFORE UPDATE ON contributor_references BEGIN SELECT RAISE(ABORT, 'contributor_references is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_contributor_references_no_delete BEFORE DELETE ON contributor_references BEGIN SELECT RAISE(ABORT, 'contributor_references is append-only: rows cannot be deleted'); END;
`;

describe('openEvidenceDatabase — pre-ProjectAsset (schema version 2) database rejection', () => {
  it('rejects a pre-ProjectAsset (schema version 2) database safely', () => {
    const path = makeDbPath();

    // Build a genuine v2-shaped database: no project_assets table, no
    // migration engine involved — just the historical V2 DDL, exactly as
    // a real pre-this-batch install would have on disk.
    const v2 = new DatabaseSync(path);
    v2.exec(SCHEMA_V2_DDL);
    v2.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2);
    v2.prepare(
      'INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    v2.close();

    // Confirm the fixture really is schema version 2 before touching it
    // with current code.
    const preCheck = new DatabaseSync(path);
    expect((preCheck.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(2);
    const preTables = preCheck
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(preTables.map((t) => t.name)).not.toContain('project_assets');
    preCheck.close();

    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);

    // No automatic upgrade: the historical database's schema and content
    // are left exactly as they were, never silently migrated or rewritten
    // to version 3.
    const verify = new DatabaseSync(path);
    expect((verify.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(2);
    const postTables = verify
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(postTables.map((t) => t.name)).not.toContain('project_assets');
    const device = verify.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(device).toBeDefined();
    verify.close();
  });
});

// The exact schema version 3 DDL from before Capture Studio V1's local
// write path (see `src/store/schema.ts`'s `SCHEMA_V4_DDL` history —
// recovered from the file as it stood immediately before this batch's
// changes, not reconstructed from memory) — i.e. everything this store
// persisted BEFORE `projects` existed. Used to build a genuine v3-shaped
// database fixture, not a reinterpretation of the current schema with a
// table removed.
const SCHEMA_V3_DDL = `
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
CREATE INDEX idx_events_asset ON events(assetId);

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

CREATE TABLE contributor_references (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  profileId TEXT NOT NULL,
  role TEXT NOT NULL,
  subrole TEXT,
  description TEXT,
  claimedAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_contributor_references_project ON contributor_references(projectId);

CREATE TABLE project_assets (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  workReference TEXT,
  createdByProfileId TEXT,
  introducedBySessionId TEXT NOT NULL REFERENCES sessions(id),
  assetType TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  originalFilename TEXT,
  sha256 TEXT NOT NULL,
  sizeBytes INTEGER,
  firstSeenAt TEXT NOT NULL,
  originStatus TEXT NOT NULL,
  rightsStatus TEXT,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_project_assets_project ON project_assets(projectId);
CREATE INDEX idx_project_assets_sha256 ON project_assets(sha256);

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

CREATE TRIGGER trg_contributor_references_no_update BEFORE UPDATE ON contributor_references BEGIN SELECT RAISE(ABORT, 'contributor_references is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_contributor_references_no_delete BEFORE DELETE ON contributor_references BEGIN SELECT RAISE(ABORT, 'contributor_references is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_project_assets_no_update BEFORE UPDATE ON project_assets BEGIN SELECT RAISE(ABORT, 'project_assets is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_project_assets_no_delete BEFORE DELETE ON project_assets BEGIN SELECT RAISE(ABORT, 'project_assets is append-only: rows cannot be deleted'); END;
`;

describe('openEvidenceDatabase — schema v3 -> v4 "upgrade" is a safe rejection, not a migration', () => {
  /**
   * This store has no migration engine (see schema.ts's docstring and
   * every prior version-bump test above) — there is no code path that
   * takes a v3 database and rewrites it into a v4 one in place. The only
   * safe "upgrade" this architecture supports is: reject the mismatched
   * database outright (proven here, comprehensively, across every table
   * a real v3 install could hold), and create a fresh v4 database
   * separately when a caller explicitly chooses to (already proven by
   * "initializes a fresh database with the projects table present" and
   * the full LocalEvidenceStore — projects test suite in
   * evidenceStore.test.ts). This test exists specifically to prove that
   * rejection touches NOTHING — every table, not just `devices` — and
   * that repeatedly attempting to open the same v3 file under v4 code
   * (e.g. a service restarted twice against old data) is idempotent: it
   * fails the same safe way every time, never partially applying
   * anything on a later attempt.
   */
  it('rejects a v3 database with real rows in every v3 table, preserving all of them byte-for-byte, and does so identically on repeated open attempts', () => {
    const path = makeDbPath();

    const v3 = new DatabaseSync(path);
    v3.exec(SCHEMA_V3_DDL);
    v3.prepare('INSERT INTO schema_version (version) VALUES (?)').run(3);
    v3.prepare(
      'INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, verifiedAt, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    v3.prepare(
      'INSERT INTO sessions (id, projectId, actorProfileId, deviceId, daw, startedAt, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('session-1', 'project-legacy', 'profile-1', 'device-1', 'fl_studio', '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z');
    v3.prepare(
      'INSERT INTO session_ends (sessionId, endedAt, status, storedAt) VALUES (?, ?, ?, ?)',
    ).run('session-1', '2026-01-01T00:30:00.000Z', 'ended', '2026-01-01T00:30:00.000Z');
    v3.prepare(
      'INSERT INTO events (eventId, projectId, sessionId, actorProfileId, deviceId, source, eventType, occurredAt, payload, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('event-1', 'project-legacy', 'session-1', 'profile-1', 'device-1', 'fl_studio', 'project_saved', '2026-01-01T00:02:00.000Z', '{}', '2026-01-01T00:02:00.000Z');
    v3.prepare(
      'INSERT INTO checkpoints (id, projectId, sessionId, actorProfileId, sequence, manifestHash, checkpointHash, triggerType, createdAt, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('checkpoint-1', 'project-legacy', 'session-1', 'profile-1', 0, 'a'.repeat(64), 'b'.repeat(64), 'manual', '2026-01-01T00:03:00.000Z', '2026-01-01T00:03:00.000Z');
    v3.prepare(
      'INSERT INTO batches (id, profileId, deviceId, sessionId, eventCount, firstEventAt, lastEventAt, manifestHash, signature, createdAt, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('batch-1', 'profile-1', 'device-1', 'session-1', 1, '2026-01-01T00:02:00.000Z', '2026-01-01T00:02:00.000Z', 'c'.repeat(64), 'd'.repeat(88), '2026-01-01T00:04:00.000Z', '2026-01-01T00:04:00.000Z');
    v3.prepare(
      'INSERT INTO batch_validation_state (batchId, validationStatus, statusAt, storedAt) VALUES (?, ?, ?, ?)',
    ).run('batch-1', 'valid', '2026-01-01T00:05:00.000Z', '2026-01-01T00:05:00.000Z');
    v3.prepare(
      'INSERT INTO contributor_references (id, projectId, profileId, role, claimedAt, storedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('claim-1', 'project-legacy', 'profile-2', 'musician', '2026-01-01T00:06:00.000Z', '2026-01-01T00:06:00.000Z');
    v3.prepare(
      'INSERT INTO project_assets (id, projectId, introducedBySessionId, assetType, sourceType, sha256, firstSeenAt, originStatus, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('asset-1', 'project-legacy', 'session-1', 'audio', 'human_recorded', 'e'.repeat(64), '2026-01-01T00:07:00.000Z', 'declared', '2026-01-01T00:07:00.000Z');
    v3.close();

    const tablesWithLegacyRows: readonly [string, string, string][] = [
      ['devices', 'id', 'device-1'],
      ['sessions', 'id', 'session-1'],
      ['session_ends', 'sessionId', 'session-1'],
      ['events', 'eventId', 'event-1'],
      ['checkpoints', 'id', 'checkpoint-1'],
      ['batches', 'id', 'batch-1'],
      ['batch_validation_state', 'batchId', 'batch-1'],
      ['contributor_references', 'id', 'claim-1'],
      ['project_assets', 'id', 'asset-1'],
    ];

    function snapshotAllRows(): Record<string, Record<string, unknown> | undefined> {
      const db = new DatabaseSync(path);
      const snapshot: Record<string, Record<string, unknown> | undefined> = {};
      for (const [table, idColumn, idValue] of tablesWithLegacyRows) {
        snapshot[table] = db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(idValue);
      }
      db.close();
      return snapshot;
    }

    const before = snapshotAllRows();
    for (const [table] of tablesWithLegacyRows) {
      expect(before[table], `expected a pre-existing row in ${table} before any open attempt`).toBeDefined();
    }

    // First open attempt under v4 code: rejected, nothing touched.
    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);
    const afterFirstAttempt = snapshotAllRows();
    expect(afterFirstAttempt).toEqual(before);

    // A second, independent open attempt (e.g. the Studio service process
    // restarting twice against the same old file) must fail exactly the
    // same way, not "succeed the second time" or partially apply a v4
    // shape — there is no migration state to accumulate across attempts.
    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);
    const afterSecondAttempt = snapshotAllRows();
    expect(afterSecondAttempt).toEqual(before);

    // The schema_version row itself, and the absence of `projects`, are
    // both still exactly what they were — no partial migration artifact
    // of any kind was left behind by either attempt.
    const finalCheck = new DatabaseSync(path);
    expect((finalCheck.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(3);
    const finalTables = finalCheck.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(finalTables.map((t) => t.name)).not.toContain('projects');
    finalCheck.close();
  });

  it('the only supported path forward for a v3 database is a fresh, separate v4 database — which then fully supports project creation alongside all prior record kinds', () => {
    // Not an in-place migration: a genuinely new file, initialized fresh.
    // This is the other half of the "upgrade" story — already exercised
    // in depth by LocalEvidenceStore's own "projects" test suite
    // (evidenceStore.test.ts), restated here at the database-open level
    // to keep the full v3 -> v4 narrative in one place.
    const freshPath = makeDbPath();
    const db = openEvidenceDatabase(freshPath);
    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(5);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const expectedTable of ['projects', 'devices', 'sessions', 'events', 'checkpoints', 'batches', 'contributor_references', 'project_assets']) {
      expect(tables.map((t) => t.name)).toContain(expectedTable);
    }
    closeEvidenceDatabase(db);
  });
});

describe('openEvidenceDatabase — pre-projects (schema version 3) database rejection', () => {
  it('rejects a pre-projects (schema version 3) database safely', () => {
    const path = makeDbPath();

    // Build a genuine v3-shaped database: no projects table, no migration
    // engine involved — just the historical V3 DDL, exactly as a real
    // pre-this-batch install would have on disk.
    const v3 = new DatabaseSync(path);
    v3.exec(SCHEMA_V3_DDL);
    v3.prepare('INSERT INTO schema_version (version) VALUES (?)').run(3);
    v3.prepare(
      'INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    v3.close();

    // Confirm the fixture really is schema version 3 before touching it
    // with current code.
    const preCheck = new DatabaseSync(path);
    expect((preCheck.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(3);
    const preTables = preCheck
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(preTables.map((t) => t.name)).not.toContain('projects');
    preCheck.close();

    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);

    // No automatic upgrade: the historical database's schema and content
    // are left exactly as they were, never silently migrated or rewritten
    // to version 4.
    const verify = new DatabaseSync(path);
    expect((verify.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(3);
    const postTables = verify
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(postTables.map((t) => t.name)).not.toContain('projects');
    const device = verify.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(device).toBeDefined();
    verify.close();
  });
});

describe('openEvidenceDatabase — pre-checkpoint-signing (schema version 4) database rejection', () => {
  it('rejects a pre-checkpoint-signing (schema version 4) database safely', () => {
    const path = makeDbPath();

    // Build a genuine v4-shaped database: `checkpoints` has no deviceId/
    // signature columns, no migration engine involved — just the
    // historical V4 DDL, exactly as a real pre-Capture-Studio-V2 install
    // would have on disk.
    const v4 = new DatabaseSync(path);
    v4.exec(SCHEMA_V4_DDL);
    v4.prepare('INSERT INTO schema_version (version) VALUES (?)').run(4);
    v4.prepare(
      'INSERT INTO devices (id, profileId, devicePublicId, platform, appVersion, deviceKeyFingerprint, publicKeySpkiDer, storedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('device-1', 'profile-1', 'pub-1', 'macos', '1.0.0', 'f'.repeat(64), 'AAAA', '2026-01-01T00:00:00.000Z');
    v4.close();

    // Confirm the fixture really is schema version 4, with an un-signable
    // checkpoints table, before touching it with current code.
    const preCheck = new DatabaseSync(path);
    expect((preCheck.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(4);
    const checkpointColumns = preCheck.prepare('PRAGMA table_info(checkpoints)').all() as { name: string }[];
    expect(checkpointColumns.map((c) => c.name)).not.toContain('deviceId');
    expect(checkpointColumns.map((c) => c.name)).not.toContain('signature');
    preCheck.close();

    expect(() => openEvidenceDatabase(path)).toThrow(UnsupportedSchemaVersionError);

    // No automatic upgrade: the historical database's schema and content
    // are left exactly as they were, never silently migrated or rewritten
    // to version 5.
    const verify = new DatabaseSync(path);
    expect((verify.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(4);
    const postColumns = verify.prepare('PRAGMA table_info(checkpoints)').all() as { name: string }[];
    expect(postColumns.map((c) => c.name)).not.toContain('deviceId');
    const device = verify.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    expect(device).toBeDefined();
    verify.close();
  });
});

// The exact schema version 4 DDL from before Capture Studio V2 (Live
// Signed Evidence Checkpoints) — recovered from git, not reconstructed
// from memory — i.e. `checkpoints` before it carried `deviceId`/
// `signature`. Used to build a genuine v4-shaped database fixture.
const SCHEMA_V4_DDL = `
CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  ownerProfileId TEXT NOT NULL,
  organizationId TEXT,
  externalProjectPassportId TEXT,
  title TEXT NOT NULL,
  projectType TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
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
CREATE INDEX idx_events_asset ON events(assetId);

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

CREATE TABLE contributor_references (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  profileId TEXT NOT NULL,
  role TEXT NOT NULL,
  subrole TEXT,
  description TEXT,
  claimedAt TEXT NOT NULL,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_contributor_references_project ON contributor_references(projectId);

CREATE TABLE project_assets (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  workReference TEXT,
  createdByProfileId TEXT,
  introducedBySessionId TEXT NOT NULL REFERENCES sessions(id),
  assetType TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  originalFilename TEXT,
  sha256 TEXT NOT NULL,
  sizeBytes INTEGER,
  firstSeenAt TEXT NOT NULL,
  originStatus TEXT NOT NULL,
  rightsStatus TEXT,
  storedAt TEXT NOT NULL
);
CREATE INDEX idx_project_assets_project ON project_assets(projectId);
CREATE INDEX idx_project_assets_sha256 ON project_assets(sha256);

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

CREATE TRIGGER trg_contributor_references_no_update BEFORE UPDATE ON contributor_references BEGIN SELECT RAISE(ABORT, 'contributor_references is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_contributor_references_no_delete BEFORE DELETE ON contributor_references BEGIN SELECT RAISE(ABORT, 'contributor_references is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_project_assets_no_update BEFORE UPDATE ON project_assets BEGIN SELECT RAISE(ABORT, 'project_assets is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_project_assets_no_delete BEFORE DELETE ON project_assets BEGIN SELECT RAISE(ABORT, 'project_assets is append-only: rows cannot be deleted'); END;

CREATE TRIGGER trg_projects_no_update BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'projects is append-only: rows cannot be updated'); END;
CREATE TRIGGER trg_projects_no_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'projects is append-only: rows cannot be deleted'); END;
`;

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
