import type { ProjectId } from '../domain/ids.js';
import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import type { ProvenanceEvent } from '../domain/provenanceEvent.js';
import type { DeliveryPackage, DeliveryPackageSectionKey } from '../documents/deliveryPackage.js';

/**
 * TYPE CONTRACTS ONLY. This module deliberately contains no network code,
 * no HTTP client, and no flow-platform endpoint URLs — those do not exist
 * yet and must not be invented here. It exists so that when the sync
 * client is built, the shape of what it sends/receives is already agreed
 * upon and reviewable independent of transport.
 *
 * An EvidenceBundle is the unit exchanged with flow-platform: a batch plus
 * everything needed to independently re-verify it before acceptance.
 *
 * NAMING NOTE: this predates, and is deliberately narrower than,
 * `EvidenceBundleExport` (`src/evidence/bundle.ts`) — one signed batch
 * plus its events/checkpoints, sized for a single offline-capture upload,
 * versus a whole project's evidence plus device metadata and trust
 * snapshots. The similar names are a known wart, not two views of the
 * same thing; kept as-is here rather than renamed to avoid rippling an
 * unrelated change through this batch. Do not add a third, differently
 * named "bundle" concept — extend one of these two.
 */
export interface EvidenceBundle {
  readonly batch: ProvenanceBatch;
  readonly events: readonly ProvenanceEvent[];
  readonly checkpoints: readonly ProvenanceCheckpoint[];
}

export type SyncAcceptanceStatus = 'accepted' | 'rejected' | 'partially_accepted';

/**
 * What a future server-side validator is expected to report back after
 * receiving a bundle. `rejectedEventIds` lets the server accept most of a
 * batch while flagging specific entries (e.g. a duplicate) without forcing
 * an all-or-nothing outcome.
 */
export interface SyncAcknowledgement {
  readonly bundleBatchId: ProvenanceBatch['id'];
  readonly status: SyncAcceptanceStatus;
  readonly rejectedEventIds: readonly ProvenanceEvent['eventId'][];
  readonly serverReceivedAt: string;
}

/**
 * The contract a sync client must satisfy, independent of how it talks to
 * flow-platform (HTTP, queue, etc.). No implementation is provided in this
 * bootstrap — this interface exists to pin the shape down for review.
 */
export interface EvidenceSyncClient {
  submitBundle(bundle: EvidenceBundle): Promise<SyncAcknowledgement>;
}

// --- Passport / selective disclosure (contract only) ------------------

/**
 * Reuses `DeliveryPackage`'s own section vocabulary rather than defining
 * a second, competing one — see `src/documents/deliveryPackage.ts` for
 * what each section actually contains, and what it deliberately never
 * carries (raw event payloads, signatures, device public keys, private
 * key material).
 */
export type DisclosureSectionKey = DeliveryPackageSectionKey;

/**
 * What a future FLOW Platform Passport-verification flow could ask this
 * repository to disclose ahead of a verification decision. TYPE ONLY: no
 * request handling, authentication, or transport exists here, and no
 * flow-platform endpoint is invented by this type existing. Creative
 * Capture never decides whether to grant a request, never verifies
 * identity or contribution, and never issues a Passport credential —
 * that responsibility stays entirely with FLOW Platform. See AGENTS.md's
 * repository boundary and PROVENANCE_SPEC.md §3.
 */
export interface DisclosureRequest {
  readonly projectId: ProjectId;
  readonly requestedSections: readonly DisclosureSectionKey[];
}

/**
 * The disclosed material itself is exactly a `DeliveryPackage` built with
 * `audience: 'flow_passport_verification'` — never a second, parallel
 * "Passport payload" shape. This alias exists only so a future
 * Passport-facing method signature has a self-documenting name to
 * reference, per PIPELINE:
 *
 *   Private Evidence -> Selected Disclosure -> FLOW Verification -> Passport Credential
 *
 * Everything left of "Selected Disclosure" (Local Evidence Store, Trust
 * Evaluation, Evidence Bundle Export, Project Dossier) stays under the
 * creator's control and is never assumed to leave it wholesale — only an
 * explicitly-built `DeliveryPackage`, with its own explicit
 * `includedSections`/`omittedSections`, is ever a disclosure candidate.
 * Everything right of it (verification, credential issuance/revocation,
 * Passport display rules) is FLOW Platform's responsibility, not this
 * repository's — see AGENTS.md.
 */
export type DisclosureResponse = DeliveryPackage;
