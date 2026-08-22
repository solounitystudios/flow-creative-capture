import { describe, expect, it } from 'vitest';
import { runColdNightsScenario } from '../../src/simulator/coldNights.js';
import { validateCheckpointChain } from '../../src/provenance/checkpoint.js';
import { getAncestorAssetIds, isAncestorOf } from '../../src/provenance/lineage.js';
import { isSha256Hex } from '../../src/crypto/sha256.js';

describe('Cold Nights golden scenario', () => {
  it('creates the project and its work reference', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.project.title).toBe('Cold Nights');
    expect(scenario.workReference.projectId).toBe(scenario.project.id);
  });

  it('records a NightWire session and a Marcus session', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.nightwireSession.actorProfileId).toBe(scenario.project.ownerProfileId);
    expect(scenario.marcusSession.actorProfileId).not.toBe(scenario.nightwireSession.actorProfileId);
    expect(scenario.nightwireSession.status).toBe('ended');
    expect(scenario.marcusSession.status).toBe('ended');
  });

  it('gives every asset a valid SHA-256 fingerprint', () => {
    const scenario = runColdNightsScenario();
    for (const asset of Object.values(scenario.assets)) {
      expect(isSha256Hex(asset.sha256)).toBe(true);
    }
  });

  it('distinguishes the imported sample from creator-generated material', () => {
    const { assets } = runColdNightsScenario();
    expect(assets.sample.sourceType).toBe('commercial_sample_pack');
    expect(assets.midi.sourceType).toBe('human_created');
    expect(assets.sample.sourceType).not.toBe(assets.midi.sourceType);
  });

  it('forms a valid checkpoint chain', () => {
    const scenario = runColdNightsScenario();
    const result = validateCheckpointChain(scenario.checkpoints);
    expect(result.valid).toBe(true);
    expect(scenario.checkpoints.length).toBeGreaterThanOrEqual(2);
  });

  it('detects tampering with any checkpoint in the chain', () => {
    const scenario = runColdNightsScenario();
    const tamperedIndex = 1;
    const tampered = scenario.checkpoints.map((checkpoint, i) =>
      i === tamperedIndex ? { ...checkpoint, manifestHash: 'a'.repeat(64) } : checkpoint,
    );
    const result = validateCheckpointChain(tampered);
    expect(result.valid).toBe(false);
  });

  it('records the NightWire -> Marcus handoff as accepted', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.handoff.senderProfileId).toBe(scenario.nightwireSession.actorProfileId);
    expect(scenario.handoff.recipientProfileId).toBe(scenario.marcusSession.actorProfileId);
    expect(scenario.handoff.status).toBe('accepted');
  });

  it("attributes Marcus's guitar recording to Marcus's own session", () => {
    const scenario = runColdNightsScenario();
    expect(scenario.assets.guitar.introducedBySessionId).toBe(scenario.marcusSession.id);
    expect(scenario.assets.guitar.createdByProfileId).toBe(scenario.marcusSession.actorProfileId);
  });

  it('produces a final mix and a final master', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.assets.mix.assetType).toBe('mix');
    expect(scenario.assets.master.assetType).toBe('master');
  });

  it('gives the final master traceable lineage back through the mix, stem, MIDI, and guitar', () => {
    const scenario = runColdNightsScenario();
    const ancestors = getAncestorAssetIds(scenario.assets.master.id, scenario.relationships);
    expect(ancestors).toEqual(
      expect.arrayContaining([
        scenario.assets.mix.id,
        scenario.assets.stem.id,
        scenario.assets.midi.id,
        scenario.assets.guitar.id,
        scenario.assets.sample.id,
      ]),
    );
    expect(isAncestorOf(scenario.assets.guitar.id, scenario.assets.master.id, scenario.relationships)).toBe(true);
  });

  it('designates a release candidate that references the correct master asset', () => {
    const scenario = runColdNightsScenario();
    expect(scenario.releaseCandidate.assetId).toBe(scenario.assets.master.id);
    expect(scenario.releaseCandidate.status).toBe('designated');
  });

  it('never infers rights ownership from provenance data', () => {
    const scenario = runColdNightsScenario();
    for (const asset of Object.values(scenario.assets)) {
      expect('rightsStatus' in asset).toBe(false);
    }
    // Nothing in the scenario produces a RightsClaimReference — provenance
    // evidence alone must never manufacture a rights claim.
  });

  it('is deterministic given the same seed timestamp', () => {
    const a = runColdNightsScenario('2026-01-05T18:00:00.000Z');
    const b = runColdNightsScenario('2026-01-05T18:00:00.000Z');
    expect(a.checkpoints.at(-1)?.checkpointHash).toBe(b.checkpoints.at(-1)?.checkpointHash);
    expect(a.assets.master.sha256).toBe(b.assets.master.sha256);
  });
});
