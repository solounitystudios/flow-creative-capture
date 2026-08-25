import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { StudioService } from './studioService.js';
import { StudioServiceError } from './errors.js';

/**
 * The HTTP boundary for the local Studio service (`apps/capture-studio/
 * service`). This is the ONLY thing the browser ever talks to — see
 * `studioService.ts`'s own docstring for the full boundary statement.
 * No dependency beyond Node's built-in `node:http`: this is a small,
 * local, single-user dev tool, not a general backend platform, so it
 * does not pull in Express/Fastify/a router library/a multipart parser.
 *
 * SECURITY POSTURE (see the pass's security-boundary checklist):
 *  - The browser never receives private signing-key material — no
 *    response body here ever includes a `StudioDevice`, a
 *    `DeviceIdentity`, or any key bytes; only `CreativeProject`/
 *    `StudioSession`/`ProjectAsset`/`ContributorReference`/
 *    `ProvenanceEvent` values, which are the same public, non-secret
 *    shapes this codebase already treats as safe to export.
 *  - File ingestion never accepts a client-supplied filesystem path —
 *    only raw request-body BYTES (the browser already read the user's
 *    local file via the File API before uploading it). `originalFilename`
 *    is stored as opaque metadata text only; it is never used to build a
 *    filesystem path, open a file, or run a command.
 *  - Every request body (JSON or raw upload) is size-capped before being
 *    buffered in memory — an oversized request is rejected (413) rather
 *    than exhausting memory.
 *  - CORS is restricted to one explicit allowed origin (the Vite dev
 *    server), not `*`.
 */

const JSON_BODY_LIMIT_BYTES = 1 * 1024 * 1024; // 1MB — ample for this service's small JSON payloads
const ASSET_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024; // 200MB — a generous local-file ingest ceiling, not a media pipeline

function setCorsHeaders(res: ServerResponse, allowedOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) {
        return;
      }
      total += chunk.length;
      if (total > limitBytes) {
        rejected = true;
        // Deliberately does NOT call req.destroy() here: destroying the
        // request stream tends to tear down the underlying socket before
        // the caller's error handler (createStudioHttpServer's .catch, via
        // this rejection) gets a chance to write a clean 413 response —
        // observed directly as the client seeing ECONNRESET instead of an
        // HTTP error body (service/http.test.ts, "rejects a JSON body over
        // the size limit"). Already-buffered chunks are dropped (never
        // pushed past the limit, so memory stays bounded); any further
        // bytes on the wire are simply ignored by the `rejected` guard
        // above rather than accumulated. This is a local, single-user
        // companion service (see this module's docstring) — draining an
        // oversized request instead of hard-resetting the socket is an
        // acceptable, smaller-blast-radius tradeoff than an unexplained
        // connection reset.
        reject(new StudioServiceError('Request body exceeds the allowed size limit', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (error) => {
      if (!rejected) {
        reject(error);
      }
    });
  });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, JSON_BODY_LIMIT_BYTES);
  if (raw.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new StudioServiceError('Request body is not valid JSON', 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StudioServiceError('Request body must be a JSON object', 400);
  }
  return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StudioServiceError(`"${field}" is required and must be a non-empty string`, 400);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new StudioServiceError(`"${field}" must be a string`, 400);
  }
  return value;
}

export interface StudioHttpServerOptions {
  readonly allowedOrigin: string;
}

/**
 * Builds (but does not start listening) the Studio service's `http.Server`.
 * Routing is a handful of literal/regex path matches, deliberately not a
 * router library — see this module's own docstring for why.
 */
