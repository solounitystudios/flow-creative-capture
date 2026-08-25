import type { JsonValue } from '../crypto/json.js';
import { hashCanonicalValue } from '../crypto/sha256.js';
import type { DeviceId, ProfileId, ProjectId, WorkReferenceId } from '../domain/ids.js';
import type { Platform } from '../domain/enums.js';
import type { StudioSession } from '../domain/studioSession.js';
import type { ProvenanceEvent } from '../domain/provenanceEvent.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import type { ProvenanceBatch } from '../domain/provenanceBatch.js';
import type { ContributorReference } from '../domain/contributorReference.js';
import type { ProjectAsset } from '../domain/projectAsset.js';
import { evaluateStoredBatchTrust, type BatchTrustEvaluation } from '../trust/batchTrust.js';
import type { LocalEvidenceStore } from '../store/evidenceStore.js';
import { EvidenceBundleAssemblyError } from './errors.js';

/**
 * Evidence Bundle Export (`src/evidence`) sits between Trust Evaluation and
 * any future Sync Client / documentation system. It is a PURE, READ-ONLY
 * assembly over `LocalEvidenceStore` + `evaluateStoredBatchTrust` — it
 * performs zero store writes, zero network calls, and reimplements no
 * hashing/canonicalization/signature/chain logic of its own. It builds a
 * portable, JSON-safe, integrity-hashed snapshot of one project's evidence
 * as it exists in the local store RIGHT NOW — nothing here decides
 * whether that evidence should be trusted, and nothing here adjudicates
 * ownership. See ARCHITECTURE.md's "Evidence Bundle Export" section and
 * SECURITY.md for the full trust-boundary statement this module exists
 * to preserve in code.
 */

/**
 * Deliberately narrower than a full `CreativeProject`: this store has no
 * `projects` table (see `ARCHITECTURE.md`'s Local Evidence Store section),
 * so there is no persisted `title`/`projectType`/`status` anywhere to
 * truthfully include. `workReference` is included only when every session
 * in scope agrees on the same value, or omitted if none set one; sessions
 * actively disagreeing fails assembly closed instead (see
 * `deriveProjectWorkReference` below) rather than guessing or omitting.
 */
export interface EvidenceBundleProject {
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
}

/**
 * PUBLIC verification material only. `publicKeySpkiDerBase64` is the
 * device's public key (never its private key — see
 * tests/evidence/privateKeyBoundary.test.ts). `verifiedAt`/`revokedAt`
 * are included when present on the underlying `StudioDevice`; there is no
 * `createdAt` here because `StudioDevice` itself has no such field and
 * this store does not expose a device's `storedAt` through its public
 * API — including one would mean inventing data that doesn't exist.
 */
export interface EvidenceBundleDevice {
  readonly deviceId: DeviceId;
  readonly profileId: ProfileId;
  readonly platform: Platform;
  readonly appVersion: string;
  readonly deviceKeyFingerprint: string;
  readonly publicKeySpkiDerBase64: string;
  readonly verifiedAt?: string;
  readonly revokedAt?: string;
}

/**
 * A FROZEN COPY of `evaluateStoredBatchTrust`'s output, captured AT
 * EXPORT TIME. This is historical export context, not a live or
 * persisted trust decision: `evaluateStoredBatchTrust` itself remains
 * entirely unmodified and is still recomputed fresh every time it is
 * called elsewhere. A later re-export of the same batch, after its
 * device is revoked (say), will produce a DIFFERENT snapshot with a
 * different `capturedAt` — the earlier snapshot is not rewritten, exactly
 * as no historical evidence record is ever rewritten elsewhere in this
 * codebase. It is NOT persisted live trust state, permanent device
 * trust, server verification, contribution verification, final-use
 * verification, or ownership verification.
 */
export interface TrustEvaluationSnapshot extends BatchTrustEvaluation {
  readonly capturedAt: string;
}

