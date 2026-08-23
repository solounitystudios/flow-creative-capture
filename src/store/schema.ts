/**
 * Local Evidence Store — schema version 1.
 *
 * This is a REVISION of the earlier untracked draft of this file, made
 * during the Local Evidence Store V1 batch. It is not the original draft
 * committed unchanged — the table set and the append-only/mutable split
 * below were re-derived from the actual domain code (see rationale below),
 * not carried over by default.
 *
 * V1 persists exactly the objects needed to reconstruct and independently
 * re-verify locally captured evidence: devices, sessions, provenance
 * events, checkpoints, and signed provenance batches. It does NOT persist
 * assets, asset relationships, handoffs, or release candidates — those
 * are not required to satisfy this batch's hard invariant (a persisted,
 * reopened batch verifies identically to how it verified before
 * persistence) and adding them now would be building ahead of an actual
 * need. They remain a candidate for a future store version.
 *
 * ## Table shapes
 *
 * IMMUTABLE FACT tables (`devices`, `device_revocations`, `sessions`,
 * `session_ends`, `events`, `checkpoints`, `batches`) have a PRIMARY KEY on
 * the domain id (or, for the two "_ends"/"_revocations" side tables, on the
 * id of the fact they attach to) and are written at most once per key.
 * `UPDATE`/`DELETE` are forbidden on all of them via triggers — this is the
 * append-only invariant enforced at the storage engine level, per
 * PROVENANCE_SPEC.md §10, not just by application convention.
 *
 * `device_revocations` and `session_ends` are split out from `devices` and
 * `sessions` rather than modeled as columns on those tables, because they
 * are exactly-once terminal transitions in the domain layer itself:
 * `revokeStudioDevice` throws if the device is already revoked, and
 * `endStudioSession` throws if the session has already ended. Modeling
 * each transition as its own immutable fact table (present = transitioned,
 * absent = not yet) means the original identity/session-start row is
 * never touched again, while still capturing the transition as a durable,
 * tamper-evident fact rather than an in-place edit.
 *
 * `batches` intentionally does NOT have a `validationStatus` column — see
 * `batch_validation_state` below.
 *
 * MUTABLE operational tables (`schema_version`, `batch_validation_state`)
 * have no anti-mutation triggers and are updated in place. Both are
 * downstream/local bookkeeping, never signed evidence:
 * - `schema_version` is store lifecycle metadata (see database.ts).
 * - `batch_validation_state` is local reassessment of a batch's
 *   `validationStatus` (`src/domain/provenanceBatch.ts`) — explicitly
 *   excluded from the device's signed payload
 *   (`src/device/batchSigning.ts`'s `BatchSigningPayload` docstring) because
 *   it is this evidence store's own opinion about the batch, not something
 *   the device is attesting to. Isolating it in its own table means
 *   re-running local validation later never requires touching (or
 *   re-writing) the immutable `batches` row that carries the actual signed
 *   fields.
 *
 * ## Verification material vs. private keys
 *
 * `devices.publicKeySpkiDer` stores a device's PUBLIC key (SPKI DER,
 * base64-encoded) so a batch's signature can be independently
 * re-verified after reopening the store, without needing the live
 * `DeviceIdentity` object that originally signed it. This is public
 * verification material. The corresponding PRIVATE key never appears
 * anywhere in this schema or in any table it defines — it remains solely
 * under `FileDeviceKeyStore` (`src/device/keyStore.ts`). See
 * `tests/store/privateKeyBoundary.test.ts` for the regression test
 * proving this.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export const SCHEMA_V1_DDL = `
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
