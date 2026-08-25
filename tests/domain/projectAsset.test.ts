import { describe, expect, it } from 'vitest';
import { asAssetId, asProjectId, asSessionId } from '../../src/domain/ids.js';
import { createProjectAsset } from '../../src/domain/projectAsset.js';
import { hashString } from '../../src/crypto/sha256.js';

function baseInput() {
  return {
    id: asAssetId('a1'),
    projectId: asProjectId('p1'),
    introducedBySessionId: asSessionId('s1'),
    assetType: 'audio' as const,
    sourceType: 'human_recorded' as const,
    sha256: hashString('fixture-audio'),
    firstSeenAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('createProjectAsset', () => {
  it('constructs a valid asset with default originStatus', () => {
    const asset = createProjectAsset(baseInput());
    expect(asset.originStatus).toBe('declared');
    expect(asset.rightsStatus).toBeUndefined();
  });

  it('never assigns a rightsStatus unless the caller explicitly provides one', () => {
    const asset = createProjectAsset(baseInput());
    expect('rightsStatus' in asset).toBe(false);
  });

  it('rejects an invalid sha256', () => {
    expect(() => createProjectAsset({ ...baseInput(), sha256: 'not-a-hash' })).toThrow();
  });

  it('rejects an unrecognized assetType', () => {
    expect(() =>
      createProjectAsset({ ...baseInput(), assetType: 'ringtone' as unknown as 'audio' }),
    ).toThrow();
  });

  it('rejects an unrecognized sourceType', () => {
    expect(() =>
      createProjectAsset({ ...baseInput(), sourceType: 'telepathy' as unknown as 'human_recorded' }),
    ).toThrow();
  });

  it('rejects a negative sizeBytes', () => {
    expect(() => createProjectAsset({ ...baseInput(), sizeBytes: -1 })).toThrow();
  });

  it('rejects an unrecognized rightsStatus', () => {
    expect(() =>
      createProjectAsset({ ...baseInput(), rightsStatus: 'made_up' as unknown as 'claimed' }),
    ).toThrow();
  });

  it('accepts a valid, explicitly-provided rightsStatus', () => {
    const asset = createProjectAsset({ ...baseInput(), rightsStatus: 'claimed' });
    expect(asset.rightsStatus).toBe('claimed');
  });

  it('lowercases the stored sha256', () => {
    const upper = hashString('fixture-audio').toUpperCase();
    const asset = createProjectAsset({ ...baseInput(), sha256: upper });
    expect(asset.sha256).toBe(upper.toLowerCase());
  });

  it('distinguishes imported material from creator-generated material via sourceType', () => {
    const imported = createProjectAsset({ ...baseInput(), sourceType: 'commercial_sample_pack' });
    const created = createProjectAsset({ ...baseInput(), sourceType: 'human_created' });
    expect(imported.sourceType).not.toBe(created.sourceType);
  });
});
