import type { ActivityEntry } from '../lib/viewModels.js';
import { ActivityFeed } from './ActivityFeed.js';

export function TimelineView({ feed, projectTitle }: { readonly feed: readonly ActivityEntry[]; readonly projectTitle: string }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Timeline</h1>
          <p className="page-header__subtitle">Full chronological record for {projectTitle}</p>
        </div>
      </div>
      <div className="card">
        <ActivityFeed entries={feed} />
      </div>
    </div>
  );
}