export function createStudioHttpServer(service: StudioService, options: StudioHttpServerOptions): Server {
  const projectSessionsPattern = /^\/projects\/([^/]+)\/sessions$/;
  const projectSessionEndPattern = /^\/projects\/([^/]+)\/sessions\/([^/]+)\/end$/;
  const projectSessionAssetsPattern = /^\/projects\/([^/]+)\/sessions\/([^/]+)\/assets$/;
  const projectSessionCheckpointsPattern = /^\/projects\/([^/]+)\/sessions\/([^/]+)\/checkpoints$/;
  const projectSnapshotPattern = /^\/projects\/([^/]+)\/snapshot$/;
  const projectByIdPattern = /^\/projects\/([^/]+)$/;
  const projectContributorClaimsPattern = /^\/projects\/([^/]+)\/contributor-claims$/;
  const projectCheckpointsPattern = /^\/projects\/([^/]+)\/checkpoints$/;
  const projectCheckpointByIdPattern = /^\/projects\/([^/]+)\/checkpoints\/([^/]+)$/;
  const projectCheckpointVerifyPattern = /^\/projects\/([^/]+)\/checkpoints\/([^/]+)\/verify$/;

  return createServer((req, res) => {
    setCorsHeaders(res, options.allowedOrigin);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    void handleRequest(service, req, res, pathname, url.searchParams, {
      projectSessionsPattern,
      projectSessionEndPattern,
      projectSessionAssetsPattern,
      projectSessionCheckpointsPattern,
      projectSnapshotPattern,
      projectByIdPattern,
      projectContributorClaimsPattern,
      projectCheckpointsPattern,
      projectCheckpointByIdPattern,
      projectCheckpointVerifyPattern,
    }).catch((error: unknown) => {
      if (res.headersSent) {
        return;
      }
      if (error instanceof StudioServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      if (error instanceof Error) {
        // Domain factory validation errors (e.g. `createStudioSession`
        // throwing "StudioSession.daw ... is not recognized") are plain
        // `Error`s written to be read by a caller — safe to surface as
        // 400. A stack trace is never included in the response.
        sendJson(res, 400, { error: error.message });
        return;
      }
      console.error('Studio service: unexpected non-Error throw', error);
      sendJson(res, 500, { error: 'Internal error' });
    });
  });
}

interface RoutePatterns {
  readonly projectSessionsPattern: RegExp;
  readonly projectSessionEndPattern: RegExp;
  readonly projectSessionAssetsPattern: RegExp;
  readonly projectSessionCheckpointsPattern: RegExp;
  readonly projectSnapshotPattern: RegExp;
  readonly projectByIdPattern: RegExp;
  readonly projectContributorClaimsPattern: RegExp;
  readonly projectCheckpointsPattern: RegExp;
  readonly projectCheckpointByIdPattern: RegExp;
  readonly projectCheckpointVerifyPattern: RegExp;
}

async function handleRequest(
  service: StudioService,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams,
  patterns: RoutePatterns,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (pathname === '/health' && method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/projects' && method === 'GET') {
    sendJson(res, 200, service.listProjects());
    return;
  }

  if (pathname === '/projects' && method === 'POST') {
    const body = await readJsonBody(req);
    const project = service.createProject({
      ownerProfileId: requireString(body, 'ownerProfileId'),
      title: requireString(body, 'title'),
      projectType: requireString(body, 'projectType') as CreateProjectType,
      ...(optionalString(body, 'status') !== undefined ? { status: optionalString(body, 'status') as CreateProjectStatus } : {}),
      ...(optionalString(body, 'organizationId') !== undefined ? { organizationId: optionalString(body, 'organizationId')! } : {}),
      ...(optionalString(body, 'externalProjectPassportId') !== undefined
        ? { externalProjectPassportId: optionalString(body, 'externalProjectPassportId')! }
        : {}),
    });
    sendJson(res, 201, project);
    return;
  }

  const snapshotMatch = pathname.match(patterns.projectSnapshotPattern);
  if (snapshotMatch !== null && method === 'GET') {
    const [, projectId] = snapshotMatch;
    sendJson(res, 200, service.getProjectSnapshot(projectId!));
    return;
  }

  const sessionsMatch = pathname.match(patterns.projectSessionsPattern);
  if (sessionsMatch !== null && method === 'POST') {
    const [, projectId] = sessionsMatch;
    const body = await readJsonBody(req);
    const session = service.startSession(projectId!, { actorProfileId: requireString(body, 'actorProfileId') });
    sendJson(res, 201, session);
    return;
  }

  const sessionEndMatch = pathname.match(patterns.projectSessionEndPattern);
  if (sessionEndMatch !== null && method === 'POST') {
    const [, projectId, sessionId] = sessionEndMatch;
    const session = service.endSession(projectId!, sessionId!);
    sendJson(res, 200, session);
    return;
  }

  const assetsMatch = pathname.match(patterns.projectSessionAssetsPattern);
  if (assetsMatch !== null && method === 'POST') {
    const [, projectId, sessionId] = assetsMatch;
    const fileBytes = await readBody(req, ASSET_UPLOAD_LIMIT_BYTES);
    const asset = service.ingestAsset(projectId!, sessionId!, fileBytes, {
      ...(searchParams.get('originalFilename') !== null ? { originalFilename: searchParams.get('originalFilename')! } : {}),
      ...(searchParams.get('mimeType') !== null ? { mimeType: searchParams.get('mimeType')! } : {}),
      ...(searchParams.get('createdByProfileId') !== null ? { createdByProfileId: searchParams.get('createdByProfileId')! } : {}),
      ...(searchParams.get('sourceType') !== null ? { sourceType: searchParams.get('sourceType')! } : {}),
    });
    sendJson(res, 201, asset);
    return;
  }

  const sessionCheckpointsMatch = pathname.match(patterns.projectSessionCheckpointsPattern);
  if (sessionCheckpointsMatch !== null && method === 'POST') {
    const [, projectId, sessionId] = sessionCheckpointsMatch;
    const body = await readJsonBody(req);
    const checkpoint = service.createCheckpoint(projectId!, sessionId!, {
      actorProfileId: requireString(body, 'actorProfileId'),
      ...(optionalString(body, 'triggerType') !== undefined ? { triggerType: optionalString(body, 'triggerType')! } : {}),
    });
    sendJson(res, 201, checkpoint);
    return;
  }

  const checkpointVerifyMatch = pathname.match(patterns.projectCheckpointVerifyPattern);
  if (checkpointVerifyMatch !== null && method === 'POST') {
    const [, projectId, checkpointId] = checkpointVerifyMatch;
    const evaluation = service.verifyCheckpoint(projectId!, checkpointId!);
    sendJson(res, 200, evaluation);
    return;
  }

  const checkpointsListMatch = pathname.match(patterns.projectCheckpointsPattern);
  if (checkpointsListMatch !== null && method === 'GET') {
    const [, projectId] = checkpointsListMatch;
    sendJson(res, 200, service.listCheckpoints(projectId!));
    return;
  }

  const checkpointByIdMatch = pathname.match(patterns.projectCheckpointByIdPattern);
  if (checkpointByIdMatch !== null && method === 'GET') {
    const [, projectId, checkpointId] = checkpointByIdMatch;
    sendJson(res, 200, service.getCheckpoint(projectId!, checkpointId!));
    return;
  }

  const contributorClaimsMatch = pathname.match(patterns.projectContributorClaimsPattern);
  if (contributorClaimsMatch !== null && method === 'POST') {
    const [, projectId] = contributorClaimsMatch;
    const body = await readJsonBody(req);
    const claim = service.addContributorClaim(projectId!, {
      sessionId: requireString(body, 'sessionId'),
      profileId: requireString(body, 'profileId'),
      role: requireString(body, 'role'),
      ...(optionalString(body, 'subrole') !== undefined ? { subrole: optionalString(body, 'subrole')! } : {}),
      ...(optionalString(body, 'description') !== undefined ? { description: optionalString(body, 'description')! } : {}),
    });
    sendJson(res, 201, claim);
    return;
  }

  const projectByIdMatch = pathname.match(patterns.projectByIdPattern);
  if (projectByIdMatch !== null && method === 'GET') {
    const [, projectId] = projectByIdMatch;
    const snapshot = service.getProjectSnapshot(projectId!);
    sendJson(res, 200, snapshot.project);
    return;
  }

  sendJson(res, 404, { error: `No route for ${method} ${pathname}` });
}

// Kept local and narrow rather than importing the full domain enum union
// types here: request bodies are validated by the domain factories
// themselves (`createCreativeProject`, ...) inside `StudioService`, which
// throw a precise, safe-to-surface error for an unrecognized value — this
// HTTP layer only needs to widen an incoming string to the right
// parameter type, not re-validate it.
type CreateProjectType = Parameters<StudioService['createProject']>[0]['projectType'];
type CreateProjectStatus = NonNullable<Parameters<StudioService['createProject']>[0]['status']>;
