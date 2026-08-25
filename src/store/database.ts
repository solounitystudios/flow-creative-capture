import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_VERSION, SCHEMA_V4_DDL } from './schema.js';

/**
 * node:sqlite (`DatabaseSync`) is Node's built-in, synchronous SQLite
 * binding — no native module, no node-gyp/prebuild-install, works
 * identically in this repo's Node version, in CI, and in any future
 * Node-based desktop shell. It is still an experimental Node API (see
 * ARCHITECTURE.md for the full tradeoff this batch made); everything in
 * this module is written against its documented, stable-shaped surface
 * (`exec`, `prepare`, `.run`/`.get`/`.all`, transactions via manual
 * BEGIN/COMMIT/ROLLBACK) rather than any internal behavior.
 *
 * The constructor is loaded via `createRequire` rather than a static
 * `import` because experimental Node builtins (unlike
 * `node:fs`/`node:crypto`/...) are deliberately omitted from
 * `module.builtinModules`, which is what this project's build tooling
 * (Vite, under `vitest run`) uses to decide what to leave untouched vs.
 * try to resolve as a project file. A static `import { DatabaseSync }
 * from 'node:sqlite'` fails under that tooling for exactly this reason;
 * `require('node:sqlite')` reaches Node's real module loader directly and
 * works. The `import type` above is unaffected — type-only imports are
 * erased before any bundler ever sees them, so it carries no runtime
 * resolution risk and gives every function below a real, checked type.
 */
interface SqliteModule {
  DatabaseSync: new (path: string) => DatabaseSync;
}

const require = createRequire(import.meta.url);
const SqliteDatabaseSync = (require('node:sqlite') as SqliteModule).DatabaseSync;

export class UnsupportedSchemaVersionError extends Error {
  constructor(
    public readonly foundVersion: number,
    public readonly supportedVersion: number,
  ) {
    super(
      `Local evidence database schema version ${foundVersion} is not supported by this build ` +
        `(supports version ${supportedVersion} only). Refusing to open it automatically — ` +
        `this store never silently migrates, recreates, or deletes an existing database.`,
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

function schemaVersionTableExists(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`)
    .get();
  return row !== undefined;
}

function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  if (row === undefined) {
    throw new Error('schema_version table exists but has no row — the database is in an inconsistent state');
  }
  return row.version;
}

function initializeFreshDatabase(db: DatabaseSync): void {
  db.exec(SCHEMA_V4_DDL);
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
}

/**
 * Opens (creating if necessary) the local evidence database at `path`.
 * Pass `:memory:` for an ephemeral, in-process-only database (used by
 * tests). A fresh database is initialized to `CURRENT_SCHEMA_VERSION`. An
 * existing database with a different schema version is rejected outright
 * — this store never auto-migrates, auto-recreates, or auto-deletes an
 * incompatible or corrupted database; that is always an explicit,
 * separate operation a caller must choose to perform.
 */
export function openEvidenceDatabase(path: string): DatabaseSync {
  const db: DatabaseSync = new SqliteDatabaseSync(path);

  // WAL mode is a no-op (silently stays 'memory') for `:memory:` databases,
  // so this is safe to apply unconditionally rather than branching on path.
  // For file-backed databases it lets local reads proceed without blocking
  // on an in-progress write, which matters once a future UI reads evidence
  // concurrently with ongoing capture. There is exactly one process/one
  // connection in this batch's scope — no distributed or multi-process
  // locking is implemented or claimed.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  if (!schemaVersionTableExists(db)) {
    initializeFreshDatabase(db);
    return db;
  }

  const foundVersion = readSchemaVersion(db);
  if (foundVersion !== CURRENT_SCHEMA_VERSION) {
    db.close();
    throw new UnsupportedSchemaVersionError(foundVersion, CURRENT_SCHEMA_VERSION);
  }

  return db;
}

export function closeEvidenceDatabase(db: DatabaseSync): void {
  db.close();
}

/**
 * Runs `fn` inside a BEGIN/COMMIT transaction. If `fn` throws, the
 * transaction is rolled back and the original error is rethrown — no
 * partial writes from `fn` are left durable. Nesting is not supported
 * (matches this store's single-process, single-connection scope).
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const UNIQUE_CONSTRAINT_MESSAGE = 'UNIQUE constraint failed';

/** True if `error` is a node:sqlite UNIQUE/PRIMARY KEY constraint violation. */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR' &&
    error.message.includes(UNIQUE_CONSTRAINT_MESSAGE)
  );
}
