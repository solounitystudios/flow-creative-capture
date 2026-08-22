import type { DeviceId, ProfileId, ProjectId, SessionId, WorkReferenceId } from './ids.js';
import { DAWS, SESSION_STATUSES, type Daw, type SessionStatus } from './enums.js';

export interface StudioSession {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  readonly workReference?: WorkReferenceId;
  readonly actorProfileId: ProfileId;
  readonly deviceId: DeviceId;
  readonly daw: Daw;
  readonly dawVersion?: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: SessionStatus;
}

export interface StudioSessionInput {
  id: SessionId;
  projectId: ProjectId;
  workReference?: WorkReferenceId;
  actorProfileId: ProfileId;
  deviceId: DeviceId;
  daw: Daw;
  dawVersion?: string;
  startedAt: string;
  endedAt?: string;
  status?: SessionStatus;
}

export function createStudioSession(input: StudioSessionInput): StudioSession {
  if (!DAWS.includes(input.daw)) {
    throw new Error(`StudioSession.daw "${input.daw}" is not recognized`);
  }
  const status = input.status ?? 'active';
  if (!SESSION_STATUSES.includes(status)) {
    throw new Error(`StudioSession.status "${status}" is not recognized`);
  }
  if (input.endedAt !== undefined && input.endedAt < input.startedAt) {
    throw new Error('StudioSession.endedAt cannot precede startedAt');
  }

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    ...(input.workReference !== undefined ? { workReference: input.workReference } : {}),
    actorProfileId: input.actorProfileId,
    deviceId: input.deviceId,
    daw: input.daw,
    ...(input.dawVersion !== undefined ? { dawVersion: input.dawVersion } : {}),
    startedAt: input.startedAt,
    ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
    status,
  });
}

export function endStudioSession(session: StudioSession, endedAt: string): StudioSession {
  if (session.status === 'ended') {
    throw new Error(`StudioSession ${session.id} has already ended`);
  }
  if (endedAt < session.startedAt) {
    throw new Error('StudioSession.endedAt cannot precede startedAt');
  }
  return Object.freeze({ ...session, endedAt, status: 'ended' });
}
