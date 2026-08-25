import type { AssetType } from '../../../../src/domain/enums.js';

/**
 * Presentation-only visual treatments per asset type. These are NOT
 * derived from any real media analysis -- no waveform decoding, no audio
 * inspection happens anywhere in this app (explicitly out of scope for
 * V1). The "waveform" bars below are a deterministic pattern generated
 * from the asset's own id, purely so repeat renders look stable -- never
 * presented as, or confused with, an actual audio analysis result.
 */
export function AssetThumbnail({ assetId, assetType }: { readonly assetId: string; readonly assetType: AssetType }) {
  switch (assetType) {
    case 'audio':
    case 'stem':
    case 'mix':
    case 'master':
      return (
        <div className="thumb-waveform" aria-hidden="true">
          {pseudoBars(assetId, 22).map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      );
    case 'midi':
      return <MidiBlock aria-hidden />;
    case 'sample':
      return <span className="thumb-icon" aria-hidden="true">◧</span>;
    case 'image':
      return <span className="thumb-icon" aria-hidden="true">🖼</span>;
    case 'video':
      return <span className="thumb-icon" aria-hidden="true">▶</span>;
    case 'document':
      return <span className="thumb-icon" aria-hidden="true">▤</span>;
    case 'daw_project':
      return <span className="thumb-icon" aria-hidden="true">◫</span>;
    case 'preset':
      return <span className="thumb-icon" aria-hidden="true">◎</span>;
    default:
      return <span className="thumb-icon" aria-hidden="true">◇</span>;
  }
}

function MidiBlock(props: { readonly 'aria-hidden'?: boolean }) {
  const rows = [3, 5, 2, 6, 4, 1, 5, 3];
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 32 }} {...props}>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            width: 5,
            height: `${(row / 6) * 100}%`,
            background: 'var(--status-claim)',
            opacity: 0.6,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

/** Deterministic bar heights derived from a string id -- stable, not random, not analytical. */
function pseudoBars(seed: string, count: number): number[] {
  const bars: number[] = [];
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) % 997;
  }
  for (let i = 0; i < count; i += 1) {
    h = (h * 1103515245 + 12345) % 2147483648;
    bars.push(20 + (h % 80));
  }
  return bars;
}
