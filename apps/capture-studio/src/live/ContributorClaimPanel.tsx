import { useState } from 'react';
import type { StudioSession } from '../../../../src/domain/studioSession.js';
import type { ContributorReference } from '../../../../src/domain/contributorReference.js';
import { formatDateTime, humanize } from '../lib/viewModels.js';
import { StatusChip } from '../components/StatusChip.js';

/**
 * Mirrors `CONTRIBUTION_ROLES` (`src/domain/roles.ts`) as a local,
 * UI-only constant rather than a runtime import — `src/` never imports a
 * runtime value from the core engine, even from a module (like
 * `roles.ts`) that happens not to touch `node:crypto`/`node:sqlite`
 * itself; see `vite.config.ts`'s docstring for that invariant. The
 * Studio service validates the real role server-side regardless (see
 * `service/studioService.ts`'s `validateContributionRole`), so this list
 * only ever governs which options this dropdown offers, never what is
 * actually accepted.
 */
const CONTRIBUTION_ROLE_OPTIONS = [
  'artist',
  'producer',
  'beatmaker',
  'songwriter',
  'composer',
  'arranger',
  'musician',
  'vocalist',
  'recording_engineer',
  'mix_engineer',
  'mastering_engineer',
  'editor',
  'sound_designer',
  'creative_director',
  'visual_artist',
  'other',
] as const;

/**
 * Contributor claims are self-reported and never labeled "Verified",
 * "Confirmed", or "Supported" — same trust-language rule the fixture-based
 * `ContributorsView` already enforces (see `src/trustLanguage.test.tsx`).
 */
export function ContributorClaimPanel({
  claims,
  sessions,
  onAddClaim,
  adding,
}: {
  readonly claims: readonly ContributorReference[];
  readonly sessions: readonly StudioSession[];
  readonly onAddClaim: (input: { sessionId: string; profileId: string; role: string; subrole?: string }) => void;
  readonly adding: boolean;
}) {
  const [profileId, setProfileId] = useState('');
  const [role, setRole] = useState<(typeof CONTRIBUTION_ROLE_OPTIONS)[number]>('musician');
  const [subrole, setSubrole] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(sessions[sessions.length - 1]?.id);

  const currentSessionId = sessionId ?? sessions[sessions.length - 1]?.id;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p className="card__title">Contributor claims</p>
      <div className="notice">
        Contributor claims are self-reported and are not verified creative credits — the same trust language the
        Cold Nights demo uses.
      </div>

      {claims.length === 0 ? (
        <p className="helper-text">No contributor claims recorded for this project yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {claims.map((claim) => (
            <div className="card contributor-card" key={claim.id}>
              <StatusChip label="Claimed" tone="claim" />
              <p className="contributor-card__role">
                {humanize(claim.role)}
                {claim.subrole !== undefined ? ` — ${humanize(claim.subrole)}` : ''}
              </p>
              <p className="contributor-card__profile">{claim.profileId}</p>
              <p className="helper-text">Claimed {formatDateTime(claim.claimedAt)}</p>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (profileId.trim().length === 0 || currentSessionId === undefined) {
            return;
          }
          onAddClaim({
            sessionId: currentSessionId,
            profileId,
            role,
            ...(subrole.trim().length > 0 ? { subrole } : {}),
          });
          setProfileId('');
          setSubrole('');
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', borderTop: '1px solid var(--surface-border)', paddingTop: 'var(--space-3)' }}
      >
        {sessions.length === 0 ? (
          <p className="helper-text">Start a session first — a contributor claim is recorded through one.</p>
        ) : (
          <>
            <label className="session-field">
              <span className="session-field__label">Session</span>
              <select className="text-input" value={currentSessionId} onChange={(e) => setSessionId(e.target.value)}>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="session-field">
              <span className="session-field__label">Contributor profile ID</span>
              <input className="text-input" value={profileId} onChange={(e) => setProfileId(e.target.value)} placeholder="e.g. collaborator-2" />
            </label>
            <label className="session-field">
              <span className="session-field__label">Role</span>
              <select className="text-input" value={role} onChange={(e) => setRole(e.target.value as (typeof CONTRIBUTION_ROLE_OPTIONS)[number])}>
                {CONTRIBUTION_ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </select>
            </label>
            <label className="session-field">
              <span className="session-field__label">Subrole (optional)</span>
              <input className="text-input" value={subrole} onChange={(e) => setSubrole(e.target.value)} placeholder="e.g. lead_guitar" />
            </label>
            <button type="submit" className="btn btn--primary" disabled={adding || profileId.trim().length === 0}>
              {adding ? 'Adding…' : 'Add contributor claim'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
