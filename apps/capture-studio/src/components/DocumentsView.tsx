import type { ColdNightsFixture } from '../data/fixtureTypes.js';

/**
 * `assembleEvidenceBundle`/`buildProjectDossier`/`buildDeliveryPackage` all
 * use `hashCanonicalValue` (node:crypto), which cannot run in a browser
 * bundle -- so this view shows the REAL counts from the precomputed
 * snapshot rather than a "Generate" button that would either fake the
 * call or silently fail. That distinction is stated explicitly below,
 * not glossed over.
 */
export function DocumentsView({ fixture }: { readonly fixture: ColdNightsFixture }) {
  const { bundle, dossier } = fixture;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Documents</h1>
          <p className="page-header__subtitle">The three implemented document layers for {fixture.project.title}</p>
        </div>
      </div>

      <div className="notice">
        These cards show real counts from a precomputed snapshot of this project's evidence — generation itself
        depends on Node's crypto module and cannot run live inside this browser-based shell. None of these is a
        Legal Agreement; that remains a separate, not-yet-built system.
      </div>

      <div className="doc-grid" style={{ marginTop: 'var(--space-5)' }}>
        <div className="card">
          <p className="card__title">Evidence Bundle</p>
          <p className="helper-text" style={{ marginTop: 0 }}>
            Technical provenance/evidence package — the source of truth every other document derives from.
          </p>
          <div className="stat-row">
            <Stat label="Sessions" value={bundle.sessions.length} />
            <Stat label="Events" value={bundle.events.length} />
            <Stat label="Checkpoints" value={bundle.checkpoints.length} />
            <Stat label="Signed batches" value={bundle.batches.length} />
            <Stat label="Assets" value={bundle.assets.length} />
            <Stat label="Contributor claims" value={bundle.contributorClaims.length} />
          </div>
          <p className="helper-text">Integrity hash: {bundle.integrityManifest.canonicalHash.slice(0, 16)}…</p>
        </div>

        <div className="card">
          <p className="card__title">Project Dossier</p>
          <p className="helper-text" style={{ marginTop: 0 }}>
            Human-readable project summary derived from one Evidence Bundle — never a second evidence store.
          </p>
          <div className="stat-row">
            <Stat label="Participants" value={dossier.participants.length} />
            <Stat label="Contributor claims" value={dossier.contributorClaims.length} />
            <Stat label="Asset inventory" value={dossier.assetInventory.length} />
          </div>
          <p className="helper-text">
            {dossier.trust.allBatchesSound
              ? 'All batches locally sound (unverified claim).'
              : 'One or more batches are not locally sound.'}
          </p>
        </div>

        <div className="card">
          <p className="card__title">Delivery Package</p>
          <p className="helper-text" style={{ marginTop: 0 }}>
            Recipient/purpose-specific selective view — see the Delivery section for the two example configurations.
          </p>
          <div className="stat-row">
            <Stat label="Example packages" value={Object.keys(fixture.deliveryPackages).length} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
