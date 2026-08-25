import type { ActivityEntry } from '../lib/viewModels.js';
import { activityKindLabel, formatClockTime } from '../lib/viewModels.js';

/**
 * Each row states its own record kind explicitly (SESSION / PROVENANCE
 * EVENT / ASSET / CHECKPOINT / BATCH / CONTRIBUTOR CLAIM) -- this is the
 * one place the architectural distinction between activity, evidence,
 * assets, and claims has to stay visible to a reader at a glance, per
 * PROVENANCE_SPEC.md's four-concept separation.
 */
export function ActivityFeed({ entries, limit }: { readonly entries: readonly ActivityEntry[]; readonly limit?: number }) {
  const shown = limit !== undefined ? entries.slice(0, limit) : entries;

  if (shown.length === 0) {
    return <p className="helper-text">No activity recorded.</p>;
  }

  return (
    <div className="feed">
      {shown.map((entry) => (
        <div className="feed-row" key={`${entry.kind}-${entry.id}`}>
          <span className="feed-row__time">{formatClockTime(entry.at)}</span>
          <span className="chip chip--neutral">{activityKindLabel(entry.kind).toUpperCase()}</span>
          <span className="feed-row__label">
            {entry.title}
            <span className="feed-row__meta"> · {entry.meta}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
