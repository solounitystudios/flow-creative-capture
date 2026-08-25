import type { AssetId, ContributionClaimId, ProfileId, SessionId } from '../domain/ids.js';
import type { AssetType, SourceType } from '../domain/enums.js';
import type { ContributionRole } from '../domain/roles.js';
import type { ClaimStatus } from '../trust/batchTrust.js';
import type {
  DocumentationProfile,
  EvidenceBundleExport,
  EvidenceBundleProject,
} from '../evidence/bundle.js';

/**
 * Project Dossier (`src/documents/dossier.ts`) sits directly above Evidence
 * Bundle Export: a THIN, human-readable summary derived from one
 * `EvidenceBundleExport`, never a second evidence store. It never
 * re-embeds the bundle's own sessions/events/checkpoints/batches arrays —
 * it references the bundle by `exportedAt` + `integrityManifest.canonicalHash`
 * and reports aggregate counts, participants, and trust posture instead.
 * A caller who needs the underlying records themselves still goes to the
 * `EvidenceBundleExport` (directly, or via a Delivery Package's
 * `evidenceReferences` section) — this module only ever summarizes.
 *
 * Pure and read-only: `buildProjectDossier` performs no store access, no
 * network calls, and reimplements no hashing/trust logic — every fact in
 * a dossier is read straight off the `EvidenceBundleExport` it was given.
 *
 * A dossier is NOT a rights, ownership, authorship, or legal-clearance
 * determination, and it is NOT a FLOW Platform verification or Passport
 * credential — see `disclaimers` below, ARCHITECTURE.md's "Project
 * Dossier" section, and PROVENANCE_SPEC.md §3.
 *
 * `participants` (activity-derived: who recorded sessions/events) and
 * `contributorClaims` (explicit, self-reported: who claims which role)
 * are DELIBERATELY SEPARATE sections built from two different bundle
 * arrays — see `DossierContributionClaim` below. Neither is derived from
 * the other: recording activity never manufactures a claim, and a claim
 * never requires matching activity to appear.
 *
 * `assetInventory` is a THIRD, equally separate section built only from
 * `bundle.assets` — see `DossierAsset` below. An asset's
 * `createdByProfileId`, when present, is presented as-is and is NEVER
 * read as, or used to manufacture, a `DossierContributionClaim`: knowing
 * who introduced a file is not the same fact as someone claiming a
 * creative role, and this module never conflates the two. No lineage
 * (`AssetRelationship` is domain-only, not yet persisted — see
 * `src/store/schema.ts`) and no rights/ownership field appears here.
 */

/**
 * Fixed, deterministic disclaimer text — never computed prose describing
 * a specific project's specific evidence, which this module refuses to
 * attempt (it would mean guessing at what a break in trust *means*,
 * something only a human or FLOW Platform should say). Exported as named
 * constants so callers/tests can assert on them without duplicating the
 * literal strings.
 */
export const DOSSIER_UNVERIFIED_NOTICES = [
  'No creation-provenance, contribution, or final-use claim in this dossier has been verified by FLOW Platform or any other external authority. See trust.claimStatusCounts for this local evidence store\'s own trust posture only.',
  'Device signatures and checkpoint/batch chains are evaluated against this local evidence store only; a valid local result is not proof of human identity, and does not become FLOW Platform verification by inclusion in this dossier.',
] as const;

export const DOSSIER_NOT_CLAIMED_NOTICES = [
  'This dossier does not claim, compute, or imply copyright, publishing, master ownership, licensing, work-for-hire status, or any other legal rights determination — see PROVENANCE_SPEC.md §3.',
  'This dossier does not claim that AI-generated or AI-assisted provenance was captured beyond what is explicitly present in the underlying evidence. documentationProfile (when set) is the requested documentation mode, not a record of evidence actually captured.',
] as const;

export interface ProjectDossierSourceRef {
  readonly exportedAt: string;
  readonly canonicalHash: string;
}

export interface DossierParticipant {
  readonly profileId: ProfileId;
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly firstActivityAt?: string;
  readonly lastActivityAt?: string;
}

/**
 * One EXPLICIT, self-reported contribution claim, presented for human
 * reading. This is a claim's own record — never something derived from
 * `DossierParticipant`/activity data, and never conflated with one: a
 * profile can appear in `participants` (it recorded sessions/events) with
 * zero entries here, or appear here (it claimed a role) with zero
 * recorded activity — either combination is valid and neither implies
 * the other. `projectId` is omitted since it is always this dossier's
 * own `project.projectId`, not a per-claim fact worth repeating.
 */
export interface DossierContributionClaim {
  readonly id: ContributionClaimId;
  readonly profileId: ProfileId;
  readonly role: ContributionRole;
  readonly subrole?: string;
  readonly description?: string;
  readonly claimedAt: string;
}

