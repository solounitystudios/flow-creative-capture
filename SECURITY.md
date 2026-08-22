# Security

FLOW Creative Capture is **evidence infrastructure**. It may eventually be used to help establish the history of valuable creative works — that means integrity failures here are not ordinary bugs; they are the kind of failure that can wrongly credit or discredit a real person's creative work. This document threat-models the system on that basis. It does not claim protections that are not yet implemented.

## What this bootstrap actually provides today

- Deterministic canonical serialization and SHA-256 fingerprinting (`src/crypto`).
- Tamper-evident checkpoint chains: any single stored field altered without recomputing `checkpointHash` is detected by `validateCheckpointChain` (`src/provenance/checkpoint.ts`).
- Structural validation of provenance events and their ordering (`src/provenance/events.ts`).
- Append-oriented domain objects (frozen at construction) so accidental in-place mutation fails loudly.
- A clear, structural separation between provenance evidence and rights/ownership claims (see `PROVENANCE_SPEC.md` §3), so one cannot silently stand in for the other.

## What this bootstrap explicitly does NOT provide yet

- No cryptographic signing of events, checkpoints, or batches (`ProvenanceBatch.signature` is a typed placeholder field, not an implemented signature scheme).
- No device attestation beyond a `deviceKeyFingerprint` string — there is no key-generation, storage, or verification code yet.
- No server-side ingestion, authentication, or authorization — `src/sync/contracts.ts` is types only.
- No persistence layer, so no at-rest access control to threat-model yet.
- No DAW plugin code, so no plugin-sandboxing story yet.

Do not describe this bootstrap as "signed," "attested," or "server-verified" evidence in any downstream documentation until those pieces actually exist.

## Threat model

| Threat | Today's exposure | Mitigation status |
|---|---|---|
| Malicious or modified DAW plugin fabricates events | A future bridge is just a client — nothing here can stop it from lying about what happened locally | **Unmitigated by design at this layer.** The eventual FLOW Platform server must be the authoritative validator; a plugin/device is never trusted alone (see below). |
| Forged provenance events | Same as above — events are only as trustworthy as their source | Structural validation exists (`validateProvenanceEvent`); cryptographic origin-authentication does not yet. |
| Replayed events | An old, valid event resubmitted as if new | No idempotency/dedup logic exists yet. Future ingestion must treat `eventId` as an idempotency key. |
| Account sharing | Two people using one profile's credentials | Out of scope — FLOW Platform's account system, not this repo's. |
| Stolen session token | An attacker acting as a legitimate device/session | No token/session-auth code exists in this bootstrap to compromise yet; this is a concern for the future Studio Companion + sync client. |
| Device impersonation | A device claims a `deviceKeyFingerprint` it doesn't hold the key for | Unmitigated — no key possession is actually verified yet; `deviceKeyFingerprint` is currently just a string field. |
| Local clock manipulation | A device lies about `occurredAt` | Structurally unmitigable at this layer by definition — a compromised device controls its own clock. This is exactly why `receivedAt` exists as a separate, server-stamped field: the server's view of when it *received* something is the trustworthy anchor, not the device's claim about when it happened. |
| Modified project files / hash substitution | An asset's actual bytes differ from its claimed `sha256` | `isSha256Hex` only checks structural validity of the hash string, not that it matches real file bytes — computing and comparing the real hash is the caller's responsibility (a future Studio Companion / bridge concern). |
| Manipulated offline bundles | A batch is edited after capture, before upload | `validateBatchChain` catches broken batch-to-batch linkage; it does **not** yet verify a cryptographic signature over the batch, because none is implemented yet. |
| Compromised local evidence database | An attacker with local disk access rewrites history | No persistence layer exists yet to compromise. When one is built, it must preserve the append-oriented invariant (`PROVENANCE_SPEC.md` §10) and should make historical rows immutable at the storage layer, not just by convention. |
| Unauthorized contributor attribution | Someone attributes a contribution to a profile that isn't theirs | `ContributorReference` is a claim, not a verified credential — see `PROVENANCE_SPEC.md` §3. Verification is FLOW Platform's job, not this repo's. |
| Malicious project handoff | A handoff is fabricated to falsely establish a chain of custody | `ProjectHandoff` requires a real `checkpointId` + `manifestHash`; it cannot be accepted twice (`acceptProjectHandoff` throws on a non-`pending` handoff) and cannot have `acceptedAt` precede `sentAt`. It does not yet verify that the sender actually possessed the referenced checkpoint. |
| Sync endpoint abuse | Bulk/abusive submission once a real sync endpoint exists | Out of scope for this bootstrap — no endpoint exists. Must be addressed when `EvidenceSyncClient` gets a real implementation. |
| Evidence deletion | Something is removed from the record to hide history | No deletion operations exist in the domain layer — every mutation-shaped function (`endStudioSession`, `acceptProjectHandoff`, `supersedeReleaseCandidate`, ...) returns a new object; nothing removes a prior one. |
| Evidence reordering | Events/checkpoints presented out of their true order | `validateEventOrdering` flags non-monotonic `occurredAt` within a session; `validateCheckpointChain` enforces contiguous `sequence` numbers. |
| Duplicate event submission | The same event ingested twice | Not yet handled — future ingestion needs idempotent handling keyed on `eventId` (see "Replayed events" above). |
| Compromised signing key | A device's future signing key is stolen | No signing key infrastructure exists yet to compromise. When built, key rotation and revocation (note `StudioDevice.revokedAt` already exists as a field) must be designed before signing is relied upon for trust decisions. |

