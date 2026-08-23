/**
 * Thrown when a document-layer builder (`buildProjectDossier`,
 * `buildDeliveryPackage`) is given an option or an input relationship it
 * cannot honor — an unrecognized controlled-vocabulary value, or a
 * Project Dossier that was not actually derived from the Evidence Bundle
 * it is being paired with. Fail-closed, matching
 * `EvidenceBundleAssemblyError` one layer down: this module packages and
 * summarizes evidence, it never guesses at what a malformed input meant.
 */
export class DocumentAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentAssemblyError';
  }
}
