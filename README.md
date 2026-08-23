# FLOW Creative Capture

Provenance and evidence infrastructure for creative work — a subsystem of the larger **FLOW** ecosystem.

## What this is

FLOW Creative Capture is the layer that:

- captures authenticated creative sessions
- observes meaningful creation activity (not every click)
- fingerprints creative assets (SHA-256)
- preserves project/version history
- creates tamper-evident provenance checkpoints
- attributes contributions to creators
- records project handoffs between collaborators
- maintains asset lineage (what was derived from what)
- supports offline capture, batched and synced later
- will eventually generate signed evidence bundles for FLOW Platform

It is designed to be the common evidence standard that future DAW integrations (Logic Pro, FL Studio, Ableton Live, Pro Tools, Studio One, Cubase, Reaper, and others) all translate into — one canonical provenance event contract, regardless of source.

## What this is NOT

- **Not a standalone consumer app.** This repository is a subsystem of the FLOW ecosystem, not a product on its own.
- **Not a second identity system.** Accounts, organizations, Passports, and credentials belong to `flow-platform`. This repo only carries references (profile IDs, organization IDs, external Passport IDs) — it never mints its own notion of a FLOW identity.
- **Not a rights/ownership system.** Creative Capture produces *evidence*; it never adjudicates copyright, publishing splits, or legal ownership. See "Provenance vs. Ownership" below.
- **Not a DAW plugin, yet.** No Logic/AU, FL Studio, Ableton/Max for Live, Pro Tools/AAX, or VST3 integration exists in this bootstrap. Those come after the canonical event contract and evidence model are stable.
- **Not a surveillance tool.** It does not log every mouse click, undo, zoom, or menu open. It captures meaningful creative state and lineage — see `PROVENANCE_SPEC.md`.

## Relationship to FLOW Platform

```
Passport → Catalog Passport → Project Passport → Work Passport → Contribution → Studio Session → Checkpoint → Asset → Evidence Event
```

Creative Capture owns everything from **Studio Session** down. It produces structured, hash-verifiable evidence that gets attached upstream to a Work Passport and a contributor's Passport. `flow-platform` owns accounts, organizations, Passports, verification decisions, credentials, public credits, opportunities, and reputation. This repository never talks to `flow-platform` internals and never invents its endpoints — see `src/sync/contracts.ts` for the (currently unimplemented) shape of that boundary.

## Current stage

**Bootstrap.** This repository currently contains:

- a strongly typed provenance domain model (`src/domain`)
- deterministic canonical serialization + SHA-256 utilities (`src/crypto`)
- a provenance engine: checkpoint creation/chain validation, asset lineage, offline batches, event validation (`src/provenance`)
- local device identity and batch signing: Ed25519 device keypairs, `DeviceIdentity`, `ProvenanceBatch` signing/verification, local revocation (`src/device`)
- a durable Local Evidence Store: append-only, local persistence for devices, sessions, events, checkpoints, and signed batches, via `node:sqlite` (`src/store`)
- Trust Evaluation: a side-effect-free composition over the store and device-signing primitives that derives a persisted batch's signature/structure/device-trust posture (`src/trust`)
- Evidence Bundle Export V1: a deterministic, project-scoped, integrity-hashed export of stored evidence plus frozen trust-evaluation snapshots — evidence infrastructure only, never a rights or ownership determination (`src/evidence`)
- sync *contracts only* — types, no transport, no endpoints (`src/sync`)
- a CLI simulator that exercises the full domain via one golden scenario, "Cold Nights" (`src/simulator`)
- a full test suite including the Cold Nights golden test (`tests`)

No DAW bridge, no native plugin code, no Electron/Tauri shell, and no network client exist yet. That is deliberate — see `PROVENANCE_SPEC.md` and the "DO NOT BUILD YET" list understood by this repo's agents (`AGENTS.md`).

## Future DAW targets

Logic Pro, FL Studio, Ableton Live, Pro Tools, Studio One, Cubase, Reaper, and other compatible hosts. Each future bridge is expected to translate its native activity into the same canonical `ProvenanceEvent` contract defined in `src/domain/provenanceEvent.ts` — no DAW gets a bespoke event shape.

## Provenance vs. ownership

This is the most important distinction in the whole system, and it is enforced structurally, not just by convention:

- **Creation provenance** — evidence of who created, recorded, imported, modified, exported, or handled material, and when.
- **Contribution verification** — evidence supporting a claim that a specific person performed a specific creative role.
- **Final-use verification** — evidence that a contribution actually made it into a final work/master/release.
- **Rights/ownership** — copyright, publishing, master ownership, licensing, work-for-hire, splits.

Cryptographic provenance is never automatically treated as legal ownership. FLOW may eventually be able to say *"FLOW captured evidence consistent with this person creating this material"* — that is not equivalent to *"this person legally owns this copyright."* `RightsClaimReference` (`src/domain/rightsClaimReference.ts`) is a domain **reference** only; nothing in this codebase computes, infers, or verifies a rights claim from provenance data. See `PROVENANCE_SPEC.md`.

## Development principles

- Simple, deterministic, well-tested, documented, security-conscious, portable — over clever, huge, framework-heavy, or prematurely abstracted.
- Evidence history is append-oriented. Nothing here silently rewrites history, replaces a hash, or deletes inconvenient records — corrections are new events, not edits.
- No wall-clock reads inside domain/provenance/crypto logic — timestamps are always passed in explicitly, which is what keeps hashing and the simulator reproducible.
- This repository owns Studio Session and below. It does not reach into `flow-platform`, and it does not invent `flow-platform` endpoints.

## Development commands

```bash
npm install       # install dependencies
npm run typecheck # tsc --noEmit, strict mode
npm run lint      # eslint
npm test          # vitest run, includes the Cold Nights golden test
npm run build     # tsc -p tsconfig.json -> dist/
npm run simulate  # run the Cold Nights scenario via CLI and print a summary
```

## Repository layout

```
src/domain      strongly typed provenance domain model (CreativeProject, StudioSession, ProvenanceEvent, ...)
src/crypto      canonical serialization + SHA-256 hashing utilities
src/provenance  checkpoint/manifest construction, chain validation, asset lineage, batches, event validation
src/device      local device identity, Ed25519 keypairs, batch signing/verification, local revocation
src/store       Local Evidence Store — durable, append-only persistence (node:sqlite)
src/trust       Trust Evaluation — side-effect-free signature/structure/device-trust evaluation over the store
src/evidence    Evidence Bundle Export — deterministic, integrity-hashed, project-scoped evidence export
src/sync        type contracts for future evidence synchronization with flow-platform (no implementation yet)
src/simulator   the "Cold Nights" scenario generator + CLI runner
tests           unit tests plus the Cold Nights golden test
```

See `ARCHITECTURE.md` for the full data-flow diagram, `PROVENANCE_SPEC.md` for the canonical event/hashing/checkpoint specification, and `SECURITY.md` for the threat model. `AGENTS.md` is the operating constitution for any coding agent working in this repository.
