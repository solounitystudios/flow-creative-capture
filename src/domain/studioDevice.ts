import type { DeviceId, ProfileId } from './ids.js';
import { PLATFORMS, type Platform } from './enums.js';

/**
 * A cryptographically-identified installation of a FLOW-aware app or bridge.
 * This is NOT hardware identity — no serial numbers, no MAC addresses.
 * `deviceKeyFingerprint` is derived from a device-generated keypair.
 */
export interface StudioDevice {
  readonly id: DeviceId;
  readonly profileId: ProfileId;
  readonly devicePublicId: string;
  readonly platform: Platform;
  readonly appVersion: string;
  readonly deviceKeyFingerprint: string;
  readonly verifiedAt?: string;
  readonly revokedAt?: string;
}

export interface StudioDeviceInput {
  id: DeviceId;
  profileId: ProfileId;
  devicePublicId: string;
  platform: Platform;
  appVersion: string;
  deviceKeyFingerprint: string;
  verifiedAt?: string;
  revokedAt?: string;
}

export function createStudioDevice(input: StudioDeviceInput): StudioDevice {
  if (!PLATFORMS.includes(input.platform)) {
    throw new Error(`StudioDevice.platform "${input.platform}" is not recognized`);
  }
  if (input.deviceKeyFingerprint.trim().length === 0) {
    throw new Error('StudioDevice.deviceKeyFingerprint must not be empty');
  }

  return Object.freeze({
    id: input.id,
    profileId: input.profileId,
    devicePublicId: input.devicePublicId,
    platform: input.platform,
    appVersion: input.appVersion,
    deviceKeyFingerprint: input.deviceKeyFingerprint,
    ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
    ...(input.revokedAt !== undefined ? { revokedAt: input.revokedAt } : {}),
  });
}

export function isDeviceActive(device: StudioDevice): boolean {
  return device.revokedAt === undefined;
}

/**
 * Marks a device revoked. Returns a NEW record — callers append it to the
 * device's history rather than mutating any previously stored record.
 * Revocation is a local, forward-looking trust decision: it affects
 * whether NEW signatures from this device should be trusted going
 * forward. It never invalidates evidence the device signed while it was
 * still active — see src/device/trust.ts.
 */
export function revokeStudioDevice(device: StudioDevice, revokedAt: string): StudioDevice {
  if (device.revokedAt !== undefined) {
    throw new Error(`StudioDevice ${device.id} is already revoked`);
  }
  return Object.freeze({ ...device, revokedAt });
}
