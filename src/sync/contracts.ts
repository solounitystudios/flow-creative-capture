import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import type { ProvenanceEvent } from '../domain/provenanceEvent.js';

/**
 * TYPE CONTRACTS ONLY. This module deliberately contains no network code,
 * no HTTP client, and no flow-platform endpoint URLs — those do not exist
 * yet and must not be invented here. It exists so that when the sync
 * client is built, the shape of what it sends/receives is already agreed
 * upon and reviewable independent of transport.
 *
 * An EvidenceBundle is the unit exchanged with flow-platform: a batch plus
 * everything needed to independently re-verify it before acceptance.
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
