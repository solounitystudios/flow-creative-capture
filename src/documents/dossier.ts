import type { ProfileId } from '../domain/ids.js';
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
    activity: buildActivity(bundle),
    trust: buildTrustSummary(bundle),
    disclaimers: {
      unverified: DOSSIER_UNVERIFIED_NOTICES,
      notClaimed: DOSSIER_NOT_CLAIMED_NOTICES,
    },
  };
}
