/**
 * The one error type this service's HTTP layer treats specially: a known,
 * client-facing failure with an explicit HTTP status code and a message
 * that is safe to return as-is (never a stack trace, never an internal
 * path). Anything else thrown (a domain factory's plain `Error`, e.g.
 * `CreativeProject.title must not be empty`) is still surfaced to the
 * client as 400 with its own `.message` — those messages are already
 * written to be read by a caller — but an unexpected, non-`Error` throw
 * or a genuine bug maps to a generic 500 with no message detail, logged
 * server-side only. See `service/http.ts`'s error handling.
 */
export class StudioServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'StudioServiceError';
  }
}

export function notFound(message: string): StudioServiceError {
  return new StudioServiceError(message, 404);
}

export function badRequest(message: string): StudioServiceError {
  return new StudioServiceError(message, 400);
}
