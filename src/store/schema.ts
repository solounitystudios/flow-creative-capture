/**
 * Local Evidence Store — schema version 3.
 *
 * V1 (the Local Evidence Store V1 batch) persisted exactly the objects
 * needed to reconstruct and independently re-verify locally captured
 * evidence: devices, sessions, provenance events, checkpoints, and signed
 * provenance batches. It did NOT persist assets, asset relationships,
 * handoffs, or release candidates — those were not required to satisfy
 * that batch's hard invariant and adding them then would have been
 * building ahead of an actual need. They remain a candidate for a future
 * store version.
 *
 * V2 (the Contributor Claims Persistence batch) adds exactly one new
 * table, `contributor_references`: EXPLICIT, self-reported "profileId
 * claims role on projectId" records — see
 * `src/domain/contributorReference.ts`. This is a different kind of
 * record from everything else in this schema: every other table captures
 * something a device/session automatically recorded; `contributor_references`
 * captures a deliberate declaration a caller must construct on purpose.
 * Nothing in this store (or in `src/evidence`/`src/documents`) ever
 * derives a contribution claim from session/event/device activity — see
 * that module's docstring.
 *
 * V3 (the ProjectAsset Persistence batch) adds exactly one new table,
 * `project_assets`: durable metadata about actual creative artifacts
 * (files, in effect) — see `src/domain/projectAsset.ts`. Same posture as
 * every other fact table: metadata and fingerprints only, never raw media
 * bytes (see ARCHITECTURE.md's privacy principles). `createdByProfileId`
 * is persisted as-is and remains a narrow, non-authoritative field (see
 * that domain type's own docstring) — it is never read by this store (or
 * by `src/evidence`/`src/documents`) as a `ContributorReference`, and
 * nothing here derives, infers, or auto-generates one from it.
 * `AssetRelationship` and `ReleaseCandidate` remain domain-only,
 * deliberately out of scope for this version — they are not required to
 * persist a single asset's own metadata, same "don't build ahead of an
 * actual need" reasoning V1 already applied to this table itself.
 *
 * **Backward compatibility.** This store has no migration engine (see
 * `database.ts`'s `UnsupportedSchemaVersionError` — an existing database
 * with a different schema version is always rejected outright, never
 * silently migrated or reinterpreted). Bumping `CURRENT_SCHEMA_VERSION`
 * from 2 to 3 for this table addition is therefore not optional, for the
 * exact same reason the 1-to-2 bump was not optional: a V2 database is
 * missing `project_assets` entirely, so opening it under V3 code without a
 * version bump would let it look "compatible" (same version number) while
 * actually being structurally different — exactly the silent-mismatch
 * failure mode this store's version check exists to prevent. With the
 * bump, a V2 database is safely rejected with `UnsupportedSchemaVersionError`
 * and left completely untouched, exactly like any other unsupported
 * version — see `tests/store/database.test.ts`'s "rejects a
 * pre-ProjectAsset (schema version 2) database safely" for the regression
 * proof.
 *
 * ## Table shapes
 *
 * IMMUTABLE FACT tables (`devices`, `device_revocations`, `sessions`,
 * `session_ends`, `events`, `checkpoints`, `batches`, `contributor_references`,
 * `project_assets`) have a PRIMARY KEY on the domain id (or, for the two
 * "_ends"/"_revocations" side tables, on the id of the fact they attach
 * to) and are written at most once per key. `UPDATE`/`DELETE` are
 * forbidden on all of them via triggers — this is the append-only
 * invariant enforced at the storage engine level, per PROVENANCE_SPEC.md
 * §10, not just by application convention.
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

export const CURRENT_SCHEMA_VERSION = 3;

export const SCHEMA_V3_DDL = `
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
