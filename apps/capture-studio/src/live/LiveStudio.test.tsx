import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App.js';

/**
 * A small in-memory stand-in for the local Studio service's HTTP surface
 * (`service/http.ts`), so these tests exercise the real UI flow (create
 * project -> select -> start session -> ingest -> add contributor claim)
 * without spinning up an actual Node process. Route shapes mirror
 * `service/http.ts` exactly; see `service/http.test.ts` for the
 * corresponding tests against the real server.
 */
function createMockBackend() {
  let nextId = 1;
  const projects: Record<string, { id: string; ownerProfileId: string; title: string; projectType: string; status: string }> = {};
  const sessions: Record<string, { id: string; projectId: string; actorProfileId: string; status: string }[]> = {};
  const assets: Record<
    string,
    {
      id: string;
      projectId: string;
      originalFilename: string;
      assetType: string;
      sha256: string;
      sizeBytes: number;
      sourceType: string;
      originStatus: string;
      introducedBySessionId: string;
      firstSeenAt: string;
    }[]
  > = {};
  const claims: Record<string, { id: string; projectId: string; profileId: string; role: string; subrole?: string }[]> = {};
  const checkpoints: Record<string, { id: string; projectId: string; sequence: number; triggerType: string; createdAt: string; signature: string }[]> = {};
  /** Per-checkpoint verify() override for tests that need a non-sound evaluation. */
  const verifyOverrides: Record<string, unknown> = {};

  function soundEvaluation(checkpointId: string) {
    return {
      checkpointId,
      signature: { status: 'valid', verification: { valid: true } },
      structure: { valid: true, checkpointChain: { valid: true, errors: [] }, errors: [] },
      deviceTrust: { deviceFound: true, currentlyTrusted: true },
      claimStatus: 'locally_sound_unverified_claim',
      reasons: [],
    };
  }

  function snapshotFor(projectId: string) {
    return {
      project: projects[projectId],
      sessions: sessions[projectId] ?? [],
      assets: assets[projectId] ?? [],
      contributorClaims: claims[projectId] ?? [],
      events: [],
    };
  }

  const mockFetch = async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = init?.method ?? 'GET';
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.pathname === '/projects' && method === 'GET') {
      return json(Object.values(projects));
    }
    if (url.pathname === '/projects' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { ownerProfileId: string; title: string; projectType: string };
      const id = `project-${nextId++}`;
      projects[id] = { id, ownerProfileId: body.ownerProfileId, title: body.title, projectType: body.projectType, status: 'draft' };
      sessions[id] = [];
      assets[id] = [];
      claims[id] = [];
      return json(projects[id], 201);
    }
    const snapshotMatch = url.pathname.match(/^\/projects\/([^/]+)\/snapshot$/);
    if (snapshotMatch !== null && method === 'GET') {
      return json(snapshotFor(snapshotMatch[1]!));
    }
    const sessionsMatch = url.pathname.match(/^\/projects\/([^/]+)\/sessions$/);
    if (sessionsMatch !== null && method === 'POST') {
      const projectId = sessionsMatch[1]!;
      const body = JSON.parse(init?.body as string) as { actorProfileId: string };
      const id = `session-${nextId++}`;
      const session = { id, projectId, actorProfileId: body.actorProfileId, daw: 'other', startedAt: '2026-01-01T00:00:00.000Z', status: 'active' };
      sessions[projectId] = [...(sessions[projectId] ?? []), session];
      return json(session, 201);
    }
    const sessionEndMatch = url.pathname.match(/^\/projects\/([^/]+)\/sessions\/([^/]+)\/end$/);
    if (sessionEndMatch !== null && method === 'POST') {
      const [, projectId, sessionId] = sessionEndMatch;
      const list = sessions[projectId!] ?? [];
      const session = list.find((s) => s.id === sessionId);
      if (session !== undefined) {
        session.status = 'ended';
      }
      // Mirrors the real service's session_end auto-checkpoint policy
      // (checkpointPolicy.ts) closely enough for UI wiring tests: cut one
      // if this project has any evidence at all. The exact "new evidence
      // since the previous checkpoint" policy itself is exercised for real
      // in service/studioService.test.ts, not re-derived here.
      const existing = checkpoints[projectId!] ?? [];
      if ((assets[projectId!] ?? []).length > 0 || (claims[projectId!] ?? []).length > 0) {
        const id = `checkpoint-${nextId++}`;
        checkpoints[projectId!] = [
          ...existing,
          {
            id,
            projectId: projectId!,
            sequence: existing.length,
            triggerType: 'session_end',
            createdAt: '2026-01-01T00:11:00.000Z',
            signature: 'ZmFrZS1zaWduYXR1cmUtYnl0ZXMtZm9yLXRlc3Rpbmc=',
          },
        ];
      }
      return json(session, 200);
    }
    const checkpointsCreateMatch = url.pathname.match(/^\/projects\/([^/]+)\/sessions\/([^/]+)\/checkpoints$/);
    if (checkpointsCreateMatch !== null && method === 'POST') {
      const [, projectId] = checkpointsCreateMatch;
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { triggerType?: string };
      const existing = checkpoints[projectId!] ?? [];
      const id = `checkpoint-${nextId++}`;
      const checkpoint = {
        id,
        projectId: projectId!,
        sequence: existing.length,
        triggerType: body.triggerType ?? 'manual',
        createdAt: '2026-01-01T00:10:00.000Z',
        signature: 'ZmFrZS1zaWduYXR1cmUtYnl0ZXMtZm9yLXRlc3Rpbmc=',
      };
      checkpoints[projectId!] = [...existing, checkpoint];
      return json(checkpoint, 201);
    }
    const checkpointsListMatch = url.pathname.match(/^\/projects\/([^/]+)\/checkpoints$/);
    if (checkpointsListMatch !== null && method === 'GET') {
      return json(checkpoints[checkpointsListMatch[1]!] ?? []);
    }
    const checkpointVerifyMatch = url.pathname.match(/^\/projects\/([^/]+)\/checkpoints\/([^/]+)\/verify$/);
    if (checkpointVerifyMatch !== null && method === 'POST') {
      const [, , checkpointId] = checkpointVerifyMatch;
      return json(verifyOverrides[checkpointId!] ?? verifyOverrides['*'] ?? soundEvaluation(checkpointId!));
    }
    const assetsMatch = url.pathname.match(/^\/projects\/([^/]+)\/sessions\/([^/]+)\/assets$/);
    if (assetsMatch !== null && method === 'POST') {
      const [, projectId, sessionId] = assetsMatch;
      const id = `asset-${nextId++}`;
      const asset = {
        id,
        projectId: projectId!,
        introducedBySessionId: sessionId!,
        originalFilename: url.searchParams.get('originalFilename') ?? 'unknown',
        assetType: 'audio',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
        sourceType: 'imported_unknown',
        originStatus: 'declared',
        firstSeenAt: '2026-01-01T00:05:00.000Z',
      };
      assets[projectId!] = [...(assets[projectId!] ?? []), asset];
      return json(asset, 201);
    }
    const claimsMatch = url.pathname.match(/^\/projects\/([^/]+)\/contributor-claims$/);
    if (claimsMatch !== null && method === 'POST') {
      const projectId = claimsMatch[1]!;
      const body = JSON.parse(init?.body as string) as { profileId: string; role: string; subrole?: string };
      const id = `claim-${nextId++}`;
      const claim = {
        id,
        projectId,
        profileId: body.profileId,
        role: body.role,
        ...(body.subrole !== undefined ? { subrole: body.subrole } : {}),
        claimedAt: '2026-01-01T00:06:00.000Z',
      };
      claims[projectId] = [...(claims[projectId] ?? []), claim];
      return json(claim, 201);
    }

    return json({ error: `no mock route for ${method} ${url.pathname}` }, 404);
  };

  return {
    fetch: mockFetch,
    setVerifyOverride(checkpointId: string, evaluation: unknown) {
      verifyOverrides[checkpointId] = evaluation;
    },
  };
}