/**
 * The document subsystem (the 48-document Music V1 registry, its
 * requirement/readiness policy, `DocumentRecord`s) does not exist in this
 * codebase yet. This envelope is therefore deliberately narrow: only
 * `profile` (caller-declared) and `registryVersion` (a fixed label) are
 * populated in V1. `readinessSnapshot` and `documentRefs` are reserved
 * names in the architecture decision this type implements, but are not
 * declared as fields here at all yet — defining their shape now, before
 * any real `DocumentRecord`/readiness-engine code exists to back them,
 * would mean guessing at a type this codebase has no grounds for yet.
 * They are added when the document subsystem that actually produces them
 * is built, not before.
 *
 * `profile` is a CALLER-DECLARED LABEL for the requested documentation
 * profile, never a claim about what evidence was actually captured.
 * Passing `'ai_native'` or `'hybrid'` does NOT mean this bundle contains
 * AI-generation provenance — this evidence model has no generation-event
 * shape and no prompt/model/tool metadata yet (`ProjectAsset.sourceType`'s
 * `ai_generated`/`ai_assisted` values are the only AI-related vocabulary
 * that exists today, and this store does not even persist `ProjectAsset`
 * — see `ARCHITECTURE.md`'s Local Evidence Store section). A caller
 * requesting the `ai_native` profile against a project with zero
 * AI-related evidence gets a bundle that says so nowhere except by what
 * is (and isn't) actually present in `events`/`checkpoints`/`batches`.
 */
export interface EvidenceBundleDocumentationEnvelope {
  readonly profile?: DocumentationProfile;
  readonly registryVersion: 'music-v1';
}

/** The requested documentation profile — see `EvidenceBundleDocumentationEnvelope` for what this does and does not assert. */
export type DocumentationProfile = 'traditional' | 'ai_native' | 'hybrid';

export interface EvidenceBundleIntegrityManifest {
  readonly algorithm: 'sha256';
  readonly canonicalHash: string;
}

/**
 * EXPLICIT, self-reported contribution claims for this project — exactly
 * `store.listContributorReferencesForProject(project.id)`, never a
 * derivation from `sessions`/`events`/`devices`. A profile with rich
 * activity above but no `ContributorReference` of its own contributes
 * zero entries here; this array is never back-filled from activity data.
 * See `src/domain/contributorReference.ts` and PROVENANCE_SPEC.md §3 for
 * what a claim is and is not: not FLOW verification, not ownership, not
 * copyright/publishing/master ownership, not a royalty/split
 * determination, not a contract.
 */
/**
 * Durable metadata about known creative artifacts (files, in effect) for
 * this project — exactly `store.listProjectAssetsForProject(project.id)`,
 * never a derivation from `sessions`/`events`/`contributorClaims`. Raw
 * media bytes never appear here or anywhere in this store — only
 * metadata and fingerprints (`sha256`), per ARCHITECTURE.md's privacy
 * principles. `ProjectAsset.createdByProfileId`, when present, is NOT a
 * `ContributorReference` and is never treated as one anywhere in this
 * module — see `src/domain/projectAsset.ts`'s own docstring for that
 * field's exact, deliberately narrow meaning.
 */
export interface EvidenceBundleExport {
  readonly manifestVersion: 1;
  readonly exportedAt: string;
  readonly project: EvidenceBundleProject;
  readonly devices: readonly EvidenceBundleDevice[];
  readonly sessions: readonly StudioSession[];
  readonly events: readonly ProvenanceEvent[];
  readonly checkpoints: readonly ProvenanceCheckpoint[];
  readonly batches: readonly ProvenanceBatch[];
  readonly contributorClaims: readonly ContributorReference[];
  readonly assets: readonly ProjectAsset[];
  readonly trustEvaluationSnapshots: readonly TrustEvaluationSnapshot[];
  readonly documentation?: EvidenceBundleDocumentationEnvelope;
  readonly evidenceReferenceSchemaVersion: 1;
  readonly integrityManifest: EvidenceBundleIntegrityManifest;
}

export interface AssembleEvidenceBundleOptions {
  readonly projectId: ProjectId;
  /**
   * Required, not defaulted to the wall clock: every timestamp in this
   * codebase's provenance/evidence layers is a caller-supplied parameter
   * (`PROVENANCE_SPEC.md` §12) so assembly stays deterministic and
   * testable. Callers pass their own current time.
   */
  readonly exportedAt: string;
  readonly documentationProfile?: DocumentationProfile;
}

