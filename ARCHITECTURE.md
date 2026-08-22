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

This bootstrap implements everything from **Provenance Engine** down through the **Local Evidence Store**, plus type-only **Sync Client** contracts. **Studio Companion**, **DAW Bridge** implementations, and the real **Sync Client** transport are future work — see "Known limitations" in project history and `AGENTS.md`'s DAW Integration Agent / Sync-API Agent roles.

## Responsibilities by layer

### Studio Companion (future)
The authenticated local application a creator runs alongside their DAW. Owns local device identity (a device-generated keypair, not hardware serials — see `StudioDevice` in `src/domain/studioDevice.ts`), session lifecycle, and offline queuing. Not implemented in this bootstrap.

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

### Local Evidence Store (future)
Durable, append-oriented storage for events, checkpoints, batches, assets, and relationships. This bootstrap models these as in-memory domain objects (see the simulator); a real persistence layer (likely SQLite or similar, per `AGENTS.md`'s "smallest coherent" principle) is future work. Whatever it becomes, it must preserve the append-oriented invariant described in `PROVENANCE_SPEC.md`.

### Sync Client (future, contracts only)
`src/sync/contracts.ts` defines `EvidenceBundle`, `SyncAcknowledgement`, and the `EvidenceSyncClient` interface — the *shape* of what will eventually be exchanged with `flow-platform`. It contains zero transport code and zero endpoint URLs, because those do not exist yet and must not be invented here.

### FLOW Platform (out of scope, external)
Owns accounts, organizations, Passport, Work Passport, Project Passport, Catalog Passport, verification decisions, contributor credentials, public credits, Wallet Passport, opportunities, events, reputation, and public presentation. Creative Capture never reaches into it and never fabricates its API surface.

## Trust boundaries

| Boundary | What crosses it | What must never cross it |
|---|---|---|
| DAW Bridge → Provenance Engine | Canonical `ProvenanceEvent`s only | Raw DAW-native data structures, unvalidated timestamps treated as authoritative |
| Provenance Engine → Local Evidence Store | Validated, hashed, chained records | Anything that bypasses checkpoint/manifest hashing |
| Local Evidence Store → Sync Client | Batches (signed, eventually) | Live/unbounded raw project files |
| Sync Client → FLOW Platform | Evidence bundles | Any claim that Creative Capture itself grants a Passport credential or verifies rights |

A device or plugin producing events is **never** treated as fully trusted on its own — the eventual FLOW Platform server is the authoritative validator. This repository builds the evidence; it does not adjudicate it. See `SECURITY.md`.

## Offline operation

Every layer below Studio Companion is designed to function fully offline:
- Studio Sessions, events, assets, and checkpoints are all constructible without connectivity.
- `ProvenanceBatch` (`src/domain/provenanceBatch.ts`, `src/provenance/batch.ts`) exists specifically so a device can record locally, bundle, and upload later.
- `occurredAt` (when something actually happened) and `receivedAt` (when a server actually saw it) are distinct fields everywhere they matter — a delayed upload is never allowed to claim it happened live. `createProvenanceEvent` enforces `receivedAt >= occurredAt` at construction time.

## Synchronization (future)

The intended flow is: work offline → record local provenance → cut a checkpoint → bundle events into a `ProvenanceBatch` → sign the bundle → upload when connectivity returns → server independently re-validates before acceptance. Only the type contracts for this exist today (`src/sync/contracts.ts`); no transport, retry, or conflict-resolution logic has been built.

## Future native integrations

AU, VST3, AAX, and Max for Live bridges are explicitly out of scope for this bootstrap. When they arrive, each is expected to be a thin adapter that calls into the same canonical domain/provenance contracts already defined here — the contracts are the point of this repository existing before any plugin code does.

## Privacy principles

- Raw creative files (audio, MIDI, DAW projects) are private by default; only fingerprints (SHA-256) and structural metadata are part of the evidence graph modeled here.
- Checkpoint manifests summarize state (asset IDs, hashes, types, and the event IDs folded in) — they never embed whole multi-gigabyte project files.
- Device identity is a device-generated cryptographic fingerprint, not a hardware serial number or other invasive identifier.
- Synchronization is intended to be least-privilege: a device should be able to submit its own evidence without being able to read anyone else's.
