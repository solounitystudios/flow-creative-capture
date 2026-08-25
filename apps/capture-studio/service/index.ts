import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioHttpServer } from './http.js';
import { StudioService } from './studioService.js';

/**
 * Entrypoint for the local Studio service (`npm run studio-service`,
 * see `apps/capture-studio/package.json`). Run with `tsx` alongside
 * `npm run dev` — the browser Capture Studio UI talks to this over HTTP;
 * see `studioService.ts`'s docstring for the full boundary statement.
 *
 * Local-first only: this binds to `127.0.0.1`, never `0.0.0.0`, and CORS
 * is restricted to one explicit allowed origin. No authentication exists
 * because none is needed yet — this is a same-machine, single-user local
 * service, not a network-exposed one. That is a deliberate V1 boundary,
 * not an oversight; see the pass's own "explicitly out of scope" list
 * (no network auth, no cloud sync).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env['STUDIO_SERVICE_PORT'] ?? 4756);
const ALLOWED_ORIGIN = process.env['STUDIO_SERVICE_ALLOWED_ORIGIN'] ?? 'http://localhost:5173';
const DATA_DIR = process.env['STUDIO_SERVICE_DATA_DIR'] ?? join(__dirname, '..', '.studio-data');

const service = new StudioService(DATA_DIR);
const server = createStudioHttpServer(service, { allowedOrigin: ALLOWED_ORIGIN });

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Capture Studio service listening on http://127.0.0.1:${PORT} (data: ${DATA_DIR})`);
});

function shutdown(): void {
  server.close(() => {
    service.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
