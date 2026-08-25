import type { JsonValue } from '../crypto/json.js';
import { hashCanonicalValue } from '../crypto/sha256.js';
import type { DocumentationProfile, EvidenceBundleExport, EvidenceBundleProject } from '../evidence/bundle.js';
import { DocumentAssemblyError } from './errors.js';
import type {
  DossierActivity,
  DossierAsset,
  DossierContributionClaim,
  DossierDisclaimers,
  DossierParticipant,
  DossierTrustSummary,
  ProjectDossier,
} from './dossier.js';

/**
 * Delivery Package (`src/documents/deliveryPackage.ts`) is a
 * recipient/purpose-specific VIEW assembled from a Project Dossier plus
 * (for `evidenceReferences` only) the underlying Evidence Bundle. It is a
 * package, never a second evidence source: every field it carries is
 * copied from a `ProjectDossier`/`EvidenceBundleExport` that already
 * existed, filtered down to the sections a caller explicitly requested.
 * Neither the dossier nor the bundle is read back out of a Delivery
 * Package once assembled — building one is a one-way, read-only
 * projection, never a place evidence gets edited or reinterpreted.
 *
 * `contributorClaims` is its own selectable section, never folded into
 * `participants` — a recipient who requests activity-derived
 * `participants` without also requesting `contributorClaims` gets no
 * contribution-claim data at all, and the reverse holds too. Both remain
 * exactly what `ProjectDossier` already labeled them: self-reported
 * claims, not verified credit, ownership, or rights.
 *
 * `assets` is a fourth, equally independent selectable section — the
 * dossier's `assetInventory`, included only when explicitly requested.
 * This describes what assets exist (metadata/fingerprints only, never
 * raw media bytes — see `DossierAsset`); it does not transport any file.
 * A recipient requesting `assets` without `contributorClaims` gets asset
 * metadata with no claim data, and the reverse holds too — this module
 * never infers one from the other.
 *
 * PRIVACY BY DEFAULT: sections summarize, they do not carry raw evidence.
 * `evidenceReferences` exposes only `{kind, id, at}` per record — never a
 * `ProvenanceEvent.payload`, a batch `signature`, a device's public key,
 * or any other verification/content material. A recipient who genuinely
 * needs to independently re-verify a signature or inspect an event's
 * payload needs the full `EvidenceBundleExport` itself, obtained through
 * a separate, explicit channel — Delivery Package V1 deliberately does
 * not carry that by default. See ARCHITECTURE.md's "Delivery Package"
 * section for the full disclosure-boundary statement.
 *
 * This is also the vehicle for selective disclosure toward a future FLOW
 * Platform Passport-verification flow: a package built with `audience:
 * 'flow_passport_verification'` IS the disclosed material — see
 * `src/sync/contracts.ts`'s `DisclosureRequest`/`DisclosureResponse`.
 * There is deliberately no second, competing "disclosure payload" type.
 */

export const DELIVERY_PACKAGE_AUDIENCES = [
  'collaborator',
  'producer',
  'artist',
  'label',
  'publisher',
  'manager',
  'attorney',
  'distributor',
  'sync_licensing_team',
  'platform',
  'archive',
  'flow_passport_verification',
  'other',
] as const;
export type DeliveryPackageAudience = (typeof DELIVERY_PACKAGE_AUDIENCES)[number];

export const DELIVERY_PACKAGE_PURPOSES = [
  'review',
  'verification',
  'archival',
  'licensing',
  'legal_review',
  'general_reference',
  'other',
] as const;
export type DeliveryPackagePurpose = (typeof DELIVERY_PACKAGE_PURPOSES)[number];

export const DELIVERY_PACKAGE_SECTION_KEYS = [
  'project',
  'participants',
  'contributorClaims',
  'assets',
  'activity',
  'trustSummary',
  'documentationProfile',
  'evidenceReferences',
  'disclaimers',
] as const;
export type DeliveryPackageSectionKey = (typeof DELIVERY_PACKAGE_SECTION_KEYS)[number];

/**
 * A redacted pointer to one underlying record — `kind` + `id` + its own
 * timestamp, nothing else. Never a `ProvenanceEvent.payload`, an
 * `assetId`/`trackReference`, a batch `signature`, or a checkpoint's
 * hash chain fields. A caller wanting more detail on a specific record
 * follows `id` back into the full `EvidenceBundleExport`.
 */
export interface EvidenceRecordReference {
  readonly kind: 'session' | 'event' | 'checkpoint' | 'batch';
  readonly id: string;
  readonly at: string;
}

export interface DeliveryPackageSections {
  readonly project?: EvidenceBundleProject;
  readonly participants?: readonly DossierParticipant[];
  readonly contributorClaims?: readonly DossierContributionClaim[];
  readonly assets?: readonly DossierAsset[];
  readonly activity?: DossierActivity;
  readonly trustSummary?: DossierTrustSummary;
  readonly documentationProfile?: DocumentationProfile;
  readonly evidenceReferences?: readonly EvidenceRecordReference[];
  readonly disclaimers?: DossierDisclaimers;
}

export interface DeliveryPackageSourceRefs {
  readonly evidenceBundle: { readonly exportedAt: string; readonly canonicalHash: string };
  readonly projectDossier: { readonly generatedAt: string; readonly dossierVersion: 1 };
}

export interface DeliveryPackageIntegrityManifest {
  readonly algorithm: 'sha256';
  readonly canonicalHash: string;
}

export interface DeliveryPackage {
  readonly packageVersion: 1;
  readonly createdAt: string;
  readonly audience: DeliveryPackageAudience;
  readonly purpose: DeliveryPackagePurpose;
  readonly source: DeliveryPackageSourceRefs;
  readonly sections: DeliveryPackageSections;
  readonly includedSections: readonly DeliveryPackageSectionKey[];
  readonly omittedSections: readonly DeliveryPackageSectionKey[];
  readonly integrityManifest: DeliveryPackageIntegrityManifest;
}

