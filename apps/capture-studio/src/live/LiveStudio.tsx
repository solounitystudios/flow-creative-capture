import { useEffect, useState } from 'react';
import type { CreativeProject } from '../../../../src/domain/creativeProject.js';
import type { ProvenanceCheckpoint } from '../../../../src/domain/provenanceCheckpoint.js';
import type { CheckpointTrustEvaluation } from '../../../../src/trust/checkpointTrust.js';
import * as studioClient from './studioClient.js';
import type { ProjectSnapshot } from './studioClient.js';
import { ProjectsPanel } from './ProjectsPanel.js';
import { SessionAndIngestPanel } from './SessionAndIngestPanel.js';
import { ContributorClaimPanel } from './ContributorClaimPanel.js';
import { EvidenceTimeline } from './EvidenceTimeline.js';
import { ActivityFeed } from '../components/ActivityFeed.js';
import { LiveAssetDetail } from './LiveAssetDetail.js';
import { buildLiveActivityFeed } from './liveViewModels.js';
import { humanize } from '../lib/viewModels.js';

/**
 * Capture Studio's live mode: a real, persisted project/session/asset/
 * contributor-claim/evidence-checkpoint workflow over the local Studio
 * service (`apps/capture-studio/service`) — replacing the Cold Nights
 * static fixture with genuinely created, stored, and reloaded data. See
 * `service/studioService.ts`'s docstring for the full architecture this
 * component is the browser-side front end of.
 *
 * Capture Studio V2 (Live Signed Evidence Checkpoints) adds `EvidenceTimeline`
 * below: real, device-signed checkpoints over this project's actual
 * history, each independently re-verified via `studioClient.verifyCheckpoint`
 * rather than trusted at face value. The Cold Nights demo (`App.tsx`'s
 * other mode) remains a separate, fixture-driven reference view.
 */
