# Architecture

## Data flow

```
Studio Companion                                                    [PARTIAL — src/device]
      │  (authenticated local session, device identity)
      ▼
  DAW Bridge                                                        [FUTURE]
      │  (translates native DAW activity into canonical ProvenanceEvents)
      ▼
Provenance Engine                                                   [IMPLEMENTED — src/provenance]
      │  (validates events, builds manifests, cuts checkpoints, tracks lineage)
      ▼
Local Evidence Store                                                [IMPLEMENTED — src/store]
      │  (append-oriented: devices, sessions, events, checkpoints, batches)
      ▼
 Trust Evaluation                                                   [IMPLEMENTED — src/trust]
      │  (side-effect-free: signature, structure, device-trust dimensions -> claimStatus)
      ▼
 Evidence Bundle                                                    [IMPLEMENTED — src/evidence]
      │  (deterministic, integrity-hashed, project-scoped export + trust snapshots)
      ▼
 Project Dossier -> Delivery Package                                [IMPLEMENTED — src/documents]
      │  (see "Document Architecture" below for the full 4-concept model)
      ▼
   Sync Client                                                      [CONTRACT ONLY — src/sync/contracts.ts]
      │  (bundles + signs evidence, uploads when connectivity returns; no transport yet)
      ▼
  FLOW Platform                                                     [FUTURE, EXTERNAL]
      (interprets evidence, makes verification decisions, issues Passport credentials)
```

This bootstrap implements the **Provenance Engine**, one piece of **Studio Companion** — local device identity and batch signing (`src/device`, added in `feature/local-evidence-device-signing`) — the **Local Evidence Store** (`src/store`, added in `feature/local-evidence-store-v1`), **Trust Evaluation** (`src/trust`, added in `feature/signed-batch-trust-enforcement`), **Evidence Bundle Export** (`src/evidence`, `feature/evidence-bundle-export-v1`), **Document Architecture** (`src/documents`, this batch), and type-only **Sync Client** contracts (including the Passport disclosure contract added this batch). The rest of **Studio Companion**, **DAW Bridge** implementations, and the real **Sync Client** transport are future work — see "Known limitations" in project history and `AGENTS.md`'s DAW Integration Agent / Sync-API Agent roles.

**Implementation status by piece**, since "future work" now covers pieces at different stages:

