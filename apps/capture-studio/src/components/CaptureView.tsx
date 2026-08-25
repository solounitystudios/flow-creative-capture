import type { ColdNightsFixture } from '../data/fixtureTypes.js';
import type { ActivityEntry } from '../lib/viewModels.js';
import { ProjectSessionHeader } from './ProjectSessionHeader.js';
import { ActivityFeed } from './ActivityFeed.js';

/**
 * The primary landing view. Only fields the domain model actually
 * carries appear in the session header; anything a real studio dashboard
 * might visually want (BPM, key, sample rate, meter) is NOT modeled
 * anywhere in this codebase, so it lives in its own explicitly-labeled
 * "not captured yet" panel rather than being silently invented.
 */
export function CaptureView({ fixture, feed }: { readonly fixture: ColdNightsFixture; readonly feed: readonly ActivityEntry[] }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">{fixture.project.title}</h1>
          <p className="page-header__subtitle">Demo project — Cold Nights scenario</p>
        </div>
      </div>

      <ProjectSessionHeader fixture={fixture} />

      <div className="card coming-next" style={{ display: 'block', marginBottom: 'var(--space-5)' }}>
        <span className="coming-next__badge">Not captured yet</span>
        <p className="helper-text" style={{ marginTop: 'var(--space-2)' }}>
          Production metadata — BPM, key, sample rate, time signature — is not part of this evidence model. Nothing
          here should be read as captured evidence until a real event/asset field actually carries it.
        </p>
      </div>

      <div className="card">
        <p className="card__title">Recent activity</p>
        <ActivityFeed entries={feed} limit={12} />
      </div>
    </div>
  );
}
