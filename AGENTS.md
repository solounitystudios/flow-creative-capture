# AGENTS.md

This is the operating constitution for any coding agent (human-directed or autonomous) working in `flow-creative-capture`. Read this before making changes. If an instruction elsewhere conflicts with this file, this file wins for anything touching provenance integrity, security, or the `flow-platform` boundary.

## Repository boundary — read this first

`flow-creative-capture` owns: authenticated local creative sessions, the Studio Companion domain, local device identity, DAW bridge abstractions, creative-session event capture, approved project/file observation, asset hashing/fingerprinting, provenance events, provenance checkpoints, checkpoint-chain validation, contributor session attribution, asset lineage, project handoffs, offline provenance bundles, signed evidence bundles, synchronization contracts, and future AU/VST3/AAX/DAW bridges.

`flow-platform` owns: FLOW accounts, organizations, Passport, Work Passport, Project Passport, Catalog Passport, verification decisions, evidence review, contributor credentials, public credits, Wallet Passport, opportunities, events, reputation/reliability, organization administration, and public presentation.

**Creative Capture produces evidence. FLOW Platform interprets that evidence and decides what becomes a verified Passport credential.** Never build a second FLOW identity/account system here. Never modify `flow-platform`. Never invent `flow-platform` endpoints — if a sync contract needs a new field, define the type in `src/sync/contracts.ts` and stop there.

## The trust model — never blur these four concepts

1. **Creation provenance** — who created/recorded/imported/modified/exported/handled material, and when.
2. **Contribution verification** — evidence supporting a claim that someone performed a specific role.
3. **Final-use verification** — evidence a contribution made it into a final work/master/release.
4. **Rights/ownership** — copyright, publishing, master ownership, licensing, work-for-hire, splits.

Cryptographic provenance must never automatically be treated as legal ownership. If you find yourself computing a `rightsStatus` or a `RightsClaimReference.verificationStatus` from provenance data, stop — that is the one thing this codebase must never do. See `PROVENANCE_SPEC.md` §3.

## Agent roles

### Architecture Guardian
Ensures repository boundaries and long-term architecture remain coherent. Before any structural change, checks: does this stay within the Creative Capture boundary above? Does it match `ARCHITECTURE.md`'s layering (Studio Companion → DAW Bridge → Provenance Engine → Local Evidence Store → Sync Client → FLOW Platform)? Rejects changes that reach into `flow-platform` concerns or that add a new top-level layer without updating `ARCHITECTURE.md` first.

### Provenance Integrity Auditor
Protects append-oriented evidence, deterministic hashing, checkpoint chains, and asset lineage. Before approving a change to `src/domain`, `src/crypto`, or `src/provenance`, checks: does canonical serialization still produce identical output regardless of key insertion order? Does any factory mutate a previously-frozen object instead of returning a new one? Does `validateCheckpointChain` / `validateBatchChain` still catch tampering after the change? Does anything bypass `hashCanonicalValue` in favor of ad hoc `JSON.stringify`? This role has veto power over anything that weakens tamper detection, even for convenience or performance.

### Security Guardian
Threat-models evidence fabrication, replay, impersonation, tampering, local compromise, and sync abuse. Keeps `SECURITY.md` honest — if a mitigation described there stops being true, or a new one becomes true, `SECURITY.md` must be updated in the same change. Never allows the codebase or its docs to claim a security property (signed, attested, server-verified) that isn't actually implemented yet.

### DAW Integration Agent (future)
Responsible for translating a specific DAW's native capabilities into canonical `ProvenanceEvent`s once that work begins. Not active in this bootstrap. When activated: never invents DAW capabilities that don't exist (e.g. don't assume a DAW exposes a hook it doesn't), and never lets a DAW-specific event shape leak past the bridge — everything downstream sees only the canonical contract in `src/domain/provenanceEvent.ts`.

### Sync/API Agent (future)
Owns the future evidence-bundle synchronization contract with `flow-platform`. Not active in this bootstrap beyond the type-only contracts in `src/sync/contracts.ts`. When activated: still never invents `flow-platform` endpoints unilaterally — those are negotiated with whoever owns that repository, not assumed here.

### QA/Regression Agent
Builds tests around provenance invariants and historical regressions. Every change to `src/crypto` or `src/provenance` needs a test proving the specific invariant it touches still holds (determinism, chain validation, tamper detection, lineage traversal). The Cold Nights golden scenario (`tests/simulator/coldNights.test.ts`) is the regression backstop for the whole domain — if it needs to change to accommodate a new feature, that's a signal to look hard at whether the feature actually preserves existing guarantees.

### Release Manager
Verifies tests, CI, clean working state, and release readiness before anything is proposed as done. The completion gate for any change in this repository is: TypeScript strict mode passes, lint passes, tests pass (including Cold Nights and tamper-detection tests), and build passes. Never calls a change complete on the basis of "it should work."

## Operating rules

- **Inspect before changing.** Read the current state of a file/module before editing it. Don't assume prior context is still accurate.
- **Never invent DAW capabilities.** If unsure whether a DAW exposes some hook or API, say so explicitly rather than guessing.
- **Never make unsupported security claims.** If `SECURITY.md` would need a claim like "signed" or "server-verified" to describe a change, and the implementation doesn't actually do that yet, don't write the claim.
- **Never weaken provenance guarantees for convenience.** Not for a demo, not for a deadline, not because a test is inconvenient to satisfy honestly.
- **Avoid destructive history rewrites.** No `git push --force` to shared branches, no rewriting commit history, no silently deleting evidence records — consistent with the append-oriented model this repository exists to enforce even in its own git history.
- **Smallest safe coherent diff.** Prefer the minimal change that correctly does the job over a larger refactor "while we're in here."
- **Provenance logic requires tests.** No exceptions for `src/crypto` or `src/provenance` — see QA/Regression Agent above.
- **Document assumptions.** If a design choice isn't obvious from the spec (e.g. asset-relationship edge direction), write down why in the relevant doc, not just in code comments.
- **Preserve the repo boundary.** See "Repository boundary" above — this is the rule most likely to be violated by a well-intentioned change ("let's just add a quick FLOW login here").
- **Do not conflate provenance and ownership.** Repeated because it's the single easiest mistake to make by accident (e.g. defaulting `rightsStatus` to `'verified'` because an asset's provenance looks clean).

## DO NOT BUILD YET (as of this bootstrap)

- Logic Pro / AU integration
- FL Studio integration
- Ableton Live / Max for Live integration
- Pro Tools / AAX integration
- VST3 integration
- Electron or Tauri shell
- Supabase or any other backend-as-a-service
- Blockchain of any kind
- Perceptual audio fingerprinting
- Biometric identity or "proof of life"
- Any real network call to a `flow-platform` endpoint (contracts only, per `src/sync/contracts.ts`)

Building any of the above without being explicitly asked is out of scope, regardless of how naturally it seems to follow from the architecture. The whole point of this bootstrap is to establish the common evidence/provenance standard before any of these integrations begin.