export function LiveStudio() {
  const [projects, setProjects] = useState<CreativeProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [serviceError, setServiceError] = useState<string | undefined>(undefined);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | undefined>(undefined);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>(undefined);
  const [creatingProject, setCreatingProject] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [addingClaim, setAddingClaim] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [creatingCheckpoint, setCreatingCheckpoint] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const [checkpoints, setCheckpoints] = useState<ProvenanceCheckpoint[]>([]);
  const [checkpointEvaluations, setCheckpointEvaluations] = useState<Record<string, CheckpointTrustEvaluation>>({});

  const actorProfileId = 'creator-1';

  async function loadProjects() {
    setProjectsLoading(true);
    try {
      const loaded = await studioClient.listProjects();
      setProjects(loaded);
      setServiceError(undefined);
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : 'Could not reach the local Studio service.');
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadSnapshot(projectId: string) {
    setSnapshotLoading(true);
    try {
      const loaded = await studioClient.getProjectSnapshot(projectId);
      setSnapshot(loaded);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load this project.');
    } finally {
      setSnapshotLoading(false);
    }
  }

  /**
   * Loads a project's checkpoints, then independently re-verifies each one
   * (`studioClient.verifyCheckpoint`) rather than trusting the list
   * response at face value — the whole point of a verify endpoint is that
   * a checkpoint's trust posture is recomputed, not cached from creation
   * time.
   */
  async function loadCheckpoints(projectId: string) {
    try {
      const loaded = await studioClient.listCheckpoints(projectId);
      setCheckpoints(loaded);
      const evaluations = await Promise.all(
        loaded.map(async (checkpoint) => [checkpoint.id, await studioClient.verifyCheckpoint(projectId, checkpoint.id)] as const),
      );
      setCheckpointEvaluations(Object.fromEntries(evaluations));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load evidence checkpoints.');
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  function handleSelectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedAssetId(undefined);
    setActionError(undefined);
    setCheckpoints([]);
    setCheckpointEvaluations({});
    void loadSnapshot(projectId);
    void loadCheckpoints(projectId);
  }

  async function handleCreateProject(input: { ownerProfileId: string; title: string; projectType: string }) {
    setCreatingProject(true);
    setActionError(undefined);
    try {
      const project = await studioClient.createProject(input);
      await loadProjects();
      handleSelectProject(project.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create the project.');
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleStartSession() {
    if (selectedProjectId === undefined) {
      return;
    }
    setStartingSession(true);
    setActionError(undefined);
    try {
      await studioClient.startSession(selectedProjectId, actorProfileId);
      await loadSnapshot(selectedProjectId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not start a session.');
    } finally {
      setStartingSession(false);
    }
  }

  async function handleIngest(sessionId: string, file: File) {
    if (selectedProjectId === undefined) {
      return;
    }
    setIngesting(true);
    setActionError(undefined);
    try {
      const asset = await studioClient.ingestAsset(selectedProjectId, sessionId, file);
      await loadSnapshot(selectedProjectId);
      setSelectedAssetId(asset.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not ingest that file.');
    } finally {
      setIngesting(false);
    }
  }

  async function handleAddClaim(input: { sessionId: string; profileId: string; role: string; subrole?: string }) {
    if (selectedProjectId === undefined) {
      return;
    }
    setAddingClaim(true);
    setActionError(undefined);
    try {
      await studioClient.addContributorClaim(selectedProjectId, input);
      await loadSnapshot(selectedProjectId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not add that contributor claim.');
    } finally {
      setAddingClaim(false);
    }
  }

  async function handleEndSession(sessionId: string) {
    if (selectedProjectId === undefined) {
      return;
    }
    setEndingSession(true);
    setActionError(undefined);
    try {
      await studioClient.endSession(selectedProjectId, sessionId);
      // Ending a session may automatically cut a session_end checkpoint
      // (see checkpointPolicy.ts) — reload both so the timeline reflects it.
      await loadSnapshot(selectedProjectId);
      await loadCheckpoints(selectedProjectId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not end that session.');
    } finally {
      setEndingSession(false);
    }
  }

  async function handleCreateCheckpoint() {
    if (selectedProjectId === undefined || snapshot === undefined) {
      return;
    }
    const activeSession = [...snapshot.sessions].reverse().find((s) => s.status === 'active') ?? snapshot.sessions.at(-1);
    if (activeSession === undefined) {
      setActionError('Start a session before creating a checkpoint.');
      return;
    }
    setCreatingCheckpoint(true);
    setActionError(undefined);
    try {
      await studioClient.createCheckpoint(selectedProjectId, activeSession.id, { actorProfileId });
      await loadCheckpoints(selectedProjectId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create a checkpoint.');
    } finally {
      setCreatingCheckpoint(false);
    }
  }

  if (serviceError !== undefined) {
    return (
      <div className="card" style={{ margin: 'var(--space-6)' }}>
        <p className="card__title">Local Studio service unreachable</p>
        <p className="helper-text">{serviceError}</p>
        <p className="helper-text">
          Start it with <code>npm run studio-service</code> from <code>apps/capture-studio</code>, then reload this
          page.
        </p>
        <button type="button" className="btn btn--ghost" style={{ marginTop: 'var(--space-3)' }} onClick={() => void loadProjects()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="live-studio" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 'var(--space-5)', padding: 'var(--space-5)' }}>
      <ProjectsPanel
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelect={handleSelectProject}
        onCreate={(input) => void handleCreateProject(input)}
        creating={creatingProject}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {projectsLoading && <p className="helper-text">Loading projects…</p>}

        {selectedProjectId === undefined ? (
          <p className="helper-text">Select a project, or create a new one, to get started.</p>
        ) : snapshotLoading || snapshot === undefined ? (
          <p className="helper-text">Loading project…</p>
        ) : (
          <>
            <div className="page-header">
              <div>
                <h1 className="page-header__title">{snapshot.project.title}</h1>
                <p className="page-header__subtitle">
                  {humanize(snapshot.project.projectType)} · {humanize(snapshot.project.status)} · live, persisted data
                </p>
              </div>
            </div>

            {actionError !== undefined && (
              <div className="notice" role="alert">
                {actionError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: selectedAssetId !== undefined ? '1fr 340px' : '1fr', gap: 'var(--space-5)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <SessionAndIngestPanel
                  sessions={snapshot.sessions}
                  assets={snapshot.assets}
                  actorProfileId={actorProfileId}
                  onStartSession={() => void handleStartSession()}
                  startingSession={startingSession}
                  onIngest={(sessionId, file) => void handleIngest(sessionId, file)}
                  ingesting={ingesting}
                  selectedAssetId={selectedAssetId}
                  onSelectAsset={setSelectedAssetId}
                  onEndSession={(sessionId) => void handleEndSession(sessionId)}
                  endingSession={endingSession}
                />

                <ContributorClaimPanel
                  claims={snapshot.contributorClaims}
                  sessions={snapshot.sessions}
                  onAddClaim={(input) => void handleAddClaim(input)}
                  adding={addingClaim}
                />

                <EvidenceTimeline
                  checkpoints={checkpoints}
                  evaluations={checkpointEvaluations}
                  onCreateCheckpoint={() => void handleCreateCheckpoint()}
                  creating={creatingCheckpoint}
                  canCreate={snapshot.sessions.length > 0}
                />

                <div className="card">
                  <p className="card__title">Activity</p>
                  <ActivityFeed entries={buildLiveActivityFeed(snapshot, checkpoints)} />
                </div>
              </div>

              {selectedAssetId !== undefined && (
                <aside className="shell__inspector" aria-label="Asset inspector" style={{ position: 'static', height: 'fit-content' }}>
                  {(() => {
                    const asset = snapshot.assets.find((a) => a.id === selectedAssetId);
                    if (asset === undefined) {
                      return null;
                    }
                    const session = snapshot.sessions.find((s) => s.id === asset.introducedBySessionId);
                    const relatedEvents = snapshot.events.filter((e) => e.assetId === asset.id);
                    return <LiveAssetDetail asset={asset} session={session} relatedEvents={relatedEvents} />;
                  })()}
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