function compareByFieldThenId<T>(field: (item: T) => string, id: (item: T) => string) {
  return (a: T, b: T): number => {
    const fa = field(a);
    const fb = field(b);
    if (fa !== fb) {
      return fa < fb ? -1 : 1;
    }
    const ia = id(a);
    const ib = id(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };
}

const compareSessions = compareByFieldThenId<StudioSession>(
  (s) => s.startedAt,
  (s) => s.id,
);
const compareEvents = compareByFieldThenId<ProvenanceEvent>(
  (e) => e.occurredAt,
  (e) => e.eventId,
);
const compareBatches = compareByFieldThenId<ProvenanceBatch>(
  (b) => b.createdAt,
  (b) => b.id,
);
const compareAssets = compareByFieldThenId<ProjectAsset>(
  (a) => a.firstSeenAt,
  (a) => a.id,
);

/**
 * `workReference` is surfaced only when every in-scope session agrees on
 * the same value; if none set one, it is omitted (a real, truthful "no
 * work reference yet" state). Sessions actively DISAGREEING is a
 * different, worse condition — it means this store's own data is
 * internally inconsistent about which upstream Work Passport this
 * project's evidence belongs to. Silently picking "the first one" or
 * silently omitting it would misrepresent that inconsistency as either a
 * fact or a non-issue, so this fails closed instead: a caller must notice
 * and resolve the disagreement upstream before a bundle can be exported.
 */
function deriveProjectWorkReference(sessions: readonly StudioSession[]): WorkReferenceId | undefined {
  const values = new Set(
    sessions.map((session) => session.workReference).filter((value): value is WorkReferenceId => value !== undefined),
  );
  if (values.size > 1) {
    throw new EvidenceBundleAssemblyError(
      `Evidence Bundle assembly: project sessions disagree on workReference (found: ${[...values].sort().join(', ')}) — refusing to export a bundle over internally inconsistent evidence.`,
    );
  }
  return values.size === 1 ? [...values][0] : undefined;
}

function collectDeviceIds(
  sessions: readonly StudioSession[],
  events: readonly ProvenanceEvent[],
  batches: readonly ProvenanceBatch[],
): DeviceId[] {
  const ids = new Set<DeviceId>();
  for (const session of sessions) {
    ids.add(session.deviceId);
  }
  for (const event of events) {
    ids.add(event.deviceId);
  }
  for (const batch of batches) {
    ids.add(batch.deviceId);
  }
  return [...ids].sort();
}

/**
 * Resolves a device referenced by in-scope evidence to its exportable
 * public metadata. Unreachable under normal foreign-key-enforced store
 * operation (`sessions`/`events`/`batches.deviceId` all `REFERENCES
 * devices(id)`, and devices are never deleted — see schema.ts), but not
 * assumed impossible: a store opened against a file written or modified
 * outside this store's own API could still be missing the row. FAILS
 * CLOSED rather than omitting: a session/event/batch whose device cannot
 * be resolved to public verification material means this bundle cannot
 * truthfully represent who recorded that evidence, or let a recipient
 * check its batch signatures — exporting anyway with a silently-missing
 * device entry would look like a complete bundle while quietly asserting
 * less than the buyer/recipient would assume. The affected evidence
 * itself is never what gets dropped; assembly refuses to produce a bundle
 * at all rather than produce a materially incomplete one.
 */
function resolveEvidenceBundleDevice(store: LocalEvidenceStore, deviceId: DeviceId): EvidenceBundleDevice {
  const device = store.getDevice(deviceId);
  const publicKey = store.getDevicePublicKey(deviceId);
  if (device === undefined || publicKey === undefined) {
    throw new EvidenceBundleAssemblyError(
      `Evidence Bundle assembly: device ${deviceId} is referenced by in-scope evidence but could not be resolved to a stored device record with a public key — refusing to export a bundle with an unverifiable device reference.`,
    );
  }
  return {
    deviceId: device.id,
    profileId: device.profileId,
    platform: device.platform,
    appVersion: device.appVersion,
    deviceKeyFingerprint: device.deviceKeyFingerprint,
    publicKeySpkiDerBase64: publicKey.toString('base64'),
    ...(device.verifiedAt !== undefined ? { verifiedAt: device.verifiedAt } : {}),
    ...(device.revokedAt !== undefined ? { revokedAt: device.revokedAt } : {}),
  };
}

/**
 * Assembles a project-scoped Evidence Bundle from the local store's
 * CURRENT state. Pure and read-only: every call is `store.get*`/`list*`
 * plus `evaluateStoredBatchTrust` — never an insert/update/delete, never
 * a network call. Two calls against the same unchanged store state with
 * the same `exportedAt` are byte-for-byte identical, including
 * `integrityManifest.canonicalHash`.
 *
 * FAIL-CLOSED, NOT FAIL-QUIET, IN TWO DIFFERENT WAYS. Evidence that is
 * merely untrustworthy is preserved, never curated away: an unsigned
 * batch, a batch with an unknown signer, a structurally broken chain, or a
 * revoked device's batch are all exported in full, with their true
 * `TrustEvaluationSnapshot` attached — the bundle's job is to represent
 * evidence truthfully, not to make it look clean. A project with no
 * sessions produces a bundle with empty arrays throughout, not an error —
 * that is the truthful representation of "no evidence exists for this
 * project," not a failure. But evidence that is internally INCONSISTENT —
 * a device reference this store cannot resolve
 * (`resolveEvidenceBundleDevice`), or sessions disagreeing on
 * `workReference` (`deriveProjectWorkReference`) — throws
 * `EvidenceBundleAssemblyError` instead of exporting a bundle that would
 * silently misrepresent or drop that inconsistency. Trustworthiness of the
 * *evidence* is for the recipient to judge from the preserved trust
 * snapshots; consistency of the *export itself* is this function's own
 * responsibility, and it refuses to produce an export it cannot vouch for
 * structurally.
 */
export function assembleEvidenceBundle(store: LocalEvidenceStore, options: AssembleEvidenceBundleOptions): EvidenceBundleExport {
  const sessions = [...store.listSessionsForProject(options.projectId)].sort(compareSessions);

  const events: ProvenanceEvent[] = [];
  const batches: ProvenanceBatch[] = [];
  for (const session of sessions) {
    events.push(...store.listEventsForSession(session.id));
    batches.push(...store.listBatchesForSession(session.id));
  }
  events.sort(compareEvents);
  batches.sort(compareBatches);

  // Already sequence-ordered by the store; re-stated here as the
  // canonical order rather than left implicit.
  const checkpoints = [...store.listCheckpointsForProject(options.projectId)];

  // Already claimedAt/rowid-ordered by the store (LocalEvidenceStore's own
  // deterministic contract) — never inferred from sessions/events/devices
  // above. A project with zero explicitly-inserted claims exports [].
  const contributorClaims = [...store.listContributorReferencesForProject(options.projectId)];

  // Re-sorted here defensively (same pattern as sessions/events/batches
  // above) rather than trusting the store's own order as final. Never
  // inferred from sessions/events — an asset exists in this array only
  // because it was explicitly persisted via insertProjectAsset.
  const assets = [...store.listProjectAssetsForProject(options.projectId)].sort(compareAssets);

  const devices = collectDeviceIds(sessions, events, batches).map((deviceId) =>
    resolveEvidenceBundleDevice(store, deviceId),
  );

  const trustEvaluationSnapshots: TrustEvaluationSnapshot[] = batches.map((batch) => {
    const evaluation = evaluateStoredBatchTrust(store, batch.id);
    if (evaluation === undefined) {
      // The batch was just read from the store above; for its trust
      // evaluation to now report "not found" would mean the store
      // changed underneath this synchronous assembly pass — a
      // consistency violation this function refuses to paper over by
      // silently omitting the batch's snapshot.
      throw new EvidenceBundleAssemblyError(
        `Evidence Bundle assembly: batch ${batch.id} was read from the store but its trust evaluation reported it missing — refusing to export an inconsistent bundle.`,
      );
    }
    return { ...evaluation, capturedAt: options.exportedAt };
  });

  const workReference = deriveProjectWorkReference(sessions);
  const project: EvidenceBundleProject = {
    projectId: options.projectId,
    ...(workReference !== undefined ? { workReference } : {}),
  };

  const documentation: EvidenceBundleDocumentationEnvelope | undefined =
    options.documentationProfile !== undefined
      ? { profile: options.documentationProfile, registryVersion: 'music-v1' }
      : undefined;

  const payloadWithoutIntegrity = {
    manifestVersion: 1 as const,
    exportedAt: options.exportedAt,
    project,
    devices,
    sessions,
    events,
    checkpoints,
    batches,
    contributorClaims,
    assets,
    trustEvaluationSnapshots,
    ...(documentation !== undefined ? { documentation } : {}),
    evidenceReferenceSchemaVersion: 1 as const,
  };

  // Reuses the repository's one canonical hashing primitive — never a
  // second serializer/hash scheme. The integrity manifest is computed
  // over exactly this payload, BEFORE the manifest itself is attached,
  // so the hash can never include (and thus never depends on) itself.
  const canonicalHash = hashCanonicalValue(payloadWithoutIntegrity as unknown as JsonValue);

  return {
    ...payloadWithoutIntegrity,
    integrityManifest: { algorithm: 'sha256', canonicalHash },
  };
}