export interface BuildDeliveryPackageOptions {
  /** Required, not defaulted to the wall clock — same rule as everywhere else in this codebase (PROVENANCE_SPEC.md §12). */
  readonly createdAt: string;
  readonly audience: DeliveryPackageAudience;
  readonly purpose: DeliveryPackagePurpose;
  readonly includeSections: readonly DeliveryPackageSectionKey[];
}

function buildEvidenceReferences(bundle: EvidenceBundleExport): EvidenceRecordReference[] {
  const refs: EvidenceRecordReference[] = [
    ...bundle.sessions.map((session) => ({ kind: 'session' as const, id: session.id, at: session.startedAt })),
    ...bundle.events.map((event) => ({ kind: 'event' as const, id: event.eventId, at: event.occurredAt })),
    ...bundle.checkpoints.map((checkpoint) => ({ kind: 'checkpoint' as const, id: checkpoint.id, at: checkpoint.createdAt })),
    ...bundle.batches.map((batch) => ({ kind: 'batch' as const, id: batch.id, at: batch.createdAt })),
  ];
  return refs.sort((a, b) => {
    if (a.at !== b.at) {
      return a.at < b.at ? -1 : 1;
    }
    if (a.kind !== b.kind) {
      return a.kind < b.kind ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Assembles a Delivery Package from an already-built `ProjectDossier`
 * (for every section except `evidenceReferences`) and its source
 * `EvidenceBundleExport` (for `evidenceReferences` only). FAILS CLOSED,
 * never guesses:
 *  - an unrecognized `audience`/`purpose`/section key throws
 *    `DocumentAssemblyError` rather than silently defaulting to `'other'`
 *    or dropping the request;
 *  - a `dossier` not actually derived from `bundle` (its
 *    `sourceEvidenceBundle.canonicalHash` disagrees with
 *    `bundle.integrityManifest.canonicalHash`) throws rather than
 *    assembling a package over mismatched sources.
 *
 * Deterministic: `includedSections`/`omittedSections` are always listed
 * in `DELIVERY_PACKAGE_SECTION_KEYS`' fixed canonical order, independent
 * of the order `options.includeSections` was passed in.
 */
export function buildDeliveryPackage(
  bundle: EvidenceBundleExport,
  dossier: ProjectDossier,
  options: BuildDeliveryPackageOptions,
): DeliveryPackage {
  if (!(DELIVERY_PACKAGE_AUDIENCES as readonly string[]).includes(options.audience)) {
    throw new DocumentAssemblyError(`DeliveryPackage: audience "${options.audience}" is not recognized`);
  }
  if (!(DELIVERY_PACKAGE_PURPOSES as readonly string[]).includes(options.purpose)) {
    throw new DocumentAssemblyError(`DeliveryPackage: purpose "${options.purpose}" is not recognized`);
  }
  const requested = new Set(options.includeSections);
  for (const key of requested) {
    if (!(DELIVERY_PACKAGE_SECTION_KEYS as readonly string[]).includes(key)) {
      throw new DocumentAssemblyError(`DeliveryPackage: section "${key}" is not recognized`);
    }
  }
  if (dossier.sourceEvidenceBundle.canonicalHash !== bundle.integrityManifest.canonicalHash) {
    throw new DocumentAssemblyError(
      'DeliveryPackage: the supplied Project Dossier was not derived from the supplied Evidence Bundle ' +
        '(sourceEvidenceBundle.canonicalHash does not match bundle.integrityManifest.canonicalHash) — ' +
        'refusing to assemble a package over mismatched sources.',
    );
  }

  const sections: { -readonly [K in DeliveryPackageSectionKey]?: DeliveryPackageSections[K] } = {};
  if (requested.has('project')) {
    sections.project = dossier.project;
  }
  if (requested.has('participants')) {
    sections.participants = dossier.participants;
  }
  if (requested.has('contributorClaims')) {
    sections.contributorClaims = dossier.contributorClaims;
  }
  if (requested.has('assets')) {
    sections.assets = dossier.assetInventory;
  }
  if (requested.has('activity')) {
    sections.activity = dossier.activity;
  }
  if (requested.has('trustSummary')) {
    sections.trustSummary = dossier.trust;
  }
  if (requested.has('documentationProfile') && dossier.documentationProfile !== undefined) {
    sections.documentationProfile = dossier.documentationProfile;
  }
  if (requested.has('evidenceReferences')) {
    sections.evidenceReferences = buildEvidenceReferences(bundle);
  }
  if (requested.has('disclaimers')) {
    sections.disclaimers = dossier.disclaimers;
  }

  const includedSections = DELIVERY_PACKAGE_SECTION_KEYS.filter((key) => key in sections);
  const omittedSections = DELIVERY_PACKAGE_SECTION_KEYS.filter((key) => !(key in sections));

  const payloadWithoutIntegrity = {
    packageVersion: 1 as const,
    createdAt: options.createdAt,
    audience: options.audience,
    purpose: options.purpose,
    source: {
      evidenceBundle: { exportedAt: bundle.exportedAt, canonicalHash: bundle.integrityManifest.canonicalHash },
      projectDossier: { generatedAt: dossier.generatedAt, dossierVersion: dossier.dossierVersion },
    },
    sections,
    includedSections,
    omittedSections,
  };

  const canonicalHash = hashCanonicalValue(payloadWithoutIntegrity as unknown as JsonValue);

  return {
    ...payloadWithoutIntegrity,
    integrityManifest: { algorithm: 'sha256', canonicalHash },
  };
}
