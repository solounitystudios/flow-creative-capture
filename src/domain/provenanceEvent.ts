import type { JsonValue } from '../crypto/json.js';
import type { AssetId, DeviceId, EventId, ProfileId, ProjectId, SessionId, WorkReferenceId } from './ids.js';
import { EVENT_SOURCES, EVENT_TYPES, type EventSource, type EventType } from './enums.js';

/**
 * The canonical provenance event. Every DAW bridge, Studio Companion
 * action, and the simulator all produce exactly this shape — there is no
 * per-source variant. See PROVENANCE_SPEC.md for the full contract.
 */
export interface ProvenanceEvent {
  readonly eventId: EventId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly sessionId: SessionId;
  readonly actorProfileId: ProfileId;
  readonly deviceId: DeviceId;
  readonly source: EventSource;
  readonly eventType: EventType;
  readonly assetId?: AssetId;
  readonly trackReference?: string;
  readonly occurredAt: string;
  readonly receivedAt?: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
}

export interface ProvenanceEventInput {
  eventId: EventId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  sessionId: SessionId;
  actorProfileId: ProfileId;
  deviceId: DeviceId;
  source: EventSource;
  eventType: EventType;
  assetId?: AssetId;
  trackReference?: string;
  occurredAt: string;
  receivedAt?: string;
  payload?: Readonly<Record<string, JsonValue>>;
}

export function createProvenanceEvent(input: ProvenanceEventInput): ProvenanceEvent {
  if (!EVENT_SOURCES.includes(input.source)) {
    throw new Error(`ProvenanceEvent.source "${input.source}" is not recognized`);
  }
  if (!EVENT_TYPES.includes(input.eventType)) {
    throw new Error(`ProvenanceEvent.eventType "${input.eventType}" is not recognized`);
  }
  if (input.receivedAt !== undefined && input.receivedAt < input.occurredAt) {
    throw new Error('ProvenanceEvent.receivedAt cannot precede occurredAt — never claim a delayed upload was live');
  }

  return Object.freeze({
    eventId: input.eventId,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    sessionId: input.sessionId,
    actorProfileId: input.actorProfileId,
    deviceId: input.deviceId,
    source: input.source,
    eventType: input.eventType,
    ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
    ...(input.trackReference !== undefined ? { trackReference: input.trackReference } : {}),
    occurredAt: input.occurredAt,
    ...(input.receivedAt !== undefined ? { receivedAt: input.receivedAt } : {}),
    payload: Object.freeze({ ...(input.payload ?? {}) }),
  });
}
