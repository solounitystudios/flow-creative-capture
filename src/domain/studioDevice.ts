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
