/**
 * Capture Studio V2's checkpoint-trigger policy — deliberately small and
 * centralized in this one file, per AGENTS.md's "smallest safe coherent
 * diff" and the V2 mission brief's "do not scatter trigger decisions
 * throughout unrelated HTTP handlers."
 *
 * V2 supports checkpoint creation for:
 *  - `manual` (default) and any other `CheckpointTriggerType` (including
 *    `major_import`, `project_save`, ...) — always explicit, always via
 *    `StudioService.createCheckpoint`/`POST .../checkpoints`. Asset
 *    ingestion does NOT automatically cut a checkpoint on every upload
 *    (that would produce a checkpoint per file and defeat the point of a
 *    checkpoint as a meaningful evidence boundary) — the Studio UI/caller
 *    is expected to request one explicitly (e.g. with `triggerType:
 *    'major_import'`) after a batch of ingestion is done.
 *  - `session_end` — the ONE automatic trigger V2 fires on its own, from
 *    exactly one call site (`StudioService.endSession`). This function is
 *    the single policy decision that call site consults.
 *
 * A future V2.x/V3 can add interval/activity-based checkpointing; this
 * function is the one place that would need to grow, not a new decision
 * point scattered elsewhere.
 */
export function shouldAutoCheckpointOnSessionEnd(eventIdCountSincePreviousCheckpoint: number): boolean {
  // Avoids a checkpoint on every trivial session end (e.g. a session that
  // was started and immediately ended with no captured activity) — a
  // checkpoint should mark a meaningful evidence boundary, not every
  // lifecycle transition. See PROVENANCE_SPEC.md §1 ("meaningful events,
  // not surveillance") — the same principle applied to checkpoints.
  return eventIdCountSincePreviousCheckpoint > 0;
}
