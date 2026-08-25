import type { ProjectAsset } from '../../../../src/domain/projectAsset.js';
import type { StudioSession } from '../../../../src/domain/studioSession.js';
import type { ProvenanceEvent } from '../../../../src/domain/provenanceEvent.js';
import { formatBytes, formatDateTime, humanize } from '../lib/viewModels.js';

/**
 * The live-mode counterpart to `AssetInspector` — deliberately its own,
 * smaller component rather than forcing `AssetInspector` to accept a
 * live `ProjectSnapshot` cast into `ColdNightsFixture`'s shape (which
 * would need `dossier`/`workReference`/`deliveryPackages` fields this
 * pass's write path does not produce). No "Usage" tab: `AssetRelationship`
 * has no persistence path in this pass either, so live mode truthfully
 * has nothing to show there, rather than faking an empty demo-graph tab.
 */
export function LiveAssetDetail({
  asset,
  session,
  relatedEvents,
}: {
  readonly asset: ProjectAsset;
  readonly session: StudioSession | undefined;
  readonly relatedEvents: readonly ProvenanceEvent[];
}) {
  return (
    <div className="inspector">
      <div className="inspector__header">
        <h2 className="inspector__title">{asset.originalFilename ?? asset.id}</h2>
      </div>

      <DetailRow label="ID" value={asset.id} />
      <DetailRow label="Type" value={humanize(asset.assetType)} />
      <DetailRow label="Source type" value={humanize(asset.sourceType)} />
      {asset.originalFilename !== undefined && <DetailRow label="Original filename" value={asset.originalFilename} />}
      <DetailRow label="First seen" value={formatDateTime(asset.firstSeenAt)} />
      <DetailRow label="SHA-256" value={asset.sha256} />
      {asset.sizeBytes !== undefined && <DetailRow label="File size" value={formatBytes(asset.sizeBytes) ?? ''} />}
      <DetailRow label="Origin status" value={humanize(asset.originStatus)} />
      <DetailRow label="Introduced by session" value={asset.introducedBySessionId} />
      {asset.createdByProfileId !== undefined && <DetailRow label="File source / profile" value={asset.createdByProfileId} />}
      <p className="helper-text">
        {asset.createdByProfileId !== undefined
          ? 'This identifies who introduced this specific file via their session. It does not establish creative authorship, and no credit for this asset has been verified — see contributor claims, a separate record.'
          : 'No file-source profile was recorded for this asset.'}
      </p>

      {session !== undefined && (
        <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          <p className="card__title" style={{ fontSize: 'var(--text-sm)' }}>
            Introducing session
          </p>
          <DetailRow label="Session" value={session.id} />
          <DetailRow label="Started" value={formatDateTime(session.startedAt)} />
        </div>
      )}

      <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
        <p className="card__title" style={{ fontSize: 'var(--text-sm)' }}>
          Provenance events referencing this asset ({relatedEvents.length})
        </p>
        {relatedEvents.length === 0 ? (
          <p className="helper-text">No provenance event in this project references this asset directly.</p>
        ) : (
          relatedEvents.map((event) => (
            <DetailRow key={event.eventId} label={humanize(event.eventType)} value={formatDateTime(event.occurredAt)} />
          ))
        )}
      </div>
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
