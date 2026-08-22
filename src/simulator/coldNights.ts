import { hashString } from '../crypto/sha256.js';
import {
  asAssetId,
  asAssetRelationshipId,
  asCheckpointId,
  asDeviceId,
  asEventId,
  asHandoffId,
  asProfileId,
  asProjectId,
  asReleaseCandidateId,
  asSessionId,
  asWorkReferenceId,
} from '../domain/ids.js';
import { createCreativeProject, type CreativeProject } from '../domain/creativeProject.js';
import { createWorkReference, type WorkReference } from '../domain/workReference.js';
import { createStudioDevice, type StudioDevice } from '../domain/studioDevice.js';
import { createStudioSession, endStudioSession, type StudioSession } from '../domain/studioSession.js';
import { createProvenanceEvent, type ProvenanceEvent } from '../domain/provenanceEvent.js';
import { createProjectAsset, type ProjectAsset } from '../domain/projectAsset.js';
import { createAssetRelationship, type AssetRelationship } from '../domain/assetRelationship.js';
import { createContributorReference, type ContributorReference } from '../domain/contributorReference.js';
import {
  acceptProjectHandoff,
  createProjectHandoff,
  type ProjectHandoff,
} from '../domain/projectHandoff.js';
import {
  createReleaseCandidate,
  designateReleaseCandidate,
  type ReleaseCandidate,
} from '../domain/releaseCandidate.js';
import type { ProvenanceCheckpoint } from '../domain/provenanceCheckpoint.js';
import { createCheckpointFromManifest } from '../provenance/checkpoint.js';
import type { CheckpointManifestAssetEntry } from '../provenance/manifest.js';
import { createDeterministicClock } from './clock.js';

export interface ColdNightsScenario {
  readonly project: CreativeProject;
  readonly workReference: WorkReference;
  readonly nightwireDevice: StudioDevice;
  readonly marcusDevice: StudioDevice;
  readonly nightwireSession: StudioSession;
  readonly marcusSession: StudioSession;
  readonly contributors: readonly ContributorReference[];
  readonly events: readonly ProvenanceEvent[];
  readonly assets: {
    readonly midi: ProjectAsset;
    readonly sample: ProjectAsset;
    readonly stem: ProjectAsset;
    readonly guitar: ProjectAsset;
    readonly mix: ProjectAsset;
    readonly master: ProjectAsset;
  };
  readonly relationships: readonly AssetRelationship[];
  readonly checkpoints: readonly ProvenanceCheckpoint[];
  readonly handoff: ProjectHandoff;
  readonly releaseCandidate: ReleaseCandidate;
}

/** Fabricates a deterministic fingerprint for a simulated asset's content. */
function fakeContentHash(label: string): string {
  return hashString(`cold-nights-fixture:${label}`);
}

/**
 * Runs the "Cold Nights" golden scenario: NightWire builds a beat, hands
 * the project to Marcus, Marcus records guitar over it, and a final mix
 * and master are produced and designated. Every step goes through the same
 * canonical domain contracts a real DAW bridge would use — no shortcuts.
 */
