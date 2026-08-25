import type { DatabaseSync } from 'node:sqlite';
import type { AssetId, BatchId, CheckpointId, ContributionClaimId, DeviceId, EventId, ProjectId, SessionId } from '../domain/ids.js';
import type { BatchValidationStatus } from '../domain/enums.js';
import type { CreativeProject } from '../domain/creativeProject.js';
import type { StudioDevice } from '../domain/studioDevice.js';
import type { StudioSession } from '../domain/studioSession.js';
import type { ProvenanceEvent } from '../domain/provenanceEvent.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import type { ContributorReference } from '../domain/contributorReference.js';
import type { ProjectAsset } from '../domain/projectAsset.js';
import { validateCheckpointChain, type CheckpointChainValidationResult } from '../provenance/checkpoint.js';
import { verifySignedBatch, type BatchVerificationResult } from '../device/batchSigning.js';
import { closeEvidenceDatabase, isUniqueConstraintError, openEvidenceDatabase, withTransaction } from './database.js';
import { CURRENT_SCHEMA_VERSION } from './schema.js';
import { StoreConflictError } from './errors.js';
import {
  batchToRow,
  checkpointToRow,
  contributorReferenceToRow,
  deviceToRow,
  eventToRow,
  projectAssetToRow,
  projectToRow,
  rowToBatch,
  rowToCheckpoint,
  rowToContributorReference,
  rowToDevice,
  rowToDevicePublicKeySpkiDer,
  rowToEvent,
  rowToProject,
  rowToProjectAsset,
  rowToSession,
  sessionToRow,
  type BatchRow,
  type BatchValidationStateRow,
  type CheckpointRow,
  type ContributorReferenceRow,
  type DeviceRevocationRow,
  type DeviceRow,
  type EventRow,
  type ProjectAssetRow,
  type ProjectRow,
  type SessionEndRow,
  type SessionRow,
} from './rows.js';

/**
 * Result of inserting into an immutable fact table. `duplicate` means the
 * exact same content was already stored under this id — treated as a safe
 * no-op (see StoreConflictError's docstring for why). A conflicting record
 * — same id, different content — never reaches this return type; it
 * throws `StoreConflictError` instead.
 */
export type InsertResult = { readonly inserted: true } | { readonly inserted: false; readonly reason: 'duplicate' };

type SqlPrimitive = string | number | null;

