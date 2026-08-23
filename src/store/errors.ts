/**
 * Thrown when an insert targets a fact table's existing primary key with
 * content that differs from what is already stored. Re-inserting the
 * EXACT same content for an id that already exists is treated as an
 * idempotent no-op instead (see `InsertResult` in evidenceStore.ts) — a
 * deliberate choice so a crashed-and-retried local capture process doesn't
 * fail merely for repeating itself. A conflicting record — same id,
 * different content — is never silently accepted or used to overwrite the
 * original; it always throws this error instead.
 */
export class StoreConflictError extends Error {
  constructor(
    public readonly table: string,
    public readonly id: string,
  ) {
    super(
      `${table} already has a row for id "${id}" with different content. ` +
        'Refusing to overwrite existing evidence — this store never mutates a previously accepted record.',
    );
    this.name = 'StoreConflictError';
  }
}
