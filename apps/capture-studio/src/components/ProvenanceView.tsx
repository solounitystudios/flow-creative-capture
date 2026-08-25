import type { ColdNightsFixture } from '../data/fixtureTypes.js';
import { claimStatusLabel, formatDateTime, humanize, signatureStatusLabel } from '../lib/viewModels.js';
import { StatusChip } from './StatusChip.js';

/**
 * Translates the real trust dimensions this codebase actually computes
 * into readable labels -- never inventing a state beyond what
 * `evaluateStoredBatchTrust` produces, and never labeling any of this
 * "verified creative contribution". Cryptographic batch soundness and
 * contributor verification are two different claims (AGENTS.md).
 */
export function ProvenanceView({ fixture }: { readonly fixture: ColdNightsFixture }) {
  const { bundle } = fixture;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Provenance</h1>
          <p className="page-header__subtitle">Local record chain for {fixture.project.title}</p>
        </div>
      </div>

      <div className="notice">
        A signed batch below means this local store's signature, structural, and device-trust checks currently pass —
        it says nothing about whether any creative contribution actually happened as claimed. Signed provenance is a
        different, narrower claim than a verified contribution.
      </div>

      <div className="card" style={{ marginTop: 'var(--space-5)' }}>
        <p className="card__title">Devices</p>
        {bundle.devices.map((device) => (
          <div className="detail-row" key={device.deviceId}>
            <span className="detail-row__label">
              {device.deviceKeyFingerprint.slice(0, 12)} · {humanize(device.platform)}
            </span>
            <span className="detail-row__value">
              {device.revokedAt !== undefined ? (
                <StatusChip label="Device revoked" tone="invalid" />
              ) : (
                <StatusChip label="Local record" tone="neutral" />
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <p className="card__title">Sessions &amp; checkpoints</p>
        <div className="stat-row">
          <Stat label="Sessions" value={bundle.sessions.length} />
          <Stat label="Events" value={bundle.events.length} />
          <Stat label="Checkpoints" value={bundle.checkpoints.length} />
          <Stat label="Signed batches" value={bundle.batches.length} />
        </div>
        {bundle.checkpoints.map((checkpoint) => (
          <div className="detail-row" key={checkpoint.id}>
            <span className="detail-row__label">
              Checkpoint #{checkpoint.sequence} — {humanize(checkpoint.triggerType)}
            </span>
            <span className="detail-row__value">
              <StatusChip label="Included in checkpoint chain" tone="sound" />
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <p className="card__title">Signed batches &amp; trust evaluation</p>
        {bundle.trustEvaluationSnapshots.map((snapshot) => {
          const batch = bundle.batches.find((b) => b.id === snapshot.batchId);
          const sig = signatureStatusLabel(snapshot.signature);
          const claim = claimStatusLabel(snapshot.claimStatus);
          return (
            <div key={snapshot.batchId} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-border)' }}>
              <div className="detail-row" style={{ borderBottom: 'none' }}>
                <span className="detail-row__label">{snapshot.batchId}</span>
                <span className="detail-row__value">{batch !== undefined ? formatDateTime(batch.createdAt) : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                <StatusChip label={sig.label} tone={sig.tone} />
                <StatusChip
                  label={snapshot.structure.valid ? 'Checkpoint & batch chain sound' : 'Structure invalid'}
                  tone={snapshot.structure.valid ? 'sound' : 'invalid'}
                />
                <StatusChip
                  label={snapshot.deviceTrust.currentlyTrusted ? 'Device currently trusted' : 'Device untrusted'}
                  tone={snapshot.deviceTrust.currentlyTrusted ? 'sound' : 'invalid'}
                />
                <StatusChip label={claim.label} tone={claim.tone} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
