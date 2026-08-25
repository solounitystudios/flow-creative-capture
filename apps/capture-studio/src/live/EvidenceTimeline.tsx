import type { ProvenanceCheckpoint } from '../../../../src/domain/provenanceCheckpoint.js';
import type { CheckpointTrustEvaluation } from '../../../../src/trust/checkpointTrust.js';
import { claimStatusLabel, formatDateTime, humanize, signatureStatusLabel } from '../lib/viewModels.js';
import { StatusChip } from '../components/StatusChip.js';

/**
 * Capture Studio V2's live evidence timeline: real, persisted, signed
 * checkpoints over this project's actual session/asset/event history —
 * the live-mode counterpart to `ProvenanceView.tsx`'s checkpoint/trust
 * section, over `studioClient.listCheckpoints`/`verifyCheckpoint` instead
 * of the Cold Nights fixture bundle. Same trust-language discipline: a
 * cryptographically sound checkpoint is never described as "verified" —
 * only "signature valid", "chain verified", "device currently trusted",
 * and the same narrow `claimStatusLabel` vocabulary `ProvenanceView` uses.
 */
export function EvidenceTimeline({
  checkpoints,
  evaluations,
  onCreateCheckpoint,
  creating,
  canCreate,
}: {
  readonly checkpoints: readonly ProvenanceCheckpoint[];
  readonly evaluations: Readonly<Record<string, CheckpointTrustEvaluation>>;
  readonly onCreateCheckpoint: () => void;
  readonly creating: boolean;
  readonly canCreate: boolean;
}) {
  return (
    <div className="card">
      <p className="card__title">Evidence checkpoints</p>
      <p className="helper-text">
        Each checkpoint below is signed by this Studio's own local device and links to the checkpoint before it —
        cryptographic evidence that this project's state was captured at a specific point, by this device. It is not
        a claim of contribution, final use, or legal ownership.
      </p>

      <button
        type="button"
        className="btn btn--primary"
        style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}
        onClick={onCreateCheckpoint}
        disabled={!canCreate || creating}
      >
        {creating ? 'Creating checkpoint…' : 'Create evidence checkpoint'}
      </button>

      {checkpoints.length === 0 ? (
        <p className="helper-text">No checkpoints yet for this project.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {checkpoints.map((checkpoint) => {
            const evaluation = evaluations[checkpoint.id];
            return (
              <div
                key={checkpoint.id}
                style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-border)' }}
              >
                <div className="detail-row" style={{ borderBottom: 'none' }}>
                  <span className="detail-row__label">
                    Checkpoint #{checkpoint.sequence} — {humanize(checkpoint.triggerType)}
                  </span>
                  <span className="detail-row__value">{formatDateTime(checkpoint.createdAt)}</span>
                </div>
                {evaluation === undefined ? (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <StatusChip label="Verifying…" tone="neutral" />
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                    <StatusChip {...signatureStatusLabel(evaluation.signature)} />
                    <StatusChip
                      label={evaluation.structure.valid ? 'Chain verified' : 'Chain invalid'}
                      tone={evaluation.structure.valid ? 'sound' : 'invalid'}
                    />
                    <StatusChip
                      label={evaluation.deviceTrust.currentlyTrusted ? 'Signed by this Studio device' : 'Device untrusted'}
                      tone={evaluation.deviceTrust.currentlyTrusted ? 'sound' : 'invalid'}
                    />
                    <StatusChip {...claimStatusLabel(evaluation.claimStatus)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