1. **Implemented — canonical provenance engine.** `src/crypto`, `src/domain`, `src/provenance`: canonical serialization, SHA-256 hashing, checkpoint/batch construction and chain validation, asset lineage. Fully tested, including the Cold Nights golden scenario.
2. **Implemented — local device-signing primitive.** `src/device`: Ed25519 device keypairs, public-key-derived fingerprints, `DeviceIdentity`, `ProvenanceBatch` signing/verification, local revocation/trust evaluation. See `SECURITY.md` for exactly what this does and does not prove.
3. **Development-grade only — key storage.** `FileDeviceKeyStore` (`src/device/keyStore.ts`) persists private key material to a local file; it is explicitly not OS-keychain-grade and must not be treated as production secret storage (see `SECURITY.md` "Key storage").
4. **Implemented — local evidence persistence.** `LocalEvidenceStore` (`src/store`) durably persists devices, sessions, provenance events, checkpoints, and signed batches to a local, append-only SQLite database (via Node's built-in `node:sqlite`). See "Local Evidence Store" below for the full design and `SECURITY.md` for exactly what durability does and does not add to the trust model.
5. **Implemented — trust evaluation.** `src/trust` evaluates a persisted batch's signature, structural (checkpoint-chain and batch-chain), and current-device-trust dimensions, side-effect-free, into a derived `claimStatus`. See "Trust Evaluation" below for the ceiling state's exact, deliberately narrow meaning.
6. **Implemented — Evidence Bundle Export V1.** `src/evidence` assembles a deterministic, project-scoped, integrity-hashed export of stored evidence plus frozen trust-evaluation snapshots. See "Evidence Bundle Export" below for its determinism, fail-closed, and private-key-boundary guarantees.
7. **Implemented — Document Architecture V1 (Project Dossier, Delivery Package).** `src/documents` derives a thin, human-readable `ProjectDossier` summary from one Evidence Bundle, and a recipient/purpose-specific `DeliveryPackage` view from a Dossier. See "Document Architecture" below for the full four-concept model (Evidence Bundle / Project Dossier / Delivery Package / Legal Agreement) and its privacy-by-default disclosure boundary.
8. **Contract only — Passport / selective disclosure.** `src/sync/contracts.ts`'s `DisclosureRequest`/`DisclosureResponse` pin down the shape a future FLOW Platform Passport-verification request/response would take — a `DisclosureResponse` is exactly a `DeliveryPackage` built with `audience: 'flow_passport_verification'`. No request handling, authentication, or transport exists.
9. **Documented boundary only — Legal Agreements.** Never generated, inferred, or adjudicated by this repository at any layer. See "Legal Agreement boundary" below.
10. **Future — synchronization.** `src/sync/contracts.ts` types only; no transport exists.
11. **Future — FLOW Platform verification.** Entirely external to this repository; never invented here.

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

### Local Evidence Store (`src/store`)
Durable, append-oriented storage for devices, sessions, provenance events, checkpoints, and signed provenance batches. V1 deliberately does **not** persist assets, asset relationships, handoffs, or release candidates — those aren't required to reconstruct or re-verify captured evidence and remain a candidate for a future store version, not something built ahead of an actual need.

**Persistence engine: `node:sqlite` (Node's built-in, synchronous SQLite binding — `DatabaseSync`), not a native module like `better-sqlite3`.** This was a deliberate evaluation, not a default choice:
- Zero native dependency: no `node-gyp`, no prebuilt-binary fetch step, nothing that can fail differently across this repo's Node version, CI, Codespaces, and a future desktop shell's bundled Node.
- Fully typed: `@types/node` already ships `DatabaseSync`'s types; no `@types` gap to paper over.
- Supports everything V1 needs: multi-statement DDL, triggers that reject `UPDATE`/`DELETE`, prepared statements, manual `BEGIN`/`COMMIT`/`ROLLBACK` transactions, `PRAGMA foreign_keys`, and WAL mode — all verified directly against this Node version before committing to the choice.
- The real cost: `node:sqlite` is still an experimental Node API, and — because experimental builtins are deliberately excluded from `module.builtinModules` — this repo's build tooling (Vite, under `vitest run`) cannot statically resolve a plain `import { DatabaseSync } from 'node:sqlite'`. `src/store/database.ts` loads it via `createRequire` instead, which reaches Node's real module loader directly; every other file only ever imports the `DatabaseSync` *type* (erased at compile time, so it carries none of the resolution risk). This also required raising this repo's Node floor from `>=20` to `>=22.5.0` (`package.json` `engines`, and `.github/workflows/ci.yml`'s `node-version`).

**Schema (see `src/store/schema.ts` for the full DDL and rationale in its module docstring):**
- IMMUTABLE FACT tables — `devices`, `device_revocations`, `sessions`, `session_ends`, `events`, `checkpoints`, `batches` — each keyed by a `PRIMARY KEY` on the relevant domain id, written at most once per key, with `UPDATE`/`DELETE` forbidden via triggers. This is the append-only invariant (`PROVENANCE_SPEC.md` §10) enforced at the storage engine level, not just by application convention.
- `device_revocations` and `session_ends` are split out from `devices`/`sessions` rather than modeled as columns on them, because revocation and session-ending are exactly-once terminal transitions in the domain layer itself (`revokeStudioDevice` and `endStudioSession` both throw if the transition already happened) — modeling each as its own immutable fact table (present = transitioned, absent = not yet) means the original row is never touched again.
- `batches` intentionally has NO `validationStatus` column. That field is isolated in a separate, genuinely mutable `batch_validation_state` table (no anti-mutation triggers) — it's this evidence store's own local, downstream opinion about a batch, explicitly excluded from what the device's signature binds (see `src/device/batchSigning.ts`'s `BatchSigningPayload` docstring), so re-running local validation later never requires touching the immutable row that carries the actual signed fields.
- `schema_version` is a single mutable row tracking schema compatibility — genuinely operational metadata, not evidence.
- `devices.publicKeySpkiDer` stores a device's PUBLIC key (base64 SPKI DER) so a stored batch's signature can be independently re-verified after a reopen, without needing the live `DeviceIdentity` that originally signed it. The corresponding PRIVATE key is never persisted here — it remains solely under `FileDeviceKeyStore` (see "Private key boundary" in `SECURITY.md`).

