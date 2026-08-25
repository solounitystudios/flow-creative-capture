import type { ColdNightsFixture } from '../data/fixtureTypes.js';
import { formatDateTime, humanize } from '../lib/viewModels.js';
import { StatusChip } from './StatusChip.js';

/**
 * Contributor claims are rendered here entirely separately from assets or
 * activity. Status always reads "Claimed" -- never "Verified", "Supported",
 * or "Confirmed", because no verification state exists anywhere in this
 * codebase for a ContributorReference. See AGENTS.md's trust model.
 */
export function ContributorsView({ fixture }: { readonly fixture: ColdNightsFixture }) {
  const claims = fixture.bundle.contributorClaims;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Contributors</h1>
          <p className="page-header__subtitle">Self-reported role claims for {fixture.project.title}</p>
        </div>
      </div>

      <div className="notice">
        Contributor claims are self-reported and are not verified creative credits. They are never derived from
        session or event activity, and asset metadata (such as who introduced a file) never creates one automatically.
      </div>

      {claims.length === 0 ? (
        <p className="helper-text">No contributor claims recorded for this project.</p>
      ) : (
        <div className="contributor-grid" style={{ marginTop: 'var(--space-5)' }}>
          {claims.map((claim) => (
            <div className="card contributor-card" key={claim.id}>
              <StatusChip label="Claimed" tone="claim" />
              <p className="contributor-card__role">
                {humanize(claim.role)}
                {claim.subrole !== undefined ? ` — ${humanize(claim.subrole)}` : ''}
              </p>
              <p className="contributor-card__profile">{claim.profileId}</p>
              {claim.description !== undefined && <p className="contributor-card__desc">{claim.description}</p>}
              <p className="helper-text">Claimed {formatDateTime(claim.claimedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
