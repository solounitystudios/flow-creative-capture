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
