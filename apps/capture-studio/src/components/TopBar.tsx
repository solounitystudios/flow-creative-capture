import type { ColdNightsFixture } from '../data/fixtureTypes.js';

/**
 * No fake live state anywhere here: the project selector is visually
 * functional but does not persist a selection (there's only one demo
 * project), the session status says "Recorded session" -- never a ticking
 * timer or a "LIVE" indicator -- and the command field is a disabled
 * preview affordance, not a working command palette.
 */
export function TopBar({ fixture }: { readonly fixture: ColdNightsFixture }) {
  const sessionCount = fixture.bundle.sessions.length;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__brand-mark" aria-hidden="true" />
        FLOW Capture
      </div>

      <div className="topbar__divider" aria-hidden="true" />

      <button type="button" className="topbar__project" aria-haspopup="listbox">
        {fixture.project.title}
        <span aria-hidden="true">▾</span>
      </button>

      <div className="topbar__session">
        <span>Session {String(sessionCount).padStart(3, '0')}</span>
        <StatusChipInline />
      </div>

      <div className="topbar__search">
        <div className="topbar__search-field" aria-disabled="true" title="Command search is not implemented in this preview">
          Search assets, contributors, documents…
          <span className="topbar__search-kbd">⌘K</span>
        </div>
      </div>

      <div className="topbar__right">
        <div className="topbar__avatars" aria-label="Collaborators on this project">
          {fixture.dossier.participants.map((participant, index) => (
            <span
              key={participant.profileId}
              className="avatar"
              style={{ background: index % 2 === 0 ? 'var(--accent)' : 'var(--status-claim)' }}
              title={participant.profileId}
            >
              {participant.profileId.replace('profile-', '').slice(0, 2).toUpperCase()}
            </span>
          ))}
        </div>
        <button type="button" className="btn btn--primary">
          Share
        </button>
      </div>
    </header>
  );
}

function StatusChipInline() {
  return (
    <span className="chip chip--neutral" title="This shell renders a frozen demo snapshot, not a live recording session">
      <span className="chip__dot" aria-hidden="true" />
      Demo session
    </span>
  );
}
