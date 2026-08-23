# Architecture

## Data flow

```
Studio Companion
      │  (authenticated local session, device identity)
      ▼
  DAW Bridge
      │  (translates native DAW activity into canonical ProvenanceEvents)
      ▼
Provenance Engine
      │  (validates events, builds manifests, cuts checkpoints, tracks lineage)
      ▼
Local Evidence Store
      │  (append-oriented: events, checkpoints, batches, assets, relationships)
      ▼
   Sync Client
      │  (bundles + signs evidence, uploads when connectivity returns)
      ▼
  FLOW Platform
      (interprets evidence, makes verification decisions, issues Passport credentials)
```

This bootstrap implements the **Provenance Engine**, plus one piece of **Studio Companion** — local device identity and batch signing (`src/device`, added in `feature/local-evidence-device-signing`) — and type-only **Sync Client** contracts. The **Local Evidence Store** has a proposed schema (`src/store/schema.ts`) but no wired persistence yet. The rest of **Studio Companion**, **DAW Bridge** implementations, and the real **Sync Client** transport are future work — see "Known limitations" in project history and `AGENTS.md`'s DAW Integration Agent / Sync-API Agent roles.

**Implementation status by piece**, since "future work" now covers pieces at different stages:

1. **Implemented — canonical provenance engine.** `src/crypto`, `src/domain`, `src/provenance`: canonical serialization, SHA-256 hashing, checkpoint/batch construction and chain validation, asset lineage. Fully tested, including the Cold Nights golden scenario.
2. **Implemented — local device-signing primitive.** `src/device`: Ed25519 device keypairs, public-key-derived fingerprints, `DeviceIdentity`, `ProvenanceBatch` signing/verification, local revocation/trust evaluation. See `SECURITY.md` for exactly what this does and does not prove.
3. **Development-grade only — key storage.** `FileDeviceKeyStore` (`src/device/keyStore.ts`) persists private key material to a local file; it is explicitly not OS-keychain-grade and must not be treated as production secret storage (see `SECURITY.md` "Key storage").
4. **Proposed, unwired — local evidence persistence.** `src/store/schema.ts` defines an append-only SQL schema (UPDATE/DELETE forbidden via triggers) for the eventual Local Evidence Store. No database engine is wired to it, and no code reads or writes through it yet — it is a schema definition only, not a persistence layer.
5. **Future — synchronization.** `src/sync/contracts.ts` types only; no transport exists.
6. **Future — FLOW Platform verification.** Entirely external to this repository; never invented here.

## Responsibilities by layer

### Studio Companion (partially implemented)
The authenticated local application a creator runs alongside their DAW. Owns local device identity, session lifecycle, and offline queuing.

- **Implemented:** local device identity as a device-generated Ed25519 keypair (`src/device/keypair.ts`), bound to a `deviceId` via `DeviceIdentity` (`src/device/identity.ts`), with `deviceKeyFingerprint` derived from the public key alone — never hardware serials or MAC addresses (see `StudioDevice` in `src/domain/studioDevice.ts`). Batch-level signing/verification (`src/device/batchSigning.ts`) and local revocation/trust evaluation (`src/device/trust.ts`, `revokeStudioDevice`) also exist.
- **Not implemented:** the authenticated application itself, session lifecycle management, offline queuing, and event-level (as opposed to batch-level) signing.

### DAW Bridge (future)
One adapter per DAW (Logic Pro, FL Studio, Ableton Live, Pro Tools, Studio One, Cubase, Reaper, ...). Each bridge's only job is to translate that DAW's native activity into the canonical `ProvenanceEvent` contract (`src/domain/provenanceEvent.ts`) — no DAW-specific event shape is allowed to leak past this layer. None of these bridges exist yet; `EVENT_SOURCES` in `src/domain/enums.ts` already reserves a slot for each.

### Provenance Engine (`src/provenance`)
The trust-sensitive core, and the only place that:
- builds checkpoint manifests and derives checkpoint hashes (`checkpoint.ts`, `manifest.ts`)
- validates checkpoint chains and detects tampering (`checkpoint.ts`)
- traces asset lineage — ancestors/descendants across `AssetRelationship` edges (`lineage.ts`)
- builds and validates offline provenance batches (`batch.ts`)
- performs structural/policy validation on individual events (`events.ts`)

