import { useState } from 'react';
import type { ProjectAsset } from '../../../../src/domain/projectAsset.js';
import { AssetThumbnail } from './AssetThumbnail.js';
import { ASSET_FILTERS, filterAssets, formatBytes, humanize, shortHash, type AssetFilter } from '../lib/viewModels.js';

const FILTER_LABEL: Record<AssetFilter, string> = {
  all: 'All',
  audio: 'Audio',
  midi: 'MIDI',
  stem: 'Stem',
  mix: 'Mix',
  master: 'Master',
};

export function AssetGrid({
  assets,
  selectedId,
  onSelect,
}: {
  readonly assets: readonly ProjectAsset[];
  readonly selectedId: string | undefined;
  readonly onSelect: (assetId: string) => void;
}) {
  const [filter, setFilter] = useState<AssetFilter>('all');
  const filtered = filterAssets(assets, filter);

  return (
    <div>
      <div className="filter-row" role="group" aria-label="Filter assets by type">
        {ASSET_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className="filter-chip"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {FILTER_LABEL[key]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="helper-text">No assets match this filter.</p>
      ) : (
        <div className="asset-grid">
          {filtered.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="asset-card"
              aria-pressed={selectedId === asset.id}
              onClick={() => onSelect(asset.id)}
            >
              <div className="asset-card__thumb">
                <AssetThumbnail assetId={asset.id} assetType={asset.assetType} />
              </div>
              <div className="asset-card__body">
                <span className="asset-card__name">{asset.originalFilename ?? asset.id}</span>
                <span className="asset-card__meta">
                  <span>{humanize(asset.assetType)}</span>
                  <span>·</span>
                  <span>{shortHash(asset.sha256, 8)}</span>
                  {asset.sizeBytes !== undefined && (
                    <>
                      <span>·</span>
                      <span>{formatBytes(asset.sizeBytes)}</span>
                    </>
                  )}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
