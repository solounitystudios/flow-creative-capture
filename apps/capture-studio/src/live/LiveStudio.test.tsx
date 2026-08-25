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
  const sessions: Record<string, { id: string; projectId: string; actorProfileId: string }[]> = {};
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

  function snapshotFor(projectId: string) {
    return {
      project: projects[projectId],
      sessions: sessions[projectId] ?? [],
      assets: assets[projectId] ?? [],
      contributorClaims: claims[projectId] ?? [],
      events: [],
    };
  }

  return async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
}

function renderLiveStudio() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Live Studio' }));
}

describe('Live Studio — real write path (mocked Studio service)', () => {
  it('creates a project, selects it, starts a session, ingests a file, and adds a contributor claim', async () => {
    vi.stubGlobal('fetch', vi.fn(createMockBackend()));
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
    vi.stubGlobal('fetch', vi.fn(createMockBackend()));
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
    vi.stubGlobal('fetch', vi.fn(createMockBackend()));
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