It depends only on `src/domain` (data shapes) and `src/crypto` (hashing). It has no knowledge of any specific DAW, and no network access.

### Local Evidence Store (proposed schema, unwired)
Durable, append-oriented storage for devices, sessions, events, checkpoints, batches, assets, and relationships. This bootstrap still models these as in-memory domain objects at runtime (see the simulator). `src/store/schema.ts` proposes a SQL schema for this layer — fact tables keyed on domain id, lifecycle tables tracking state transitions as new rows, and `UPDATE`/`DELETE` forbidden at the trigger level so the append-oriented invariant is enforced by the storage engine itself, not just convention. **No database engine is wired to this schema and no code reads or writes through it** — it exists purely as a reviewable schema definition ahead of the real persistence layer, which remains future work per `AGENTS.md`'s "smallest coherent" principle. Whatever the real implementation becomes, it must preserve the append-oriented invariant described in `PROVENANCE_SPEC.md`.

### Sync Client (future, contracts only)
`src/sync/contracts.ts` defines `EvidenceBundle`, `SyncAcknowledgement`, and the `EvidenceSyncClient` interface — the *shape* of what will eventually be exchanged with `flow-platform`. It contains zero transport code and zero endpoint URLs, because those do not exist yet and must not be invented here.

### FLOW Platform (out of scope, external)
Owns accounts, organizations, Passport, Work Passport, Project Passport, Catalog Passport, verification decisions, contributor credentials, public credits, Wallet Passport, opportunities, events, reputation, and public presentation. Creative Capture never reaches into it and never fabricates its API surface.

## Trust boundaries

| Boundary | What crosses it | What must never cross it |
|---|---|---|
| DAW Bridge → Provenance Engine | Canonical `ProvenanceEvent`s only | Raw DAW-native data structures, unvalidated timestamps treated as authoritative |
| Provenance Engine → Local Evidence Store | Validated, hashed, chained records | Anything that bypasses checkpoint/manifest hashing |
| Local Evidence Store → Sync Client | Batches, signable today via `src/device` (the Sync Client transport itself is still future) | Live/unbounded raw project files |
| Sync Client → FLOW Platform | Evidence bundles | Any claim that Creative Capture itself grants a Passport credential or verifies rights |

A device or plugin producing events is **never** treated as fully trusted on its own — the eventual FLOW Platform server is the authoritative validator. This repository builds the evidence; it does not adjudicate it. See `SECURITY.md`.

## Offline operation

Every layer below Studio Companion is designed to function fully offline:
- Studio Sessions, events, assets, and checkpoints are all constructible without connectivity.
- `ProvenanceBatch` (`src/domain/provenanceBatch.ts`, `src/provenance/batch.ts`) exists specifically so a device can record locally, bundle, and upload later.
- `occurredAt` (when something actually happened) and `receivedAt` (when a server actually saw it) are distinct fields everywhere they matter — a delayed upload is never allowed to claim it happened live. `createProvenanceEvent` enforces `receivedAt >= occurredAt` at construction time.

## Synchronization (future)

The intended flow is: work offline → record local provenance → cut a checkpoint → bundle events into a `ProvenanceBatch` → sign the batch → upload when connectivity returns → server independently re-validates before acceptance. Batch signing/verification is implemented today (`src/device/batchSigning.ts` — see `SECURITY.md` for exactly what it does and does not prove); everything from "upload" onward is not: only the type contracts exist (`src/sync/contracts.ts`), with no transport, retry, conflict-resolution, or server-side re-validation logic built.

## Future native integrations

AU, VST3, AAX, and Max for Live bridges are explicitly out of scope for this bootstrap. When they arrive, each is expected to be a thin adapter that calls into the same canonical domain/provenance contracts already defined here — the contracts are the point of this repository existing before any plugin code does.

## Privacy principles

- Raw creative files (audio, MIDI, DAW projects) are private by default; only fingerprints (SHA-256) and structural metadata are part of the evidence graph modeled here.
- Checkpoint manifests summarize state (asset IDs, hashes, types, and the event IDs folded in) — they never embed whole multi-gigabyte project files.
- Device identity is a device-generated Ed25519 keypair (`src/device/keypair.ts`); `deviceKeyFingerprint` is a SHA-256 digest of the public key alone — never a hardware serial number, MAC address, or other invasive identifier.
- Synchronization is intended to be least-privilege: a device should be able to submit its own evidence without being able to read anyone else's.