**Hard invariant:** a `ProvenanceBatch` reconstructed from storage passes to `verifySignedBatch` and returns the exact same result as it did before persistence — no reordering, no normalized-away values, no altered timestamps, no changed null/undefined semantics. Row reconstruction always goes back through the existing domain factories (`createStudioDevice`, `createProvenanceEvent`, `createProvenanceBatch`, ...), reusing their structural validation rather than duplicating it. Verification itself is never reimplemented in SQL — `LocalEvidenceStore.verifyCheckpointChainForProject`/`verifyBatchSignature*` are thin readback helpers that hand stored data to the same `validateCheckpointChain`/`verifySignedBatch` the rest of the codebase uses. **The store persists; the provenance engine validates — these stay separate.**

**Duplicate/idempotency policy:** re-inserting byte-identical content for an id that already exists in a fact table is a safe no-op; re-inserting *different* content for an existing id throws `StoreConflictError` and never overwrites the original. This is one uniform policy applied to every fact table, not special-cased per entity.

**Transactions:** `LocalEvidenceStore.insertEvidenceBundle` wraps a set of events plus an optional checkpoint and batch in one `BEGIN`/`COMMIT`/`ROLLBACK` transaction — either the whole logical write lands, or none of it does. WAL mode is enabled unconditionally (a no-op for the `:memory:` databases tests use) so local reads aren't blocked by an in-progress write.

**Trust boundary:** this store persists evidence; it does not decide whether that evidence should be trusted. Storage success, checkpoint-chain structural validity, and signature cryptographic validity are three separate facts, and no insert method calls any verification automatically — a caller must explicitly ask for `verifyCheckpointChainForProject`/`verifyBatchSignature*`. See `SECURITY.md`.

### Trust Evaluation (`src/trust`)
Sits between the Local Evidence Store and any future Sync Client / Evidence Bundle Export. It is a **side-effect-free composition** over existing primitives — `verifySignedBatch`, `validateBatchChain`, `LocalEvidenceStore.verifyCheckpointChainForProject`, `isDeviceActive` — and never reimplements hashing, canonicalization, or chain/signature validation itself.

**Independent dimensions are authoritative; the rollup is derived convenience only.** `evaluateStoredBatchTrust(store, batchId)` returns a `BatchTrustEvaluation` with three dimensions computed unconditionally and independently every call:
- `signature: StoredBatchSignatureStatus` — four distinct states (`unsigned`, `valid`, `invalid`, `signer_unknown`), never a bare boolean and never `undefined` standing in for "couldn't check." `signer_unknown` (no public key on file for the claimed device) is diagnostically different from `invalid` (verification ran and failed) and from `unsigned` (no signature present at all) — all three are kept distinguishable.
- `structure: StoredBatchStructureStatus` — covers BOTH the batch's project's checkpoint-hash chain (via `verifyCheckpointChainForProject`) and this device's own batch-to-batch `previousBatchHash` chain (via `validateBatchChain`), scoped to exactly this device's batches up to and including the target batch — never the whole database, never batches created after the target. A break in either chain is preserved in full, not summarized into one opaque boolean.
- `deviceTrust: DeviceTrustStatus` — `deviceFound` and `currentlyTrusted` kept separate (an unknown device and a known-but-revoked device are different findings), plus `revokedAt` when applicable.

A single `claimStatus` (`unsigned | signature_invalid | signer_unknown | structure_invalid | device_untrusted | locally_sound_unverified_claim`) is derived by fixed priority — signer-unknown, then unsigned, then signature-invalid, then structure-invalid, then device-untrusted, then the ceiling state — for convenience display only; it never replaces the raw dimensions and is never itself persisted. `reasons: readonly BatchTrustReason[]` preserves every simultaneously-failing dimension (e.g. a batch can be both `structure_invalid` *and* carry `device_revoked` in its reasons at once) — the rollup naming one label never erases the others.

