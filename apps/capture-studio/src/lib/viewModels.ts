/**
 * Pure, read-only derivations over `coldNightsFixture`. No component ever
 * reaches into `fixture.bundle`/`fixture.dossier` directly for anything
 * beyond simple field access -- shaping/labeling logic lives here so it is
 * testable in isolation and so every view applies the same trust-language
 * rules consistently (see TRUST LANGUAGE section below).
 */
import type { StudioSession } from '../../../../src/domain/studioSession.js';
import type { ProvenanceEvent } from '../../../../src/domain/provenanceEvent.js';
import type { ProvenanceCheckpoint } from '../../../../src/domain/provenanceCheckpoint.js';
import type { ProvenanceBatch } from '../../../../src/domain/provenanceBatch.js';
import type { ContributorReference } from '../../../../src/domain/contributorReference.js';
import type { DossierAsset } from '../../../../src/documents/dossier.js';
import type { ClaimStatus, StoredBatchSignatureStatus } from '../../../../src/trust/batchTrust.js';
import type { ColdNightsFixture } from '../data/fixtureTypes.js';

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Title-cases a snake_case domain vocabulary value, e.g. "audio_recorded" -> "Audio recorded". */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function shortHash(sha256: string, length = 12): string {
  return sha256.slice(0, length);
}

export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/* ------------------------------------------------------------------ */
/* Activity feed -- each record type stays explicitly labeled, never   */
/* flattened into one generic "event" shape (event != asset != claim). */
/* ------------------------------------------------------------------ */

export type ActivityKind = 'session' | 'event' | 'checkpoint' | 'batch' | 'contributorClaim' | 'asset';

export interface ActivityEntry {
  readonly kind: ActivityKind;
  readonly id: string;
  readonly at: string;
  readonly title: string;
  readonly meta: string;
}

const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  session: 'Session',
  event: 'Provenance event',
  checkpoint: 'Checkpoint',
  batch: 'Signed batch',
  contributorClaim: 'Contributor claim',
  asset: 'Asset',
};

export function activityKindLabel(kind: ActivityKind): string {
  return ACTIVITY_KIND_LABEL[kind];
}

function sessionEntry(session: StudioSession): ActivityEntry {
  return {
    kind: 'session',
    id: session.id,
    at: session.startedAt,
    title: `Session started — ${humanize(session.daw)}`,
    meta: session.actorProfileId,
  };
}

function eventEntry(event: ProvenanceEvent): ActivityEntry {
  return {
    kind: 'event',
    id: event.eventId,
    at: event.occurredAt,
    title: humanize(event.eventType),
    meta: event.actorProfileId,
  };
}

function checkpointEntry(checkpoint: ProvenanceCheckpoint): ActivityEntry {
  return {
    kind: 'checkpoint',
    id: checkpoint.id,
    at: checkpoint.createdAt,
    title: `Checkpoint #${checkpoint.sequence} — ${humanize(checkpoint.triggerType)}`,
    meta: checkpoint.actorProfileId,
  };
}

function batchEntry(batch: ProvenanceBatch): ActivityEntry {
  return {
    kind: 'batch',
    id: batch.id,
    at: batch.createdAt,
    title: `${batch.eventCount} events signed`,
    meta: batch.profileId,
  };
}

function contributorClaimEntry(claim: ContributorReference): ActivityEntry {
  return {
    kind: 'contributorClaim',
    id: claim.id,
    at: claim.claimedAt,
    title: `${humanize(claim.role)}${claim.subrole !== undefined ? ` / ${humanize(claim.subrole)}` : ''} claimed`,
    meta: claim.profileId,
  };
}

function assetEntry(asset: DossierAsset): ActivityEntry {
  return {
    kind: 'asset',
    id: asset.id,
    at: asset.firstSeenAt,
    title: asset.originalFilename ?? asset.id,
    meta: humanize(asset.assetType),
  };
}

export function buildActivityFeed(fixture: ColdNightsFixture): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...fixture.bundle.sessions.map(sessionEntry),
    ...fixture.bundle.events.map(eventEntry),
    ...fixture.bundle.checkpoints.map(checkpointEntry),
    ...fixture.bundle.batches.map(batchEntry),
    ...fixture.bundle.contributorClaims.map(contributorClaimEntry),
    ...fixture.dossier.assetInventory.map(assetEntry),
  ];
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* Asset filters                                                       */
/* ------------------------------------------------------------------ */

export const ASSET_FILTERS = ['all', 'audio', 'midi', 'stem', 'mix', 'master'] as const;
export type AssetFilter = (typeof ASSET_FILTERS)[number];

export function filterAssets<T extends { readonly assetType: string }>(assets: readonly T[], filter: AssetFilter): T[] {
  if (filter === 'all') return [...assets];
  return assets.filter((asset) => asset.assetType === filter);
}

/* ------------------------------------------------------------------ */
/* Trust language -- precise labels only, never "verified".            */
/* Signed provenance != verified creative contribution (AGENTS.md).    */
/* ------------------------------------------------------------------ */

export type TrustTone = 'sound' | 'claim' | 'invalid' | 'neutral';

export function signatureStatusLabel(signature: StoredBatchSignatureStatus): { label: string; tone: TrustTone } {
  switch (signature.status) {
    case 'valid':
      return { label: 'Signature valid', tone: 'sound' };
    case 'invalid':
      return { label: 'Signature invalid', tone: 'invalid' };
    case 'unsigned':
      return { label: 'Unsigned', tone: 'neutral' };
    case 'signer_unknown':
      return { label: 'Signer unknown', tone: 'invalid' };
  }
}

export function claimStatusLabel(status: ClaimStatus): { label: string; tone: TrustTone } {
  switch (status) {
    case 'locally_sound_unverified_claim':
      return { label: 'Locally sound (unverified claim)', tone: 'sound' };
    case 'unsigned':
      return { label: 'Unsigned', tone: 'neutral' };
    case 'signature_invalid':
      return { label: 'Signature invalid', tone: 'invalid' };
    case 'signer_unknown':
      return { label: 'Signer unknown', tone: 'invalid' };
    case 'structure_invalid':
      return { label: 'Structure invalid', tone: 'invalid' };
    case 'device_untrusted':
      return { label: 'Device untrusted', tone: 'invalid' };
  }
}