function renderLiveStudio() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Live Studio' }));
}

describe('Live Studio — real write path (mocked Studio service)', () => {
  it('creates a project, selects it, starts a session, ingests a file, and adds a contributor claim', async () => {
    vi.stubGlobal('fetch', vi.fn(createMockBackend().fetch));
    renderLiveStudio();

    await waitFor(() => expect(screen.getByText(/create the first one below/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. Midnight Drive'), { target: { value: 'Midnight Drive' } });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Midnight Drive' })).toBeInTheDocument());
    expect(screen.getByText(/live, persisted data/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /start session as/i }));
    await waitFor(() => expect(screen.getByLabelText('Session to attach the ingested asset to')).toBeInTheDocument());

    const file = new File(['fake audio bytes'], 'take.wav', { type: 'audio/wav' });
    const fileInput = screen.getByLabelText('Choose a local file to ingest');
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Ingest auto-selects the new asset, so "take.wav" legitimately appears
    // twice once ingest completes: the asset grid card, and the inspector
    // heading for the now-selected asset — same ambiguity App.test.tsx's
    // own asset-browser tests already document and scope around.
    await waitFor(() => expect(screen.getAllByText('take.wav').length).toBeGreaterThanOrEqual(2));
    const grid = document.querySelector('.asset-grid');
    expect(grid).not.toBeNull();
    expect(within(grid as HTMLElement).getByText('take.wav')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. collaborator-2'), { target: { value: 'collaborator-2' } });
    fireEvent.click(screen.getByRole('button', { name: /add contributor claim/i }));

    await waitFor(() => expect(screen.getByText('collaborator-2')).toBeInTheDocument());
    const claimed = screen.getAllByText('Claimed');
    expect(claimed.length).toBeGreaterThan(0);
  });

  it('lists multiple projects and switches between them on selection', async () => {
    vi.stubGlobal('fetch', vi.fn(createMockBackend().fetch));
    renderLiveStudio();
    await waitFor(() => expect(screen.getByText(/create the first one below/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. Midnight Drive'), { target: { value: 'Project One' } });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Project One' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. Midnight Drive'), { target: { value: 'Project Two' } });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Project Two' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('Project One'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Project One' })).toBeInTheDocument());
  });

  it('shows a clear, actionable message when the local Studio service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );
    renderLiveStudio();

    await waitFor(() => expect(screen.getByText(/local studio service unreachable/i)).toBeInTheDocument());
    expect(screen.getByText(/npm run studio-service/)).toBeInTheDocument();
  });

  it('never labels a contributor claim "Verified" or "Confirmed" in live mode either', async () => {
    vi.stubGlobal('fetch', vi.fn(createMockBackend().fetch));
    renderLiveStudio();
    await waitFor(() => expect(screen.getByText(/create the first one below/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. Midnight Drive'), { target: { value: 'Cold Nights 2' } });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cold Nights 2' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /start session as/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. collaborator-2')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. collaborator-2'), { target: { value: 'collaborator-3' } });
    fireEvent.click(screen.getByRole('button', { name: /add contributor claim/i }));
    await waitFor(() => expect(screen.getByText('collaborator-3')).toBeInTheDocument());

    const workspace = within(screen.getByText('collaborator-3').closest('.card') as HTMLElement);
    expect(workspace.queryByText('Verified')).not.toBeInTheDocument();
    expect(workspace.queryByText('Confirmed')).not.toBeInTheDocument();
    expect(workspace.getByText('Claimed')).toBeInTheDocument();
  });
});

describe('Live Studio — evidence timeline (Capture Studio V2)', () => {
  async function setUpProjectWithSessionAndAsset() {
    const backend = createMockBackend();
    vi.stubGlobal('fetch', vi.fn(backend.fetch));
    renderLiveStudio();
    await waitFor(() => expect(screen.getByText(/create the first one below/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. Midnight Drive'), { target: { value: 'Evidence Project' } });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Evidence Project' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /start session as/i }));
    await waitFor(() => expect(screen.getByLabelText('Choose a local file to ingest')).toBeInTheDocument());

    const file = new File(['fake audio bytes'], 'take.wav', { type: 'audio/wav' });
    fireEvent.change(screen.getByLabelText('Choose a local file to ingest'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getAllByText('take.wav').length).toBeGreaterThanOrEqual(1));

    return backend;
  }

  it('renders a signed checkpoint in the evidence timeline once created, with its verified state visually represented', async () => {
    await setUpProjectWithSessionAndAsset();

    expect(screen.getByText('Evidence checkpoints')).toBeInTheDocument();
    expect(screen.getByText('No checkpoints yet for this project.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create evidence checkpoint/i }));

    await waitFor(() => expect(screen.getByText(/Checkpoint #0/)).toBeInTheDocument());
    const timelineCard = screen.getByText('Evidence checkpoints').closest('.card') as HTMLElement;
    const timeline = within(timelineCard);
    await waitFor(() => expect(timeline.getByText('Signature valid')).toBeInTheDocument());
    expect(timeline.getByText('Chain verified')).toBeInTheDocument();
    expect(timeline.getByText('Signed by this Studio device')).toBeInTheDocument();
    expect(timeline.getByText('Locally sound (unverified claim)')).toBeInTheDocument();

    // The general activity feed also carries a distinctly labeled checkpoint entry.
    expect(screen.getByText(/Evidence checkpoint #0/)).toBeInTheDocument();
  });

  it('represents an invalid/unverifiable checkpoint state without crashing the app', async () => {
    const backend = await setUpProjectWithSessionAndAsset();
    backend.setVerifyOverride('*', {
      checkpointId: 'checkpoint-invalid',
      signature: { status: 'invalid', verification: { valid: false, reason: 'signature_mismatch' } },
      structure: { valid: false, checkpointChain: { valid: false, errors: ['tampering detected'] }, errors: ['tampering detected'] },
      deviceTrust: { deviceFound: true, currentlyTrusted: true },
      claimStatus: 'signature_invalid',
      reasons: ['signature_mismatch', 'checkpoint_chain_invalid'],
    });

    fireEvent.click(screen.getByRole('button', { name: /create evidence checkpoint/i }));

    const timelineCard = await waitFor(() => screen.getByText('Evidence checkpoints').closest('.card') as HTMLElement);
    const timeline = within(timelineCard);
    // Both the signature-status chip and the claim-status rollup chip
    // legitimately read "Signature invalid" for this scenario (signature
    // invalid IS the rollup's highest-priority reason) — assert at least
    // one is present rather than requiring exactly one.
    await waitFor(() => expect(timeline.getAllByText('Signature invalid').length).toBeGreaterThan(0));
    expect(timeline.getByText('Chain invalid')).toBeInTheDocument();

    // The rest of the app is still fully usable — no crash, no error boundary.
    expect(screen.getByRole('heading', { name: 'Evidence Project' })).toBeInTheDocument();
  });

  it('never labels a checkpoint "verified" — only signature/chain/device/claim-status vocabulary', async () => {
    await setUpProjectWithSessionAndAsset();
    fireEvent.click(screen.getByRole('button', { name: /create evidence checkpoint/i }));
    await waitFor(() => expect(screen.getByText(/Checkpoint #0/)).toBeInTheDocument());

    const timelineCard = screen.getByText('Evidence checkpoints').closest('.card') as HTMLElement;
    const timeline = within(timelineCard);
    await waitFor(() => expect(timeline.getByText('Signature valid')).toBeInTheDocument());
    expect(timeline.queryByText('Verified')).not.toBeInTheDocument();
    expect(timeline.queryByText(/^verified$/i)).not.toBeInTheDocument();
  });

  it('ending a session automatically cuts a session_end checkpoint that then appears in the timeline', async () => {
    await setUpProjectWithSessionAndAsset();
    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    await waitFor(() => expect(screen.getByText(/Checkpoint #0 — Session end/)).toBeInTheDocument());
  });
});