/**
 * One known creative artifact, presented for human reading. Built only
 * from `bundle.assets` (never `bundle.sessions`/`bundle.events`, same
 * isolation `buildContributionClaims` already applies) — activity data
 * cannot manufacture or alter an asset record. `sha256Prefix` is a
 * truncated, skimmable fingerprint (the first 12 hex characters of the
 * full digest) for a human-readable summary; a recipient needing the
 * full digest to independently re-verify content goes to the underlying
 * `EvidenceBundleExport.assets` record itself. `createdByProfileId` is
 * carried through exactly as `ProjectAsset` documents it — see that
 * type's own docstring — and is never treated as a contribution claim,
 * credit, or authorship determination here.
 */
export interface DossierAsset {
  readonly id: AssetId;
  readonly assetType: AssetType;
  readonly sourceType: SourceType;
  readonly originalFilename?: string;
  readonly firstSeenAt: string;
  readonly sha256Prefix: string;
  readonly introducedBySessionId: SessionId;
  readonly createdByProfileId?: ProfileId;
}

export interface DossierActivity {
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly checkpointCount: number;
  readonly batchCount: number;
  readonly deviceCount: number;
  readonly earliestActivityAt?: string;
  readonly latestActivityAt?: string;
}

/**
 * `claimStatusCounts` tallies the exact `ClaimStatus` values already
 * produced by `evaluateStoredBatchTrust` — never a new rollup. An empty
 * project (no batches) reports `batchCount: 0` and `allBatchesSound:
 * true` (vacuously — there is nothing unsound to report), which is the
 * truthful representation of "no trust claims exist here yet," not a
 * pass grade.
 */
export interface DossierTrustSummary {
  readonly batchCount: number;
  readonly claimStatusCounts: Readonly<Partial<Record<ClaimStatus, number>>>;
  readonly allBatchesSound: boolean;
}

export interface DossierDisclaimers {
  readonly unverified: readonly string[];
  readonly notClaimed: readonly string[];
}

export interface ProjectDossier {
  readonly dossierVersion: 1;
  readonly generatedAt: string;
  readonly sourceEvidenceBundle: ProjectDossierSourceRef;
  readonly project: EvidenceBundleProject;
  readonly documentationProfile?: DocumentationProfile;
  readonly participants: readonly DossierParticipant[];
  readonly contributorClaims: readonly DossierContributionClaim[];
  readonly assetInventory: readonly DossierAsset[];
  readonly activity: DossierActivity;
  readonly trust: DossierTrustSummary;
  readonly disclaimers: DossierDisclaimers;
}

export interface BuildProjectDossierOptions {
  /**
   * Required, not defaulted to the wall clock — same determinism rule as
   * `AssembleEvidenceBundleOptions.exportedAt` (PROVENANCE_SPEC.md §12).
   */
  readonly generatedAt: string;
}