export function runColdNightsScenario(seedTimestamp = '2026-01-05T18:00:00.000Z'): ColdNightsScenario {
  const clock = createDeterministicClock(seedTimestamp);

  const nightwireProfileId = asProfileId('profile-nightwire');
  const marcusProfileId = asProfileId('profile-marcus');

  const project = createCreativeProject({
    id: asProjectId('project-cold-nights'),
    ownerProfileId: nightwireProfileId,
    title: 'Cold Nights',
    projectType: 'song',
    status: 'active',
    createdAt: clock(),
    updatedAt: clock(),
  });

  const workReference = createWorkReference({
    id: asWorkReferenceId('work-cold-nights'),
    projectId: project.id,
    title: 'Cold Nights',
    createdAt: clock(),
  });

  const contributors: ContributorReference[] = [
    createContributorReference({ profileId: nightwireProfileId, role: 'producer', subrole: 'producer' }),
    createContributorReference({ profileId: nightwireProfileId, role: 'songwriter', subrole: 'melody' }),
    createContributorReference({ profileId: marcusProfileId, role: 'musician', subrole: 'lead_guitar' }),
  ];

  const nightwireDevice = createStudioDevice({
    id: asDeviceId('device-nightwire-01'),
    profileId: nightwireProfileId,
    devicePublicId: 'pub-nightwire-01',
    platform: 'macos',
    appVersion: '1.0.0-sim',
    deviceKeyFingerprint: hashString('device-key:nightwire-01'),
    verifiedAt: clock(),
  });

  const marcusDevice = createStudioDevice({
    id: asDeviceId('device-marcus-01'),
    profileId: marcusProfileId,
    devicePublicId: 'pub-marcus-01',
    platform: 'windows',
    appVersion: '1.0.0-sim',
    deviceKeyFingerprint: hashString('device-key:marcus-01'),
    verifiedAt: clock(),
  });

  const events: ProvenanceEvent[] = [];
  const relationships: AssetRelationship[] = [];
  const checkpoints: ProvenanceCheckpoint[] = [];
  const manifestAssets: CheckpointManifestAssetEntry[] = [];
  let checkpointSequence = 0;
  let previousCheckpointHash: string | undefined;
  const manifestEventIds: (typeof events)[number]['eventId'][] = [];

  function recordEvent(event: ProvenanceEvent): ProvenanceEvent {
    events.push(event);
    manifestEventIds.push(event.eventId);
    return event;
  }

  function cutCheckpoint(
    sessionId: StudioSession['id'],
    actorProfileId: CreativeProject['ownerProfileId'],
    triggerType: Parameters<typeof createCheckpointFromManifest>[0]['triggerType'],
  ): ProvenanceCheckpoint {
    const checkpoint = createCheckpointFromManifest({
      id: asCheckpointId(`checkpoint-${checkpointSequence}`),
      projectId: project.id,
      workReference: workReference.id,
      sessionId,
      actorProfileId,
      sequence: checkpointSequence,
      ...(previousCheckpointHash !== undefined ? { previousCheckpointHash } : {}),
      manifest: { projectId: project.id, assets: [...manifestAssets], eventIds: [...manifestEventIds] },
      triggerType,
      createdAt: clock(),
    });
    checkpoints.push(checkpoint);
    previousCheckpointHash = checkpoint.checkpointHash;
    checkpointSequence += 1;
    manifestEventIds.length = 0;
    return checkpoint;
  }

  // --- 3. NightWire starts a Studio Session ---------------------------------
  const nightwireSessionStart = clock();
  let nightwireSession = createStudioSession({
    id: asSessionId('session-nightwire-01'),
    projectId: project.id,
    workReference: workReference.id,
    actorProfileId: nightwireProfileId,
    deviceId: nightwireDevice.id,
    daw: 'fl_studio',
    dawVersion: '21.0',
    startedAt: nightwireSessionStart,
  });
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-session-started-nightwire'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'session_started',
      occurredAt: nightwireSessionStart,
    }),
  );
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-contributor-nightwire'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'contributor_added',
      occurredAt: clock(),
      payload: { profileId: nightwireProfileId, role: 'producer' },
    }),
  );

  // --- 4. NightWire creates MIDI ---------------------------------------------
  const midi = createProjectAsset({
    id: asAssetId('asset-midi-beat'),
    projectId: project.id,
    workReference: workReference.id,
    createdByProfileId: nightwireProfileId,
    introducedBySessionId: nightwireSession.id,
    assetType: 'midi',
    sourceType: 'human_created',
    originalFilename: 'cold_nights_beat.mid',
    sha256: fakeContentHash('midi-beat-v1'),
    firstSeenAt: clock(),
    originStatus: 'declared',
  });
  manifestAssets.push({ assetId: midi.id, sha256: midi.sha256, assetType: midi.assetType });
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-midi-created'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'midi_created',
      assetId: midi.id,
      trackReference: 'track-1-beat',
      occurredAt: clock(),
    }),
  );

  // --- 5. NightWire imports a sample -----------------------------------------
  const sample = createProjectAsset({
    id: asAssetId('asset-sample-pad'),
    projectId: project.id,
    workReference: workReference.id,
    introducedBySessionId: nightwireSession.id,
    assetType: 'sample',
    sourceType: 'commercial_sample_pack',
    originalFilename: 'ambient_pad_C.wav',
    sha256: fakeContentHash('sample-pad-v1'),
    firstSeenAt: clock(),
    originStatus: 'declared',
  });
  manifestAssets.push({ assetId: sample.id, sha256: sample.sha256, assetType: sample.assetType });
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-sample-imported'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'asset_imported',
      assetId: sample.id,
      trackReference: 'track-2-pad',
      occurredAt: clock(),
    }),
  );

  // --- 6. Checkpoint #1 -------------------------------------------------------
  const checkpoint1 = cutCheckpoint(nightwireSession.id, nightwireProfileId, 'recording_batch');
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-checkpoint-1'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'checkpoint_created',
      occurredAt: clock(),
      payload: { checkpointId: checkpoint1.id },
    }),
  );

  // --- 7. NightWire exports the beat as a stem --------------------------------
  const stem = createProjectAsset({
    id: asAssetId('asset-stem-beat'),
    projectId: project.id,
    workReference: workReference.id,
    createdByProfileId: nightwireProfileId,
    introducedBySessionId: nightwireSession.id,
    assetType: 'stem',
    sourceType: 'human_created',
    originalFilename: 'cold_nights_beat_stem.wav',
    sha256: fakeContentHash('stem-beat-v1'),
    firstSeenAt: clock(),
    originStatus: 'declared',
  });
  manifestAssets.push({ assetId: stem.id, sha256: stem.sha256, assetType: stem.assetType });
  relationships.push(
    createAssetRelationship({
      id: asAssetRelationshipId('rel-midi-to-stem'),
      fromAssetId: midi.id,
      toAssetId: stem.id,
      relationshipType: 'derived_from',
      createdAt: clock(),
    }),
  );
  relationships.push(
    createAssetRelationship({
      id: asAssetRelationshipId('rel-sample-to-stem'),
      fromAssetId: sample.id,
      toAssetId: stem.id,
      relationshipType: 'contains',
      createdAt: clock(),
    }),
  );
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-stem-exported'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'stem_exported',
      assetId: stem.id,
      occurredAt: clock(),
    }),
  );

  // --- 8. NightWire ends session ----------------------------------------------
  const nightwireSessionEnd = clock();
  nightwireSession = endStudioSession(nightwireSession, nightwireSessionEnd);
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-session-ended-nightwire'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'fl_studio',
      eventType: 'session_ended',
      occurredAt: nightwireSessionEnd,
    }),
  );

  // --- 9 & 10. Handoff NightWire -> Marcus, accepted --------------------------
  const handoffSentAt = clock();
  let handoff = createProjectHandoff({
    id: asHandoffId('handoff-nightwire-to-marcus'),
    projectId: project.id,
    workReference: workReference.id,
    senderProfileId: nightwireProfileId,
    recipientProfileId: marcusProfileId,
    checkpointId: checkpoint1.id,
    manifestHash: checkpoint1.manifestHash,
    sentAt: handoffSentAt,
  });
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-handoff-created'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: nightwireSession.id,
      actorProfileId: nightwireProfileId,
      deviceId: nightwireDevice.id,
      source: 'flow_companion',
      eventType: 'handoff_created',
      occurredAt: handoffSentAt,
      payload: { handoffId: handoff.id },
    }),
  );

  const handoffAcceptedAt = clock();
  handoff = acceptProjectHandoff(handoff, handoffAcceptedAt);

  // --- 11. Marcus starts a Studio Session -------------------------------------
  const marcusSessionStart = clock();
  let marcusSession = createStudioSession({
    id: asSessionId('session-marcus-01'),
    projectId: project.id,
    workReference: workReference.id,
    actorProfileId: marcusProfileId,
    deviceId: marcusDevice.id,
    daw: 'logic_pro',
    dawVersion: '11.0',
    startedAt: marcusSessionStart,
  });
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-handoff-accepted'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'flow_companion',
      eventType: 'handoff_accepted',
      occurredAt: handoffAcceptedAt,
      payload: { handoffId: handoff.id },
    }),
  );
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-session-started-marcus'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'session_started',
      occurredAt: marcusSessionStart,
    }),
  );
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-contributor-marcus'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'contributor_added',
      occurredAt: clock(),
      payload: { profileId: marcusProfileId, role: 'musician', subrole: 'lead_guitar' },
    }),
  );

  // --- 12. Marcus records guitar -----------------------------------------------
  const guitar = createProjectAsset({
    id: asAssetId('asset-guitar-take'),
    projectId: project.id,
    workReference: workReference.id,
    createdByProfileId: marcusProfileId,
    introducedBySessionId: marcusSession.id,
    assetType: 'audio',
    sourceType: 'human_recorded',
    originalFilename: 'guitar_lead_take.wav',
    sha256: fakeContentHash('guitar-take-v1'),
    firstSeenAt: clock(),
    originStatus: 'declared',
  });
  manifestAssets.push({ assetId: guitar.id, sha256: guitar.sha256, assetType: guitar.assetType });
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-guitar-recorded'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'audio_recorded',
      assetId: guitar.id,
      trackReference: 'track-3-guitar',
      occurredAt: clock(),
    }),
  );

  // --- 13. Checkpoint #2 --------------------------------------------------------
  const checkpoint2 = cutCheckpoint(marcusSession.id, marcusProfileId, 'recording_batch');
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-checkpoint-2'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'checkpoint_created',
      occurredAt: clock(),
      payload: { checkpointId: checkpoint2.id },
    }),
  );

  // --- 14. Marcus ends session ---------------------------------------------------
  const marcusSessionEnd = clock();
  marcusSession = endStudioSession(marcusSession, marcusSessionEnd);
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-session-ended-marcus'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'session_ended',
      occurredAt: marcusSessionEnd,
    }),
  );

  // --- 15. Final mix -------------------------------------------------------------
  const mix = createProjectAsset({
    id: asAssetId('asset-final-mix'),
    projectId: project.id,
    workReference: workReference.id,
    createdByProfileId: marcusProfileId,
    introducedBySessionId: marcusSession.id,
    assetType: 'mix',
    sourceType: 'human_created',
    originalFilename: 'cold_nights_final_mix.wav',
    sha256: fakeContentHash('final-mix-v1'),
    firstSeenAt: clock(),
    originStatus: 'declared',
  });
  manifestAssets.push({ assetId: mix.id, sha256: mix.sha256, assetType: mix.assetType });
  relationships.push(
    createAssetRelationship({
      id: asAssetRelationshipId('rel-stem-to-mix'),
      fromAssetId: stem.id,
      toAssetId: mix.id,
      relationshipType: 'mixed_into',
      createdAt: clock(),
    }),
  );
  relationships.push(
    createAssetRelationship({
      id: asAssetRelationshipId('rel-guitar-to-mix'),
      fromAssetId: guitar.id,
      toAssetId: mix.id,
      relationshipType: 'mixed_into',
      createdAt: clock(),
    }),
  );
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-mix-exported'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'mix_exported',
      assetId: mix.id,
      occurredAt: clock(),
    }),
  );

  // --- 16. Final master ------------------------------------------------------------
  const master = createProjectAsset({
    id: asAssetId('asset-final-master'),
    projectId: project.id,
    workReference: workReference.id,
    createdByProfileId: marcusProfileId,
    introducedBySessionId: marcusSession.id,
    assetType: 'master',
    sourceType: 'human_created',
    originalFilename: 'cold_nights_final_master.wav',
    sha256: fakeContentHash('final-master-v1'),
    firstSeenAt: clock(),
    originStatus: 'declared',
  });
  manifestAssets.push({ assetId: master.id, sha256: master.sha256, assetType: master.assetType });
  // --- 17. Link asset lineage -------------------------------------------------------
  relationships.push(
    createAssetRelationship({
      id: asAssetRelationshipId('rel-mix-to-master'),
      fromAssetId: mix.id,
      toAssetId: master.id,
      relationshipType: 'mastered_from',
      createdAt: clock(),
    }),
  );
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-master-exported'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'master_exported',
      assetId: master.id,
      occurredAt: clock(),
    }),
  );

  // Checkpoint #3 captures the final-mix/final-master state.
  const checkpoint3 = cutCheckpoint(marcusSession.id, marcusProfileId, 'final_master');
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-checkpoint-3'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'checkpoint_created',
      occurredAt: clock(),
      payload: { checkpointId: checkpoint3.id },
    }),
  );

  // --- 18. Designate final master ----------------------------------------------------
  let releaseCandidate = createReleaseCandidate({
    id: asReleaseCandidateId('release-candidate-v1'),
    projectId: project.id,
    workReference: workReference.id,
    assetId: master.id,
    checkpointId: checkpoint3.id,
    versionLabel: 'Master v1',
    designatedBy: marcusProfileId,
    designatedAt: clock(),
  });
  releaseCandidate = designateReleaseCandidate(releaseCandidate);
  recordEvent(
    createProvenanceEvent({
      eventId: asEventId('event-final-master-designated'),
      projectId: project.id,
      workReference: workReference.id,
      sessionId: marcusSession.id,
      actorProfileId: marcusProfileId,
      deviceId: marcusDevice.id,
      source: 'logic_pro',
      eventType: 'final_master_designated',
      assetId: master.id,
      occurredAt: clock(),
      payload: { releaseCandidateId: releaseCandidate.id },
    }),
  );

  return Object.freeze({
    project,
    workReference,
    nightwireDevice,
    marcusDevice,
    nightwireSession,
    marcusSession,
    contributors: Object.freeze(contributors),
    events: Object.freeze(events),
    assets: Object.freeze({ midi, sample, stem, guitar, mix, master }),
    relationships: Object.freeze(relationships),
    checkpoints: Object.freeze(checkpoints),
    handoff,
    releaseCandidate,
  });
}
