/**
 * Thrown when `assembleEvidenceBundle` encounters a store state it cannot
 * export a trustworthy bundle from — an unresolvable device reference, or
 * in-scope evidence disagreeing on a field it must be single-valued to
 * export truthfully. Fail-closed: the export layer packages evidence, it
 * never curates, repairs, or silently narrows it (see src/evidence/bundle.ts).
 */
export class EvidenceBundleAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceBundleAssemblyError';
  }
}
