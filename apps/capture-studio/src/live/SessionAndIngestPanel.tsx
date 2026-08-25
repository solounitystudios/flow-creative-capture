import { useRef, useState } from 'react';
import type { StudioSession } from '../../../../src/domain/studioSession.js';
import type { ProjectAsset } from '../../../../src/domain/projectAsset.js';
import { AssetGrid } from '../components/AssetGrid.js';
import { formatDateTime } from '../lib/viewModels.js';

export function SessionAndIngestPanel({
  sessions,
  assets,
  actorProfileId,
  onStartSession,
  startingSession,
  onIngest,
  ingesting,
  selectedAssetId,
  onSelectAsset,
  onEndSession,
  endingSession,
}: {
  readonly sessions: readonly StudioSession[];
  readonly assets: readonly ProjectAsset[];
  readonly actorProfileId: string;
  readonly onStartSession: () => void;
  readonly startingSession: boolean;
  readonly onIngest: (sessionId: string, file: File) => void;
  readonly ingesting: boolean;
  readonly selectedAssetId: string | undefined;
  readonly onSelectAsset: (assetId: string) => void;
  readonly onEndSession: (sessionId: string) => void;
  readonly endingSession: boolean;
}) {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(sessions[sessions.length - 1]?.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentSessionId = activeSessionId ?? sessions[sessions.length - 1]?.id;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <p className="card__title">Sessions</p>
        {sessions.length === 0 ? (
          <p className="helper-text">No session started yet for this project.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {sessions.map((session) => (
              <div className="detail-row" key={session.id}>
                <span className="detail-row__label">{session.id}</span>
                <span className="detail-row__value" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {session.actorProfileId} · started {formatDateTime(session.startedAt)}
                  {session.status === 'active' ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => onEndSession(session.id)}
                      disabled={endingSession}
                    >
                      {endingSession ? 'Ending…' : 'End session'}
                    </button>
                  ) : (
                    <span className="helper-text">{session.status}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 'var(--space-3)' }}
          onClick={() => {
            onStartSession();
          }}
          disabled={startingSession}
        >
          {startingSession ? 'Starting…' : `Start session as ${actorProfileId}`}
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: 'var(--space-3)' }}>
        <p className="card__title">Ingest a local file</p>
        {currentSessionId === undefined ? (
          <p className="helper-text">Start a session first — an ingested asset must belong to one.</p>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="text-input"
              value={currentSessionId}
              onChange={(e) => setActiveSessionId(e.target.value)}
              aria-label="Session to attach the ingested asset to"
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.id}
                </option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Choose a local file to ingest"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined && currentSessionId !== undefined) {
                  onIngest(currentSessionId, file);
                }
                if (fileInputRef.current !== null) {
                  fileInputRef.current.value = '';
                }
              }}
              disabled={ingesting}
            />
            {ingesting && <span className="helper-text">Ingesting…</span>}
          </div>
        )}
        <p className="helper-text" style={{ marginTop: 'var(--space-2)' }}>
          The file's bytes are read by the local Studio service to compute a real SHA-256 fingerprint and byte size —
          the file itself is never copied into the evidence store or committed anywhere.
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: 'var(--space-3)' }}>
        <p className="card__title">Assets ({assets.length})</p>
        {assets.length === 0 ? (
          <p className="helper-text">No assets ingested yet.</p>
        ) : (
          <AssetGrid assets={assets} selectedId={selectedAssetId} onSelect={onSelectAsset} />
        )}
      </div>
    </div>
  );
}
