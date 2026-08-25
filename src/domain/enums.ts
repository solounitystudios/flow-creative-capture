/**
 * Controlled vocabularies for the provenance domain. Kept as const arrays
 * (not free string unions scattered across files) so validation and
 * documentation stay in one place.
 */

export const PROJECT_TYPES = ['song', 'album', 'score', 'sound_design', 'other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PLATFORMS = ['macos', 'windows', 'linux', 'ios', 'ipados', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DAWS = [
  'logic_pro',
  'fl_studio',
  'ableton_live',
  'pro_tools',
  'studio_one',
  'cubase',
  'reaper',
  'other',
] as const;
export type Daw = (typeof DAWS)[number];

export const SESSION_STATUSES = ['active', 'ended', 'abandoned'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Origin of a canonical provenance event. Every future DAW bridge adds one
 * value here. `capture_studio` is the local Capture Studio service (the
 * minimal, real Studio Companion boundary added in Capture Studio V1 —
 * see `apps/capture-studio/service`) — distinct from `flow_companion`,
 * which represents a future flow-platform-side companion app, not this
 * repository's own local write path.
 */
export const EVENT_SOURCES = [
  'studio_simulator',
  'flow_companion',
  'capture_studio',
  'logic_pro',
  'fl_studio',
  'ableton_live',
  'pro_tools',
  'studio_one',
  'cubase',
  'reaper',
  'historical_import',
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/**
 * Canonical event types. This is the vocabulary EVERY DAW bridge must
 * translate its native activity into. It is intentionally coarse — see
 * PROVENANCE_SPEC.md "Meaningful Events, Not Surveillance".
 */
export const EVENT_TYPES = [
  'session_started',
  'session_ended',
  'project_opened',
  'project_saved',
  'track_created',
  'asset_created',
  'asset_imported',
  'asset_modified',
  'asset_removed',
  'audio_recorded',
  'midi_created',
  'plugin_chain_changed',
  'stem_exported',
  'mix_exported',
  'master_exported',
  'checkpoint_created',
  'contributor_added',
  'handoff_created',
  'handoff_accepted',
  'final_master_designated',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ASSET_TYPES = [
  'audio',
  'midi',
  'daw_project',
  'stem',
  'mix',
  'master',
  'sample',
  'preset',
  'image',
  'video',
  'document',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const SOURCE_TYPES = [
  'human_created',
  'human_recorded',
  'collaborator_supplied',
  'licensed_sample',
  'royalty_free_sample',
  'commercial_sample_pack',
  'ai_generated',
  'ai_assisted',
  'imported_unknown',
  'unknown',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ORIGIN_STATUSES = ['declared', 'supported', 'verified', 'disputed', 'unknown'] as const;
export type OriginStatus = (typeof ORIGIN_STATUSES)[number];

export const ASSET_RELATIONSHIP_TYPES = [
  'derived_from',
  'edited_from',
  'exported_from',
  'mixed_into',
  'mastered_from',
  'contains',
  'replaced_by',
] as const;
export type AssetRelationshipType = (typeof ASSET_RELATIONSHIP_TYPES)[number];

export const CHECKPOINT_TRIGGER_TYPES = [
  'manual',
  'project_save',
  'session_end',
  'recording_batch',
  'major_import',
  'export',
  'handoff',
  'final_mix',
  'final_master',
] as const;
export type CheckpointTriggerType = (typeof CHECKPOINT_TRIGGER_TYPES)[number];

export const BATCH_VALIDATION_STATUSES = ['pending', 'valid', 'invalid', 'partially_valid'] as const;
export type BatchValidationStatus = (typeof BATCH_VALIDATION_STATUSES)[number];

export const HANDOFF_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'revoked'] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const RELEASE_CANDIDATE_STATUSES = ['proposed', 'designated', 'superseded', 'withdrawn'] as const;
export type ReleaseCandidateStatus = (typeof RELEASE_CANDIDATE_STATUSES)[number];

export const RIGHTS_TYPES = [
  'master',
  'composition',
  'publishing',
  'performance',
  'sample_license',
  'work_for_hire',
  'other',
] as const;
export type RightsType = (typeof RIGHTS_TYPES)[number];

export const RIGHTS_VERIFICATION_STATUSES = ['claimed', 'under_review', 'verified', 'disputed', 'rejected'] as const;
export type RightsVerificationStatus = (typeof RIGHTS_VERIFICATION_STATUSES)[number];