function rowsEqual(a: Record<string, SqlPrimitive>, b: Record<string, SqlPrimitive>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Local Evidence Store (schema version 3).
 *
 * Persists exactly what is needed to reconstruct and independently
 * re-verify locally captured evidence: devices, sessions, provenance
 * events, checkpoints, and signed provenance batches — plus, since schema
 * version 2, explicit contribution claims (`contributor_references`), and
 * since schema version 3, durable project asset metadata
 * (`project_assets`; see schema.ts for the full table rationale and the
 * version-bump/backward-compatibility note). This class is a thin, intentional API over
 * `node:sqlite` — it does not expose raw SQL, a query builder, or the
 * underlying `DatabaseSync` handle to callers.
 *
 * This store PERSISTS evidence. It does not decide whether that evidence
 * should be trusted. Storage success, hash-chain structural validity, and
 * signature cryptographic validity are three separate facts — see
 * `verifyCheckpointChainForProject` / `verifyBatchSignature*` below, none
 * of which are called automatically by any insert method. See
 * SECURITY.md for the full trust-boundary statement.
 */
export class LocalEvidenceStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openEvidenceDatabase(path);
  }

  close(): void {
    closeEvidenceDatabase(this.db);
  }

  getSchemaVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  /**
   * Inserts a row into an immutable fact table, keyed by `idColumn`.
   * Table/column names here are always call-site literals (never derived
   * from user input), so there is no SQL-injection surface despite the
   * string interpolation. Re-inserting byte-identical content for an
   * existing id is a no-op (`{ inserted: false, reason: 'duplicate' }`);
   * re-inserting different content for an existing id throws
   * `StoreConflictError` — this is the ONE duplicate-handling policy
   * applied uniformly to every fact table in this store.
   */
  private insertFactRow(table: string, idColumn: string, row: Record<string, SqlPrimitive>): InsertResult {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((column) => row[column] as SqlPrimitive);
    try {
      this.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
      return { inserted: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = this.db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(row[idColumn] as SqlPrimitive) as
        | Record<string, SqlPrimitive>
        | undefined;
      if (existing !== undefined && rowsEqual(existing, row)) {
        return { inserted: false, reason: 'duplicate' };
      }
      throw new StoreConflictError(table, String(row[idColumn]));
    }
  }

  // ---- Projects ---------------------------------------------------------

  /**
   * Persists a `CreativeProject`. Same immutable-fact-table posture as
   * every other insert method here — see schema.ts's V4 docstring for why
   * `projects` is insert-once rather than mutable.
   */
  insertProject(project: CreativeProject, storedAt: string): InsertResult {
    return this.insertFactRow('projects', 'id', projectToRow(project, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  getProject(projectId: ProjectId): CreativeProject | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
    return row === undefined ? undefined : rowToProject(row);
  }

  /** All projects, ordered by createdAt then rowid — same determinism rule as every other list method in this store. */
  listProjects(): CreativeProject[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY createdAt ASC, rowid ASC')
      .all() as unknown as ProjectRow[];
    return rows.map(rowToProject);
  }

  // ---- Devices --------------------------------------------------------

  /**
   * `publicKeySpkiDer` is the device's PUBLIC key only (SPKI DER) — never
   * pass private key material here. See tests/store/privateKeyBoundary.test.ts.
   */
  insertDevice(device: StudioDevice, publicKeySpkiDer: Buffer, storedAt: string): InsertResult {
    return this.insertFactRow('devices', 'id', deviceToRow(device, publicKeySpkiDer, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  revokeDevice(deviceId: DeviceId, revokedAt: string, storedAt: string): InsertResult {
    const row: DeviceRevocationRow = { deviceId, revokedAt, storedAt };
    return this.insertFactRow('device_revocations', 'deviceId', row as unknown as Record<string, SqlPrimitive>);
  }

  getDevice(deviceId: DeviceId): StudioDevice | undefined {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as DeviceRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const revocation = this.db.prepare('SELECT * FROM device_revocations WHERE deviceId = ?').get(deviceId) as
      | DeviceRevocationRow
      | undefined;
    return rowToDevice(row, revocation);
  }

  /** The device's stored PUBLIC key (SPKI DER) — for verifying signatures against, never for signing. */
  getDevicePublicKey(deviceId: DeviceId): Buffer | undefined {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as DeviceRow | undefined;
    return row === undefined ? undefined : rowToDevicePublicKeySpkiDer(row);
  }

  // ---- Sessions ---------------------------------------------------------

  insertSession(session: StudioSession, storedAt: string): InsertResult {
    return this.insertFactRow('sessions', 'id', sessionToRow(session, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  endSession(sessionId: SessionId, endedAt: string, status: 'ended' | 'abandoned', storedAt: string): InsertResult {
    const row: SessionEndRow = { sessionId, endedAt, status, storedAt };
    return this.insertFactRow('session_ends', 'sessionId', row as unknown as Record<string, SqlPrimitive>);
  }

  getSession(sessionId: SessionId): StudioSession | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const end = this.db.prepare('SELECT * FROM session_ends WHERE sessionId = ?').get(sessionId) as
      | SessionEndRow
      | undefined;
    return rowToSession(row, end);
  }

  /**
   * All of a project's sessions, ordered by startedAt then id. Added for
   * Evidence Bundle Export V1 (`src/evidence`), which needs to enumerate a
   * project's sessions to scope events/batches to it — no other consumer
   * needed this query before now. Uses the existing `idx_sessions_project`
   * index; not a store redesign, one narrow read method.
   */
  listSessionsForProject(projectId: ProjectId): StudioSession[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE projectId = ? ORDER BY startedAt ASC, rowid ASC')
      .all(projectId) as unknown as SessionRow[];
    return rows.map((row) => {
      const end = this.db.prepare('SELECT * FROM session_ends WHERE sessionId = ?').get(row.id) as
        | SessionEndRow
        | undefined;
      return rowToSession(row, end);
    });
  }

  // ---- Events -------------------------------------------------------------

  insertEvent(event: ProvenanceEvent, storedAt: string): InsertResult {
    return this.insertFactRow('events', 'eventId', eventToRow(event, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  getEvent(eventId: EventId): ProvenanceEvent | undefined {
    const row = this.db.prepare('SELECT * FROM events WHERE eventId = ?').get(eventId) as EventRow | undefined;
    return row === undefined ? undefined : rowToEvent(row);
  }

  /** Ordered by occurredAt (the device-claimed provenance timeline), rowid as a deterministic tiebreaker. */
  listEventsForSession(sessionId: SessionId): ProvenanceEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE sessionId = ? ORDER BY occurredAt ASC, rowid ASC')
      .all(sessionId) as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  // ---- Checkpoints --------------------------------------------------------

  insertCheckpoint(checkpoint: ProvenanceCheckpoint, storedAt: string): InsertResult {
    return this.insertFactRow('checkpoints', 'id', checkpointToRow(checkpoint, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  getCheckpoint(checkpointId: CheckpointId): ProvenanceCheckpoint | undefined {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as
      | CheckpointRow
      | undefined;
    return row === undefined ? undefined : rowToCheckpoint(row);
  }

  /** Ordered by sequence — the checkpoint chain's own canonical order. */
  listCheckpointsForProject(projectId: ProjectId): ProvenanceCheckpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints WHERE projectId = ? ORDER BY sequence ASC')
      .all(projectId) as unknown as CheckpointRow[];
    return rows.map(rowToCheckpoint);
  }

  /**
   * Readback integrity check: loads the project's stored checkpoints and
   * hands them to the existing `validateCheckpointChain` — this store
   * never reimplements chain/hash validation itself.
   */
  verifyCheckpointChainForProject(projectId: ProjectId): CheckpointChainValidationResult {
    return validateCheckpointChain(this.listCheckpointsForProject(projectId));
  }

  // ---- Batches --------------------------------------------------------------

  /**
   * Persists a batch's immutable signed fields and its initial
   * `validationStatus` atomically. If a batch with this id already exists
   * with different immutable content, throws `StoreConflictError` and
   * writes nothing (the validation-state write never runs).
   */
  insertBatch(batch: ProvenanceBatch, storedAt: string): InsertResult {
    return withTransaction(this.db, () => this.insertBatchWithinTransaction(batch, storedAt));
  }

  /**
   * The non-transaction-wrapping core of `insertBatch`, so
   * `insertEvidenceBundle` (which wraps its own, larger transaction) can
   * call it directly instead of nesting a second `withTransaction` call —
   * `withTransaction` does not support nesting (see its docstring).
   */
  private insertBatchWithinTransaction(batch: ProvenanceBatch, storedAt: string): InsertResult {
    const result = this.insertFactRow('batches', 'id', batchToRow(batch, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
    this.upsertBatchValidationState(batch.id, batch.validationStatus, storedAt, storedAt);
    return result;
  }

  /**
   * `validationStatus` is local, downstream bookkeeping (see
   * schema.ts/batchSigning.ts) — genuinely mutable, isolated from the
   * immutable `batches` row. This is the only mutation-in-place operation
   * this store performs, and it never touches signed evidence.
   */
  setBatchValidationStatus(batchId: BatchId, validationStatus: BatchValidationStatus, statusAt: string, storedAt: string): void {
    this.upsertBatchValidationState(batchId, validationStatus, statusAt, storedAt);
  }

  private upsertBatchValidationState(
    batchId: BatchId,
    validationStatus: BatchValidationStatus,
    statusAt: string,
    storedAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO batch_validation_state (batchId, validationStatus, statusAt, storedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(batchId) DO UPDATE SET validationStatus = excluded.validationStatus, statusAt = excluded.statusAt, storedAt = excluded.storedAt`,
      )
      .run(batchId, validationStatus, statusAt, storedAt);
  }

  getBatch(batchId: BatchId): ProvenanceBatch | undefined {
    const row = this.db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as BatchRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const validationState = this.db.prepare('SELECT * FROM batch_validation_state WHERE batchId = ?').get(batchId) as
      | BatchValidationStateRow
      | undefined;
    return rowToBatch(row, validationState);
  }

  listBatchesForDevice(deviceId: DeviceId): ProvenanceBatch[] {
    const rows = this.db
      .prepare('SELECT * FROM batches WHERE deviceId = ? ORDER BY createdAt ASC, rowid ASC')
      .all(deviceId) as unknown as BatchRow[];
    return rows.map((row) => {
      const validationState = this.db
        .prepare('SELECT * FROM batch_validation_state WHERE batchId = ?')
        .get(row.id) as BatchValidationStateRow | undefined;
      return rowToBatch(row, validationState);
    });
  }

  listBatchesForSession(sessionId: SessionId): ProvenanceBatch[] {
    const rows = this.db
      .prepare('SELECT * FROM batches WHERE sessionId = ? ORDER BY createdAt ASC, rowid ASC')
      .all(sessionId) as unknown as BatchRow[];
    return rows.map((row) => {
      const validationState = this.db
        .prepare('SELECT * FROM batch_validation_state WHERE batchId = ?')
        .get(row.id) as BatchValidationStateRow | undefined;
      return rowToBatch(row, validationState);
    });
  }

  /**
   * Readback integrity check: reconstructs the stored batch and hands it,
   * unmodified, to the existing `verifySignedBatch` — this store never
   * reimplements signature verification. This is the operation the
   * signature round-trip invariant (a stored batch verifies identically
   * to how it verified before persistence) actually exercises.
   */
  verifyBatchSignature(batchId: BatchId, signerPublicKeySpkiDer: Buffer): BatchVerificationResult | undefined {
    const batch = this.getBatch(batchId);
    return batch === undefined ? undefined : verifySignedBatch(batch, signerPublicKeySpkiDer);
  }

  /** Convenience form of `verifyBatchSignature` using the signing device's own stored public key. */
  verifyBatchSignatureUsingStoredDeviceKey(batchId: BatchId): BatchVerificationResult | undefined {
    const batch = this.getBatch(batchId);
    if (batch === undefined) {
      return undefined;
    }
    const publicKey = this.getDevicePublicKey(batch.deviceId);
    return publicKey === undefined ? undefined : verifySignedBatch(batch, publicKey);
  }

  // ---- Contributor Claims ---------------------------------------------------

  /**
   * Persists an EXPLICIT contribution claim. This store never derives one
   * from session/event/device activity, and never calls this method on a
   * caller's behalf — a claim exists only because something explicitly
   * constructed a `ContributorReference` and explicitly asked for it to be
   * persisted. See `src/domain/contributorReference.ts`.
   *
   * Deliberately NOT part of `insertEvidenceBundle`'s atomic grouping: a
   * contribution claim is a separate kind of act from a session's captured
   * evidence (events/checkpoint/batch), and keeping it out of that
   * transaction group reinforces — structurally, not just by convention —
   * that activity capture can never implicitly produce a claim.
   */
  insertContributorReference(claim: ContributorReference, storedAt: string): InsertResult {
    return this.insertFactRow('contributor_references', 'id', contributorReferenceToRow(claim, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  getContributorReference(id: ContributionClaimId): ContributorReference | undefined {
    const row = this.db.prepare('SELECT * FROM contributor_references WHERE id = ?').get(id) as
      | ContributorReferenceRow
      | undefined;
    return row === undefined ? undefined : rowToContributorReference(row);
  }

  /** Ordered by claimedAt, rowid as a deterministic tiebreaker — same rule as every other project-scoped list method. */
  listContributorReferencesForProject(projectId: ProjectId): ContributorReference[] {
    const rows = this.db
      .prepare('SELECT * FROM contributor_references WHERE projectId = ? ORDER BY claimedAt ASC, rowid ASC')
      .all(projectId) as unknown as ContributorReferenceRow[];
    return rows.map(rowToContributorReference);
  }

  // ---- Project Assets ---------------------------------------------------------

  /**
   * Persists metadata about a known creative artifact — never raw media
   * bytes (see ARCHITECTURE.md's privacy principles; this table stores
   * fingerprints and structural metadata only, exactly like every other
   * fact table). `asset.createdByProfileId` is persisted as-is and is
   * never read by this method (or by anything downstream) as a
   * `ContributorReference` — see `src/domain/projectAsset.ts`'s own
   * docstring for that field's exact, deliberately narrow meaning. This
   * store never derives a `ProjectAsset` from session/event activity on a
   * caller's behalf, same posture as `insertContributorReference`.
   */
  insertProjectAsset(asset: ProjectAsset, storedAt: string): InsertResult {
    return this.insertFactRow('project_assets', 'id', projectAssetToRow(asset, storedAt) as unknown as Record<
      string,
      SqlPrimitive
    >);
  }

  getProjectAsset(id: AssetId): ProjectAsset | undefined {
    const row = this.db.prepare('SELECT * FROM project_assets WHERE id = ?').get(id) as
      | ProjectAssetRow
      | undefined;
    return row === undefined ? undefined : rowToProjectAsset(row);
  }

  /** Ordered by firstSeenAt, rowid as a deterministic tiebreaker — same rule as every other project-scoped list method (sessions/events/batches/contributor_references). */
  listProjectAssetsForProject(projectId: ProjectId): ProjectAsset[] {
    const rows = this.db
      .prepare('SELECT * FROM project_assets WHERE projectId = ? ORDER BY firstSeenAt ASC, rowid ASC')
      .all(projectId) as unknown as ProjectAssetRow[];
    return rows.map(rowToProjectAsset);
  }

  // ---- Atomic multi-record evidence assembly -------------------------------

  /**
   * Inserts a session, a set of events, and optionally a checkpoint,
   * batch, and/or asset, atomically: either everything durably persists,
   * or (on any failure — including a `StoreConflictError` partway through)
   * nothing does. No partial evidence bundle is ever left behind because a
   * caller crashed or threw halfway through a logical write.
   *
   * `session` and `asset` were added for Capture Studio V1's local write
   * path (session-start pairs a `StudioSession` with its own
   * `session_started` event; file ingestion pairs a `ProjectAsset` with
   * its own `asset_imported` event) — both are exactly the same kind of
   * "one logical write, several records" grouping `events`/`checkpoint`/
   * `batch` already were, just two more optional record kinds in the same
   * transaction. `session`, when present, is inserted FIRST (before
   * `events`), since `events.sessionId`/`project_assets.introducedBySessionId`
   * both reference it. `asset` is inserted LAST, after `batch`.
   *
   * Deliberately NOT extended to include a `ContributorReference` claim —
   * see `insertContributorReference`'s own docstring for why a claim stays
   * structurally outside this atomic grouping.
   */
  insertEvidenceBundle(bundle: {
    readonly session?: StudioSession;
    readonly events?: readonly ProvenanceEvent[];
    readonly checkpoint?: ProvenanceCheckpoint;
    readonly batch?: ProvenanceBatch;
    readonly asset?: ProjectAsset;
    readonly storedAt: string;
  }): void {
    withTransaction(this.db, () => {
      if (bundle.session !== undefined) {
        this.insertSession(bundle.session, bundle.storedAt);
      }
      for (const event of bundle.events ?? []) {
        this.insertEvent(event, bundle.storedAt);
      }
      if (bundle.checkpoint !== undefined) {
        this.insertCheckpoint(bundle.checkpoint, bundle.storedAt);
      }
      if (bundle.batch !== undefined) {
        this.insertBatchWithinTransaction(bundle.batch, bundle.storedAt);
      }
      if (bundle.asset !== undefined) {
        this.insertProjectAsset(bundle.asset, bundle.storedAt);
      }
    });
  }
}
