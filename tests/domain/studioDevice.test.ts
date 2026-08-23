import { describe, expect, it } from 'vitest';
import { asDeviceId, asProfileId } from '../../src/domain/ids.js';
import { createStudioDevice, isDeviceActive, revokeStudioDevice } from '../../src/domain/studioDevice.js';

function makeDevice() {
  return createStudioDevice({
    id: asDeviceId('device-1'),
    profileId: asProfileId('profile-1'),
    devicePublicId: 'pub-1',
    platform: 'macos',
    appVersion: '1.0.0',
    deviceKeyFingerprint: 'f'.repeat(64),
  });
}

describe('StudioDevice revocation', () => {
  it('is active by default and becomes inactive once revoked', () => {
    const device = makeDevice();
    expect(isDeviceActive(device)).toBe(true);

    const revoked = revokeStudioDevice(device, '2026-01-01T00:00:00.000Z');
    expect(revoked.revokedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(isDeviceActive(revoked)).toBe(false);
  });

  it('returns a new record rather than mutating the original — the original stays unrevoked', () => {
    const device = makeDevice();
    const revoked = revokeStudioDevice(device, '2026-01-01T00:00:00.000Z');
    expect(revoked).not.toBe(device);
    expect(device.revokedAt).toBeUndefined();
    expect(isDeviceActive(device)).toBe(true);
  });

  it('preserves every other field unchanged when revoking', () => {
    const device = makeDevice();
    const revoked = revokeStudioDevice(device, '2026-01-01T00:00:00.000Z');
    expect(revoked.id).toBe(device.id);
    expect(revoked.profileId).toBe(device.profileId);
    expect(revoked.devicePublicId).toBe(device.devicePublicId);
    expect(revoked.deviceKeyFingerprint).toBe(device.deviceKeyFingerprint);
  });

  it('rejects revoking an already-revoked device (no double revocation)', () => {
    const device = makeDevice();
    const revoked = revokeStudioDevice(device, '2026-01-01T00:00:00.000Z');
    expect(() => revokeStudioDevice(revoked, '2026-02-01T00:00:00.000Z')).toThrow();
  });
});