## Security principles

1. **Never trust a plugin/device alone.** Anything a DAW bridge or Studio Companion instance asserts is a claim, not a fact, until independently corroborated. This bootstrap's validation functions (`validateProvenanceEvent`, `validateCheckpointChain`, `validateBatchChain`) are necessary but not sufficient — they catch internal inconsistency, not external forgery.
2. **The future server is authoritative.** Client-side validation in this repository exists to keep honest clients honest and to catch accidental corruption early; it is not a substitute for server-side re-validation once a server exists.
3. **Identify devices cryptographically, without unnecessary hardware tracking.** `StudioDevice` deliberately has no serial-number or MAC-address field — identity is meant to be a device-generated keypair (`deviceKeyFingerprint`), not something that doubles as a hardware tracking vector.
4. **Signed bundles, eventually.** `ProvenanceBatch.signature` and `EvidenceBundle` already reserve the shape for this; the actual signing/verification implementation is future work and must not be assumed to exist before it does.
5. **Append-oriented evidence, always.** See `PROVENANCE_SPEC.md` §10. This is a security property, not just a style preference: an append-only history is what makes tamper *detection* (rather than silent tamper) possible at all.
6. **Immutable accepted hashes.** Once a `checkpointHash`, `manifestHash`, or asset `sha256` is accepted into the record, it is never recomputed or replaced in place — a changed input produces a new record, not a mutated old one.
7. **Idempotent ingestion, in the future.** Not implemented yet (see "Replayed events" / "Duplicate event submission" above) — flagged here so it is not forgotten when the real ingestion path is built.
8. **Raw creative files are private by default.** Only fingerprints and structural metadata belong in the evidence graph modeled here; full audio/MIDI/project bytes are not something this domain model transmits or stores.
9. **Least-privilege synchronization.** A device should eventually be able to submit its own evidence without being able to read or affect anyone else's — this is a design constraint for the future sync implementation, not something enforced by code that exists today.
10. **Provenance ≠ ownership.** Repeated from `PROVENANCE_SPEC.md` because it is also a security property: conflating the two would let cryptographic evidence be misrepresented as a legal conclusion it cannot support.

## Reporting

This is an early-stage private bootstrap repository. There is no public disclosure process yet; route any concerns through the same channel as other `flow-platform`/FLOW ecosystem engineering communication.