function compareProfileIds(a: ProfileId, b: ProfileId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildParticipants(bundle: EvidenceBundleExport): DossierParticipant[] {
  const byProfile = new Map<ProfileId, { sessionCount: number; eventCount: number; timestamps: string[] }>();
  const entryFor = (profileId: ProfileId) => {
    let entry = byProfile.get(profileId);
    if (entry === undefined) {
      entry = { sessionCount: 0, eventCount: 0, timestamps: [] };
      byProfile.set(profileId, entry);
    }
    return entry;
  };

  for (const session of bundle.sessions) {
    const entry = entryFor(session.actorProfileId);
    entry.sessionCount += 1;
    entry.timestamps.push(session.startedAt);
    if (session.endedAt !== undefined) {
      entry.timestamps.push(session.endedAt);
    }
  }
  for (const event of bundle.events) {
    const entry = entryFor(event.actorProfileId);
    entry.eventCount += 1;
    entry.timestamps.push(event.occurredAt);
  }

  return [...byProfile.entries()]
    .map(([profileId, entry]) => {
      const sorted = [...entry.timestamps].sort();
      return {
        profileId,
        sessionCount: entry.sessionCount,
        eventCount: entry.eventCount,
        ...(sorted.length > 0 ? { firstActivityAt: sorted[0]!, lastActivityAt: sorted[sorted.length - 1]! } : {}),
      };
    })
    .sort((a, b) => compareProfileIds(a.profileId, b.profileId));
}

/**
 * Presents `bundle.contributorClaims` for human reading, re-sorted here
 * (claimedAt, then id as a deterministic tiebreaker) rather than trusting
 * the bundle's own ordering — the same defensive-determinism pattern
 * `buildParticipants`/`buildActivity` already use. Never reads
 * `bundle.sessions`/`bundle.events` — activity data cannot manufacture or
 * alter a claim.
 */
function buildContributionClaims(bundle: EvidenceBundleExport): DossierContributionClaim[] {
  return [...bundle.contributorClaims]
    .map((claim) => ({
      id: claim.id,
      profileId: claim.profileId,
      role: claim.role,
      ...(claim.subrole !== undefined ? { subrole: claim.subrole } : {}),
      ...(claim.description !== undefined ? { description: claim.description } : {}),
      claimedAt: claim.claimedAt,
    }))
    .sort((a, b) => (a.claimedAt !== b.claimedAt ? (a.claimedAt < b.claimedAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const SHA256_PREFIX_LENGTH = 12;

/**
 * Presents `bundle.assets` for human reading, re-sorted here (firstSeenAt,
 * then id as a deterministic tiebreaker) rather than trusting the
 * bundle's own ordering — the same defensive-determinism pattern
 * `buildContributionClaims`/`buildParticipants` already use. Never reads
 * `bundle.sessions`/`bundle.events`/`bundle.contributorClaims` — activity
 * and claim data cannot manufacture or alter an asset record, and an
 * asset record never manufactures a claim.
 */
function buildAssetInventory(bundle: EvidenceBundleExport): DossierAsset[] {
  return [...bundle.assets]
    .map((asset) => ({
      id: asset.id,
      assetType: asset.assetType,
      sourceType: asset.sourceType,
      ...(asset.originalFilename !== undefined ? { originalFilename: asset.originalFilename } : {}),
      firstSeenAt: asset.firstSeenAt,
      sha256Prefix: asset.sha256.slice(0, SHA256_PREFIX_LENGTH),
      introducedBySessionId: asset.introducedBySessionId,
      ...(asset.createdByProfileId !== undefined ? { createdByProfileId: asset.createdByProfileId } : {}),
    }))
    .sort((a, b) => (a.firstSeenAt !== b.firstSeenAt ? (a.firstSeenAt < b.firstSeenAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function buildActivity(bundle: EvidenceBundleExport): DossierActivity {
  const timestamps: string[] = [];
  for (const session of bundle.sessions) {
    timestamps.push(session.startedAt);
    if (session.endedAt !== undefined) {
      timestamps.push(session.endedAt);
    }
  }
  for (const event of bundle.events) {
    timestamps.push(event.occurredAt);
  }
  const sorted = [...timestamps].sort();
  const deviceCount = new Set([
    ...bundle.sessions.map((s) => s.deviceId),
    ...bundle.events.map((e) => e.deviceId),
    ...bundle.batches.map((b) => b.deviceId),
  ]).size;

  return {
    sessionCount: bundle.sessions.length,
    eventCount: bundle.events.length,
    checkpointCount: bundle.checkpoints.length,
    batchCount: bundle.batches.length,
    deviceCount,
    ...(sorted.length > 0 ? { earliestActivityAt: sorted[0]!, latestActivityAt: sorted[sorted.length - 1]! } : {}),
  };
}

function buildTrustSummary(bundle: EvidenceBundleExport): DossierTrustSummary {
  const claimStatusCounts: Partial<Record<ClaimStatus, number>> = {};
  for (const snapshot of bundle.trustEvaluationSnapshots) {
    claimStatusCounts[snapshot.claimStatus] = (claimStatusCounts[snapshot.claimStatus] ?? 0) + 1;
  }
  const allBatchesSound = bundle.trustEvaluationSnapshots.every(
    (snapshot) => snapshot.claimStatus === 'locally_sound_unverified_claim',
  );
  return { batchCount: bundle.batches.length, claimStatusCounts, allBatchesSound };
}

/**
 * Assembles a Project Dossier from an already-assembled `EvidenceBundleExport`.
 * Deterministic: given the same bundle (byte-for-byte, per its own
 * `integrityManifest.canonicalHash`) and the same `generatedAt`, two calls
 * produce structurally identical dossiers — no wall-clock reads, no
 * unstable iteration order (participants/activity timestamps are
 * explicitly sorted), no random ids.
 */
export function buildProjectDossier(bundle: EvidenceBundleExport, options: BuildProjectDossierOptions): ProjectDossier {
  return {
    dossierVersion: 1,
    generatedAt: options.generatedAt,
    sourceEvidenceBundle: {
      exportedAt: bundle.exportedAt,
      canonicalHash: bundle.integrityManifest.canonicalHash,
    },
    project: bundle.project,
    ...(bundle.documentation?.profile !== undefined ? { documentationProfile: bundle.documentation.profile } : {}),
    participants: buildParticipants(bundle),
    contributorClaims: buildContributionClaims(bundle),
    assetInventory: buildAssetInventory(bundle),
    activity: buildActivity(bundle),
    trust: buildTrustSummary(bundle),
    disclaimers: {
      unverified: DOSSIER_UNVERIFIED_NOTICES,
      notClaimed: DOSSIER_NOT_CLAIMED_NOTICES,
    },
  };
}
