import { useState } from 'react';
import type { ColdNightsFixture } from '../data/fixtureTypes.js';
import { formatBytes, formatDateTime, humanize } from '../lib/viewModels.js';

type Tab = 'details' | 'provenance' | 'usage';
const TABS: { readonly key: Tab; readonly label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'provenance', label: 'Provenance' },
  { key: 'usage', label: 'Usage' },
];

export function AssetInspector({ fixture, assetId }: { readonly fixture: ColdNightsFixture; readonly assetId: string }) {
  const [tab, setTab] = useState<Tab>('details');
  const asset = fixture.bundle.assets.find((a) => a.id === assetId);

  if (asset === undefined) {
    return <p className="helper-text">Asset not found in this demo project.</p>;
  }

  const session = fixture.bundle.sessions.find((s) => s.id === asset.introducedBySessionId);
  const relatedEvents = fixture.bundle.events.filter((e) => e.assetId === asset.id);
  const relatedEdges = fixture.relationships.filter((r) => r.fromAssetId === asset.id || r.toAssetId === asset.id);

  return (
    <div className="inspector">
      <div className="inspector__header">
        <h2 className="inspector__title">{asset.originalFilename ?? asset.id}</h2>
      </div>

      <div className="tabs" role="tablist" aria-label="Asset detail sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="tabs__tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div>
          <DetailRow label="ID" value={asset.id} />
          <DetailRow label="Type" value={humanize(asset.assetType)} />
          <DetailRow label="Source type" value={humanize(asset.sourceType)} />
          {asset.originalFilename !== undefined && <DetailRow label="Original filename" value={asset.originalFilename} />}
          <DetailRow label="First seen" value={formatDateTime(asset.firstSeenAt)} />
          <DetailRow label="SHA-256" value={asset.sha256} />
          {asset.sizeBytes !== undefined && <DetailRow label="File size" value={formatBytes(asset.sizeBytes) ?? ''} />}
          <DetailRow label="Origin status" value={humanize(asset.originStatus)} />
          <DetailRow label="Introduced by session" value={asset.introducedBySessionId} />
          {asset.createdByProfileId !== undefined && (
            <DetailRow label="File source / profile" value={asset.createdByProfileId} />
          )}
          <p className="helper-text">
            {asset.createdByProfileId !== undefined
              ? 'This identifies who introduced or exported this specific file via their session. It does not establish creative authorship, and no credit for this asset has been verified — see the Contributors section for self-reported role claims, which are a separate record.'
              : 'No file-source profile was recorded for this asset (e.g. a purchased/imported sample with no attributable creator in this session).'}
          </p>
        </div>
      )}

      {tab === 'provenance' && (
        <div>
          <p className="helper-text" style={{ marginTop: 0, marginBottom: 'var(--space-3)' }}>
            Only links this evidence model can actually derive are shown below — no inferred checkpoint or batch
            linkage is fabricated.
          </p>
          {session !== undefined && (
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <p className="card__title" style={{ fontSize: 'var(--text-sm)' }}>
                Introducing session
              </p>
              <DetailRow label="Session" value={session.id} />
              <DetailRow label="DAW" value={humanize(session.daw)} />
              <DetailRow label="Started" value={formatDateTime(session.startedAt)} />
            </div>
          )}
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <p className="card__title" style={{ fontSize: 'var(--text-sm)' }}>
              Provenance events referencing this asset ({relatedEvents.length})
            </p>
            {relatedEvents.length === 0 ? (
              <p className="helper-text">No provenance event in this evidence set references this asset directly.</p>
            ) : (
              relatedEvents.map((event) => (
                <DetailRow key={event.eventId} label={humanize(event.eventType)} value={formatDateTime(event.occurredAt)} />
              ))
            )}
          </div>
          <p className="helper-text">
            Checkpoints and signed batches are not directly linked to a specific asset in this evidence model yet —
            only the events above are. A checkpoint or batch being sound says nothing about any individual asset's
            authenticity beyond what its own events show.
          </p>
        </div>
      )}

      {tab === 'usage' && (
        <div>
          <div className="notice">Persisted lineage relationships are not available yet — AssetRelationship has no store table in this codebase.</div>
          {relatedEdges.length > 0 && (
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <p className="card__title" style={{ fontSize: 'var(--text-sm)' }}>
                Demo relationship graph
              </p>
              <p className="helper-text" style={{ marginTop: 0 }}>
                From the in-memory Cold Nights scenario only — never persisted, shown for illustration.
              </p>
              {relatedEdges.map((edge) => (
                <DetailRow
                  key={edge.id}
                  label={humanize(edge.relationshipType)}
                  value={edge.fromAssetId === asset.id ? `→ ${edge.toAssetId}` : `${edge.fromAssetId} →`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-row__label">{label}</span>
      <span className="detail-row__value">{value}</span>
    </div>
  );
}
