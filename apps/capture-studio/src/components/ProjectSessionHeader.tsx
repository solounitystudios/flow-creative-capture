import type { ColdNightsFixture } from '../data/fixtureTypes.js';
import { formatDateTime, humanize } from '../lib/viewModels.js';

/**
 * Only fields the domain model actually carries: project/session/DAW/
 * status. Production metadata like BPM/key/sample-rate is NOT modeled
 * anywhere in this codebase yet, so it never appears here as if it were
 * captured evidence -- see the separate placeholder note in CaptureView.
 */
export function ProjectSessionHeader({ fixture }: { readonly fixture: ColdNightsFixture }) {
  const firstSession = fixture.bundle.sessions[0];

  return (
    <div className="session-header">
      <Field label="Project" value={fixture.project.title} />
      <Field label="Project type" value={humanize(fixture.project.projectType)} />
      <Field label="Status" value={humanize(fixture.project.status)} />
      {firstSession !== undefined && (
        <>
          <Field label="DAW" value={humanize(firstSession.daw)} mono />
          <Field label="Session start" value={formatDateTime(firstSession.startedAt)} />
          <Field
            label="Session status"
            value={firstSession.endedAt !== undefined ? 'Ended' : 'Active'}
          />
        </>
      )}
      <Field label="Sessions" value={String(fixture.bundle.sessions.length)} mono />
      <Field label="Contributor claims" value={String(fixture.bundle.contributorClaims.length)} mono />
    </div>
  );
}

function Field({ label, value, mono = false }: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <div className="session-field">
      <span className="session-field__label">{label}</span>
      <span className={`session-field__value${mono ? ' session-field__value--mono' : ''}`}>{value}</span>
    </div>
  );
}
