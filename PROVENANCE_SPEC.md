# Provenance Specification

This document is the canonical specification for FLOW Creative Capture's provenance model. Where this document and the code disagree, that is a bug — file it against whichever one is wrong, but do not assume the code is right by default.

## 1. Meaningful events, not surveillance

This is a fundamental product rule, not an implementation detail: **FLOW Creative Capture does not record every mouse click, knob movement, undo/redo, zoom, menu open, window move, tiny parameter tweak, or other meaningless UI action.**

The goal is evidence of *creative state and lineage*, not a surveillance log of DAW usage. Every canonical event type in `EVENT_TYPES` (`src/domain/enums.ts`) represents a meaningful transition: a session boundary, a project boundary, an asset coming into or out of existence, a track being created, a plugin chain changing in a way worth recording, an export, a checkpoint, a contributor being added, or a handoff. If a future DAW bridge is tempted to emit an event for something not on that list, the correct fix is to decide whether the list needs a new *meaningful* event type — not to smuggle high-frequency noise through an existing one.

## 2. The canonical provenance event

Every DAW bridge, Studio Companion action, and the simulator all produce **exactly one event shape** — there is no per-source variant. This is `ProvenanceEvent` (`src/domain/provenanceEvent.ts`):

| Field | Meaning |
|---|---|
| `eventId` | Unique identifier for this event |
| `projectId` | The `CreativeProject` this event belongs to |
| `workReference` (optional) | Pointer to the upstream flow-platform Work Passport |
| `sessionId` | The `StudioSession` this event occurred within |
| `actorProfileId` | Who performed the action |
| `deviceId` | Which `StudioDevice` recorded it |
| `source` | Which system produced the event (see `EVENT_SOURCES`) |
| `eventType` | What kind of meaningful thing happened (see `EVENT_TYPES`) |
| `assetId` (optional) | The `ProjectAsset` involved, when applicable |
| `trackReference` (optional) | A DAW track identifier, for context |
| `occurredAt` | When it actually happened, per the device's own clock |
| `receivedAt` (optional) | When a server actually received it — never claimed to equal `occurredAt` for a delayed upload |
| `payload` | Event-type-specific structured data (must be canonicalizable — see §4) |

### Sources (`EVENT_SOURCES`)
`studio_simulator`, `flow_companion`, `logic_pro`, `fl_studio`, `ableton_live`, `pro_tools`, `studio_one`, `cubase`, `reaper`, `historical_import`. Every future DAW bridge adds exactly one value here and nowhere else.

### Event types (`EVENT_TYPES`)
`session_started`, `session_ended`, `project_opened`, `project_saved`, `track_created`, `asset_created`, `asset_imported`, `asset_modified`, `asset_removed`, `audio_recorded`, `midi_created`, `plugin_chain_changed`, `stem_exported`, `mix_exported`, `master_exported`, `checkpoint_created`, `contributor_added`, `handoff_created`, `handoff_accepted`, `final_master_designated`.

## 3. Provenance vs. contribution vs. final-use vs. rights

Four distinct concepts, deliberately kept structurally separate so one can never silently stand in for another:

1. **Creation provenance** — who created, recorded, imported, modified, exported, or handled material, and when. This is what `ProvenanceEvent` and `ProjectAsset` capture.
2. **Contribution verification** — evidence supporting a claim that a specific person performed a specific creative role. This is what `ContributorReference` (`src/domain/contributorReference.ts`) records — a signal, not a verified credit.
3. **Final-use verification** — evidence that a contribution actually made it into a final work/master/release. This is what `AssetRelationship` lineage plus `ReleaseCandidate` designation support (an asset's ancestors are traceable all the way to a designated master).
4. **Rights/ownership** — copyright, publishing, master ownership, licensing, work-for-hire, splits. This is `RightsClaimReference` (`src/domain/rightsClaimReference.ts`) — a **reference to a claim**, never a computed or inferred fact.

**Cryptographic provenance must never automatically be treated as legal ownership.** Nothing in this codebase derives a `RightsClaimReference`, a `verificationStatus`, or a `rightsStatus` from provenance data. `ProjectAsset.rightsStatus` is optional and is only ever set by an explicit caller — never defaulted, never inferred from `sourceType`, `originStatus`, or lineage. FLOW may eventually be able to say *"FLOW captured evidence consistent with this person creating this material"* — that is a materially weaker and different claim than *"this person legally owns this copyright,"* and the two must never be conflated in code, in UI copy, or in documentation.

## 4. Canonical serialization

Hashing is only meaningful if the same logical object always produces the same bytes to hash. `src/crypto/canonical.ts` defines the one canonical form:

- Object keys are sorted lexicographically, recursively.
- Arrays preserve semantic order — they are **never** sorted.
- Strings use standard JSON string escaping.
- Numbers must be finite; `-0` normalizes to `0`.
- `undefined`, `NaN`, `Infinity`, `bigint`, functions, symbols, `Date`/`Map`/`Set`/class instances, and anything else outside the plain JSON value universe are **rejected**, not silently coerced. Callers normalize explicitly (e.g. timestamps as ISO-8601 strings) before hashing.

`canonicalize(value)` is never bypassed by ad hoc `JSON.stringify` calls anywhere a hash is computed. `hashCanonicalValue` (`src/crypto/sha256.ts`) is `sha256(canonicalize(value))` and is the only sanctioned way to hash a domain object.

## 5. Hashing

All hashing is SHA-256, hex-encoded, lowercase. `src/crypto/sha256.ts` provides:

- `hashBytes` — raw bytes
- `hashString` — UTF-8 strings
- `hashCanonicalValue` — canonical objects (see §4)
- `isSha256Hex` — structural validity check (accepts either case on input; storage layers normalize to lowercase)

`ProjectAsset.sha256` is always stored lowercase regardless of input case, so two representations of the same logical hash never produce different manifest hashes downstream.

## 6. Checkpoint manifests

A `CheckpointManifest` (`src/provenance/manifest.ts`) summarizes *meaningful project state* at a point in time:

- the set of known assets, as `{ assetId, sha256, assetType }` triples, sorted by `assetId` for determinism
- the `eventId`s folded into this checkpoint since the previous one, in their original chronological order (never sorted — order is semantically part of what's attested to)

**A checkpoint manifest never embeds a whole DAW project file.** That would make checkpoints enormous and would hash volatile bytes (window layout, UI state) that carry no provenance meaning. `manifestHash = hashCanonicalValue(manifest)`.

## 7. Provenance checkpoints and the checkpoint chain

A `ProvenanceCheckpoint` (`src/domain/provenanceCheckpoint.ts`) is a tamper-evident snapshot. Its `checkpointHash` is derived from an explicit canonical structure — **never unsafe string concatenation**, which is ambiguous under truncation/reordering (e.g. `"ab" + "c" == "a" + "bc"`):

```
checkpointHash = hashCanonicalValue({
  manifestHash,
  previousCheckpointHash: previousCheckpointHash ?? null,
  sessionId,
  actorProfileId,
  createdAt,
})
```

(`src/provenance/checkpoint.ts::computeCheckpointHash`)

Checkpoints form a chain: the first checkpoint in a lineage has `sequence = 0` and no `previousCheckpointHash`; every subsequent checkpoint has `sequence = previous.sequence + 1` and `previousCheckpointHash = previous.checkpointHash`.

`validateCheckpointChain` (`src/provenance/checkpoint.ts`) checks three independent things for every checkpoint in sequence order:
1. Sequence numbers are contiguous starting at 0.
2. `previousCheckpointHash` matches the prior checkpoint's `checkpointHash` exactly.
3. Recomputing `checkpointHash` from the checkpoint's own stored fields (`manifestHash`, `previousCheckpointHash`, `sessionId`, `actorProfileId`, `createdAt`) matches the stored `checkpointHash`.

Check 3 is what catches tampering: if any single field on a checkpoint is altered after the fact without also recomputing `checkpointHash`, validation fails. This is exercised directly in `tests/provenance/checkpoint.test.ts` and against the full Cold Nights scenario in `tests/simulator/coldNights.test.ts`.

Checkpoint triggers (`CHECKPOINT_TRIGGER_TYPES`): `manual`, `project_save`, `session_end`, `recording_batch`, `major_import`, `export`, `handoff`, `final_mix`, `final_master`.

## 8. Asset lineage

`AssetRelationship` (`src/domain/assetRelationship.ts`) is a directed edge: `fromAssetId` (earlier/input asset) → `toAssetId` (later/output asset), labeled with a `relationshipType`:

`derived_from`, `edited_from`, `exported_from`, `mixed_into`, `mastered_from`, `contains`, `replaced_by`.

Direction is always "earlier feeds later" regardless of how the relationship label reads in English (e.g. `guitar_take_07 --edited_from--> guitar_comp` means the take is the earlier/from asset and the comp is the later/to asset, even though "comp is edited_from take" is the more natural sentence). This uniform direction is what lets `src/provenance/lineage.ts` traverse ancestors and descendants with one consistent algorithm instead of per-relationship-type direction logic.

This is what lets FLOW eventually represent chains like:

```
guitar_take_07.wav → guitar_comp.wav → guitar_stem.wav → final_mix.wav → final_master.wav
```

`getAncestorAssetIds` / `getDescendantAssetIds` / `isAncestorOf` support exactly this: proving a final master's lineage traces back through every asset that fed it, which is the foundation final-use verification is built on.

Legitimate lineage is a DAG — an asset can never be its own ancestor. `createAssetRelationship` rejects the trivial single-edge cycle (`fromAssetId === toAssetId`), but a longer cycle (`A -> B -> C -> A`) can still be assembled from three otherwise-valid edges, so it cannot be caught at single-edge construction time. Traversal stays safe regardless: `getAncestorAssetIds`/`getDescendantAssetIds` track visited nodes and expand each node at most once, so a cyclic graph can never cause an infinite loop — it terminates deterministically in O(V+E), and a corrupted cycle shows up in the result itself (an asset appears in its own ancestor/descendant set). Callers that need to reject cyclic lineage outright rather than merely surviving it should call `detectLineageCycle`, which runs a DFS with an explicit recursion stack and returns the concrete cycle path, or `null` for a valid DAG. See `tests/provenance/lineage.test.ts` ("asset lineage — cycle safety") for the regression coverage.

## 9. Provenance batches (offline capture)

A `ProvenanceBatch` (`src/domain/provenanceBatch.ts`, `src/provenance/batch.ts`) is the unit of offline capture: work offline → record local provenance → build a batch from the accumulated events → (eventually) sign it → upload when connectivity returns → server validates.

- `firstEventAt` / `lastEventAt` are derived from the batched events' own `occurredAt` values, in the order they were captured (never reordered — `computeBatchManifestHash` hashes them in original order).
- Batches chain the same way checkpoints do, but through `manifestHash`: batch *N*'s `previousBatchHash` must equal batch *N-1*'s `manifestHash`. `validateBatchChain` checks this.
- **A delayed upload is never allowed to pretend it was received live.** `occurredAt` and `receivedAt` are always kept distinct; nothing in this codebase collapses them.

## 10. Append-oriented evidence

Once evidence becomes authoritative, this codebase's data model never:
- silently rewrites a historical event,
- silently replaces a stored hash,
- or deletes inconvenient history to make the record look cleaner.

Corrections are represented as new, appended facts:
- **correction events** — a new `ProvenanceEvent` that supersedes an earlier claim,
- **superseding records** — e.g. `supersedeReleaseCandidate` (`src/domain/releaseCandidate.ts`) marks a prior master superseded; it never deletes or mutates the original record, so "Master v1" and "Master v2" both remain independently identifiable,
- **status changes** — e.g. a `ProjectHandoff` moving from `pending` to `declined`/`revoked`, or a `RightsClaimReference.verificationStatus` moving to `disputed`,
- **audit history** — the full sequence of checkpoints/batches/events is the audit trail; nothing summarizes it away.

Every domain factory in `src/domain` returns a frozen (`Object.freeze`) object specifically so accidental in-place mutation is caught immediately (including by tests) rather than silently corrupting the append-only record.

## 11. Contributor roles

`ContributionRole` and its per-role `subrole` vocabulary (`src/domain/roles.ts`) are controlled — not free text. A `subrole` is validated against `SUBROLES_BY_ROLE[role]`; an invalid pairing (e.g. `musician` + `lyrics`) is rejected at construction. A separate, non-canonical `description` field is available for free text, but it never substitutes for a canonical role/subrole pair — code must never parse `description` to infer a role.

## 12. Determinism requirement

Provenance, checkpoint, and hashing logic must never read the wall clock (`Date.now()`, bare `new Date()`) — every timestamp is a parameter. This is enforced by an ESLint rule (`no-restricted-globals` on `Date`) scoped to everything except the simulator and tests, where a deterministic, seedable clock (`src/simulator/clock.ts`) stands in for real time. The Cold Nights golden scenario is fully reproducible: the same seed timestamp always produces the same checkpoint hashes and the same asset fingerprints (see `tests/simulator/coldNights.test.ts`, "is deterministic given the same seed timestamp").