**Computed, never persisted.** Every dimension and the rollup are recomputed from current store state on every call. Nothing here writes to `batch_validation_state` (the store's own, separate downstream bookkeeping) or caches a `trusted` flag anywhere — there is no stale trust decision to go stale, by construction. Revoking a device after a batch was validly signed flips `deviceTrust.currentlyTrusted` and `claimStatus` on the *next* evaluation; it never rewrites `signature`, matching the non-retroactivity invariant `src/device/trust.ts` already established.

**The ceiling state is `locally_sound_unverified_claim`.** It means only: the persisted batch exists, its signature verifies against an on-file public key, both its checkpoint chain and its device's batch chain are structurally sound, and its signing device is not currently revoked — all according to what *this local store* currently believes. It does **not** mean the underlying creative claim is factually true, that any human identity or authorship is verified, that a contribution or final use is verified, that copyright or legal ownership is verified, or that FLOW Platform (or anyone else) has verified anything. See `PROVENANCE_SPEC.md` §3 and `SECURITY.md`.

### Evidence Bundle Export (`src/evidence`)
Sits between Trust Evaluation and any future Sync Client / document system. `assembleEvidenceBundle(store, options)` is a **pure, read-only** assembly over `LocalEvidenceStore` + `evaluateStoredBatchTrust` — zero store writes, zero network calls, and it reimplements no hashing, canonicalization, signature, or chain logic of its own. Given a `projectId` and a caller-supplied `exportedAt` (never the wall clock — see PROVENANCE_SPEC.md §12), it produces a JSON-safe `EvidenceBundleExport`: the project's sessions, events, checkpoints, and signed batches, the public metadata of every device that touched them, and a frozen `TrustEvaluationSnapshot` per batch, all under one SHA-256 `integrityManifest.canonicalHash` computed the same way every hash in this codebase is (`hashCanonicalValue`).

**What an Evidence Bundle is:** a deterministic, project-scoped, integrity-protected export of stored provenance/evidence plus frozen trust-evaluation results, as they exist in the local store at export time.

**What an Evidence Bundle is explicitly NOT:** a copyright registration, an ownership or authorship determination, legal clearance, a contract, a rights transfer, a finished professional dossier, or a Passport credential in itself. `TrustEvaluationSnapshot`'s ceiling state (`locally_sound_unverified_claim`) carries exactly the same narrow meaning here as it does in Trust Evaluation — see that section above and PROVENANCE_SPEC.md §3. An Evidence Bundle is **evidence infrastructure**; it is the underlying source material that the derived, audience-specific views below — Project Dossier, Delivery Package — are built from.

**Determinism.** Two calls against the same unchanged store state with the same `exportedAt` are byte-for-byte identical, including `integrityManifest.canonicalHash` — no hidden wall-clock reads, no unstable iteration order (sessions/events/batches are explicitly sorted by their own timestamp then id before hashing), no random ids.

**Non-curating, in the sense trust status already established.** A bundle never excludes evidence to make itself "look clean": an unsigned batch, a batch with an unknown signer, a structurally broken chain, or a revoked device's batch are all exported in full, with their true `TrustEvaluationSnapshot` attached. This module never invents a second trust system — it only ever reads what `evaluateStoredBatchTrust` already computed.

**Fail-closed on internal inconsistency, which is a different thing from untrustworthy evidence.** If in-scope evidence references a device this store cannot resolve to a public key, or if in-scope sessions disagree on `workReference`, assembly throws `EvidenceBundleAssemblyError` rather than silently omitting the affected entry or guessing which value is right. Untrustworthy evidence is still packaged (that is Trust Evaluation's job to flag, not this module's job to hide); internally inconsistent *export* state is refused outright, because a bundle produced from it could misrepresent what evidence actually exists.

**Private-key safe by construction.** The only device material this module ever reads is `LocalEvidenceStore.getDevicePublicKey` — never `FileDeviceKeyStore` or any private key. `tests/evidence/privateKeyBoundary.test.ts` proves no private key byte or its base64 form appears anywhere in an assembled bundle's serialized JSON, the same technique `tests/store/privateKeyBoundary.test.ts` already uses for the store itself.

**Documentation envelope, deliberately narrow.** `options.documentationProfile` (`'traditional' | 'ai_native' | 'hybrid'`) is a caller-declared label describing what kind of documentation this export is *for*, carried through as `EvidenceBundleDocumentationEnvelope { profile, registryVersion: 'music-v1' }` — nothing more. Requesting `'ai_native'` or `'hybrid'` never implies AI-generation provenance was actually captured: this evidence model has no generation-event shape and no prompt/model/tool metadata yet (`ProjectAsset.sourceType`'s `ai_generated`/`ai_assisted` values are the only AI-related vocabulary that exists today, and `ProjectAsset` itself is not even persisted by the Local Evidence Store — see above). The document subsystem this envelope is a placeholder for does not exist yet and is not built in this batch.

## Document Architecture (`src/documents`)

Four distinct concepts sit above the evidence layer, deliberately kept structurally separate — none is interchangeable with another, and none may be inferred from another:

```
Evidence Bundle            [IMPLEMENTED — src/evidence]
      │  (technical evidence/provenance package; the source of truth)
      ▼
Project Dossier            [IMPLEMENTED — src/documents/dossier.ts]
      │  (thin, human-readable summary derived from one Evidence Bundle)
      ▼
Delivery Package           [IMPLEMENTED — src/documents/deliveryPackage.ts]
      (recipient/purpose-specific selection of Dossier + evidence references)

Legal Agreement            [DOCUMENTED BOUNDARY ONLY — not built]
      (an actual contract/rights instrument; a wholly separate, external layer —
       see "Legal Agreement boundary" below)
```

And, as one specific use of Delivery Package rather than a fifth concept:

```
Selected Evidence / Disclosure     [IMPLEMENTED as a DeliveryPackage
      │                             built with audience: 'flow_passport_verification']
      ▼
Future FLOW Platform Verification  [FUTURE, EXTERNAL — never built here]
      │
      ▼
Future Passport Credential         [FUTURE, EXTERNAL — never built here]
```

Evidence/provenance may eventually *support* a legal claim, a contribution credit, or a Passport credential decision — it must never be *automatically represented as* one. This section exists to keep that line structural, not just conventional, exactly as PROVENANCE_SPEC.md §3 already does one layer down for provenance-vs-rights specifically.

### Project Dossier (`src/documents/dossier.ts`)
`buildProjectDossier(bundle, options)` is a **pure, read-only** derivation over one `EvidenceBundleExport` — it performs no store access, no network calls, and reimplements no hashing or trust logic. It deliberately does **not** become a second evidence database: it never re-embeds the bundle's own `sessions`/`events`/`checkpoints`/`batches` arrays, referencing the source bundle instead by `exportedAt` + `integrityManifest.canonicalHash`. What it does carry is aggregate and summary only:

- `participants` — one entry per distinct `actorProfileId` seen across the bundle's sessions/events (session count, event count, first/last activity), answering "who participated" in terms of the person who acted, not the device that recorded it.
- `activity` — project-wide counts (sessions, events, checkpoints, batches, devices) plus an activity date range.
- `trust` — a rollup of the bundle's own `TrustEvaluationSnapshot`s (`claimStatusCounts`, `allBatchesSound`) — never a new trust computation.
- `disclaimers` — fixed, deterministic notice text (`DOSSIER_UNVERIFIED_NOTICES`, `DOSSIER_NOT_CLAIMED_NOTICES`) stating plainly that nothing here is FLOW-verified, and that copyright/publishing/master-ownership/licensing/work-for-hire/AI-provenance-beyond-what-was-captured are never claimed. This is fixed text, not project-specific prose the module would have to get right on a case-by-case basis.
- `documentationProfile` — carried through unchanged from the bundle's own `documentation?.profile` when present; never invented if the bundle didn't set one.

Not present in V1, honestly: an assets/evidence inventory. The Local Evidence Store does not persist `ProjectAsset` (see "Local Evidence Store" above), so a dossier has no truthful source for "what assets exist" beyond bare `assetId` references on individual events — which are not aggregated here, to avoid inventing a second, incomplete asset index. This is added when a store version that actually persists assets exists, not before.

**Deterministic.** Given the same bundle and the same caller-supplied `generatedAt`, two calls produce a byte-for-byte identical dossier — no wall-clock reads, no unstable iteration order (participants sorted by `profileId`, timestamps sorted before taking min/max), no random ids.

### Delivery Package (`src/documents/deliveryPackage.ts`)
`buildDeliveryPackage(bundle, dossier, options)` assembles a recipient/purpose-specific **view**, never a second evidence source. Every field is copied from the `ProjectDossier`/`EvidenceBundleExport` it was given, filtered to exactly the sections `options.includeSections` requested; the underlying dossier and bundle are read, never written or reinterpreted.

- `audience` (`DELIVERY_PACKAGE_AUDIENCES`): collaborator, producer, artist, label, publisher, manager, attorney, distributor, sync_licensing_team, platform, archive, flow_passport_verification, other. A controlled vocabulary reserving the future recipient types without building any of their actual workflows yet.
- `purpose` (`DELIVERY_PACKAGE_PURPOSES`): review, verification, archival, licensing, legal_review, general_reference, other.
- `sections` (`DELIVERY_PACKAGE_SECTION_KEYS`): project, participants, activity, trustSummary, documentationProfile, evidenceReferences, disclaimers — each populated only when requested; `includedSections`/`omittedSections` list which, always in this fixed canonical order regardless of request order.
- `source`: explicit pointers to the source Evidence Bundle (`exportedAt` + `canonicalHash`) and source Project Dossier (`generatedAt` + `dossierVersion`) — never a copy of either in full.
- `integrityManifest`: a SHA-256 hash over the package's own content, computed with the same `hashCanonicalValue` every other hash in this codebase uses.

**Privacy by default.** `evidenceReferences` — the one section that reaches back into the raw bundle rather than just the dossier's summary — carries only `{kind, id, at}` per record: never a `ProvenanceEvent.payload`, an `assetId`/`trackReference`, a batch `signature`, or a device's public key. A recipient who genuinely needs to independently re-verify a signature or inspect an event's payload needs the full `EvidenceBundleExport` itself, through a separate, explicit channel — Delivery Package V1 does not carry that by default, on purpose.

**Fail-closed, never guesses.** An unrecognized `audience`/`purpose`/section key throws `DocumentAssemblyError` rather than silently defaulting. A `dossier` whose `sourceEvidenceBundle.canonicalHash` doesn't match the given `bundle.integrityManifest.canonicalHash` — i.e. a dossier not actually derived from this bundle — throws rather than assembling a package over mismatched sources.

**This is also the selective-disclosure vehicle for a future Passport flow**, not a separate mechanism: a Delivery Package built with `audience: 'flow_passport_verification'` IS the disclosed material `DisclosureResponse` (`src/sync/contracts.ts`) refers to. There is deliberately no second, competing "disclosure payload" type — see "Passport / selective disclosure" below.

### Legal Agreement boundary (documented only, not built)
A Legal Agreement — an actual contract or rights instrument — is a wholly separate, external layer. Creative Capture does not generate, template, or negotiate one, and this batch does not add a domain type for one: `RightsClaimReference.externalEvidenceReference` (already reference-only, per PROVENANCE_SPEC.md §3) remains the only place this repository can point at one, by opaque string reference, exactly as it already could before this batch. Nothing in `src/documents` computes, infers, or defaults any of: ownership, copyright, publishing rights, master ownership, royalty entitlement, work-for-hire status, licenses, assignments, or split acceptance, from provenance/dossier/delivery-package content. If a future batch needs a real typed pointer to an external agreement, that is a new, explicit, minimal addition when something actually requires it — not built ahead of that need.

### Sync Client (future, contracts only)
`src/sync/contracts.ts` defines `EvidenceBundle`, `SyncAcknowledgement`, and the `EvidenceSyncClient` interface — the *shape* of what will eventually be exchanged with `flow-platform`. It contains zero transport code and zero endpoint URLs, because those do not exist yet and must not be invented here.

**Passport / selective disclosure (contract only, added this batch).** `DisclosureRequest` (a `projectId` plus the `DeliveryPackageSectionKey`s being asked for) and `DisclosureResponse` (a type alias for `DeliveryPackage`) pin down the shape a future Passport-verification request/response would take. No request handling, authentication, or transport exists — these are types only, exactly like the rest of this file. **Critical rule, enforced by never building past this line:** Creative Capture does not issue a FLOW Passport credential and does not decide whether to grant a disclosure request; it only supplies evidence-derived material. Identity verification, contribution verification, policy interpretation, credential issuance/revocation, and Passport display rules remain entirely FLOW Platform's responsibility — see AGENTS.md's repository boundary.

### FLOW Platform (out of scope, external)
Owns accounts, organizations, Passport, Work Passport, Project Passport, Catalog Passport, verification decisions, contributor credentials, public credits, Wallet Passport, opportunities, events, reputation, and public presentation. Creative Capture never reaches into it and never fabricates its API surface.

## Trust boundaries

| Boundary | What crosses it | What must never cross it |
|---|---|---|
| DAW Bridge → Provenance Engine | Canonical `ProvenanceEvent`s only | Raw DAW-native data structures, unvalidated timestamps treated as authoritative |
| Provenance Engine → Local Evidence Store | Validated, hashed, chained records | Anything that bypasses checkpoint/manifest hashing |
| Local Evidence Store (internal) | Public device verification material (`publicKeySpkiDer`) | Private key material — never enters `src/store`; stays under `FileDeviceKeyStore` |
| Local Evidence Store → Trust Evaluation | Persisted batches/checkpoints/devices, read-only | Any write back to the store — `src/trust` never mutates `batch_validation_state` or anything else |
| Trust Evaluation → Evidence Bundle Export | A frozen `TrustEvaluationSnapshot` per batch (`claimStatus` of `locally_sound_unverified_claim` included, as-is) | Any claim that a snapshot means factual truth, verified authorship/contribution/final-use, or legal ownership — see `src/trust/batchTrust.ts` and `src/evidence/bundle.ts` |
| Evidence Bundle Export → Project Dossier | Read-only summarization (participants, activity counts, trust rollup) | Re-embedding the bundle's own record arrays as a second evidence store; any rights/ownership field — see `src/documents/dossier.ts` |
| Project Dossier → Delivery Package | Selected dossier sections, verbatim, plus redacted `{kind,id,at}` evidence references when requested | `ProvenanceEvent.payload`, batch `signature`, device public keys, or any section not explicitly requested — see `src/documents/deliveryPackage.ts` |
| Local Evidence Store / Evidence Bundle Export → Sync Client | An `EvidenceBundleExport` — sessions/events/checkpoints/batches, public device metadata, and trust snapshots, integrity-hashed (the Sync Client transport itself is still future) | Live/unbounded raw project files; private key material (never read by `src/evidence`, only public keys) |
| Delivery Package → FLOW Platform (disclosure, contract only) | A `DeliveryPackage` built with `audience: 'flow_passport_verification'` — exactly the sections it explicitly includes | The rest of the private Evidence Bundle/Dossier not selected; any claim that this constitutes FLOW verification or credential issuance — see `src/sync/contracts.ts`'s `DisclosureRequest`/`DisclosureResponse` |
| Sync Client → FLOW Platform | Evidence bundles | Any claim that Creative Capture itself grants a Passport credential or verifies rights |
| Anything in this repository → Legal Agreement | An opaque reference only (`RightsClaimReference.externalEvidenceReference`) | Ownership, copyright, publishing rights, master ownership, royalty entitlement, work-for-hire status, licenses, assignments, or split acceptance inferred from provenance/dossier/delivery-package content — see "Legal Agreement boundary" above |

A device or plugin producing events is **never** treated as fully trusted on its own — the eventual FLOW Platform server is the authoritative validator. This repository builds the evidence; it does not adjudicate it. See `SECURITY.md`.

## Offline operation

Every layer below Studio Companion is designed to function fully offline:
- Studio Sessions, events, assets, and checkpoints are all constructible without connectivity.
- `ProvenanceBatch` (`src/domain/provenanceBatch.ts`, `src/provenance/batch.ts`) exists specifically so a device can record locally, bundle, and upload later.
- `LocalEvidenceStore` (`src/store`) persists all of this to a local file with zero network access of any kind — `node:sqlite` is a local, in-process database engine, not a client to anything.
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
