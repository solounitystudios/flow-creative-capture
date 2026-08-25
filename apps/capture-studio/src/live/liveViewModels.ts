/**
 * Pure derivations over a live `ProjectSnapshot` (`studioClient.ts`) —
 * the live-mode counterpart to `../lib/viewModels.ts`'s fixture-based
 * `buildActivityFeed`. Kept separate rather than overloading the
 * existing fixture-shaped function: a `ProjectSnapshot` carries raw
 * `ProjectAsset[]` (no `sha256Prefix`, no dossier), not the fixture's
 * `DossierAsset[]` — different enough shapes that forcing one function
 * to accept either would blur, not clarify, the distinction. Formatting
 * helpers (`humanize`, `activityKindLabel`, ...) and the `ActivityEntry`
 * type itself are reused as-is from `../lib/viewModels.ts`.
 */
import type { StudioSession } from '../../../../src/domain/studioSession.js';
import type { ProvenanceEvent } from '../../../../src/domain/provenanceEvent.js';
import type { ProjectAsset } from '../../../../src/domain/projectAsset.js';
import type { ContributorReference } from '../../../../src/domain/contributorReference.js';
import { humanize, type ActivityEntry } from '../lib/viewModels.js';
import type { ProjectSnapshot } from './studioClient.js';

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

function contributorClaimEntry(claim: ContributorReference): ActivityEntry {
  return {
    kind: 'contributorClaim',
    id: claim.id,
    at: claim.claimedAt,
    title: `${humanize(claim.role)}${claim.subrole !== undefined ? ` / ${humanize(claim.subrole)}` : ''} claimed`,
    meta: claim.profileId,
  };
}

function assetEntry(asset: ProjectAsset): ActivityEntry {
  return {
    kind: 'asset',
    id: asset.id,
    at: asset.firstSeenAt,
    title: asset.originalFilename ?? asset.id,
    meta: humanize(asset.assetType),
  };
}

export function buildLiveActivityFeed(snapshot: ProjectSnapshot): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...snapshot.sessions.map(sessionEntry),
    ...snapshot.events.map(eventEntry),
    ...snapshot.contributorClaims.map(contributorClaimEntry),
    ...snapshot.assets.map(assetEntry),
  ];
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}
