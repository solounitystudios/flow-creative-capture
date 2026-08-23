import type { KeyObject } from 'node:crypto';
import { canonicalize } from '../crypto/canonical.js';
import type { JsonValue } from '../crypto/json.js';
import { asDeviceId, type DeviceId, type ProfileId } from '../domain/ids.js';
import type { Platform } from '../domain/enums.js';
import { createStudioDevice, revokeStudioDevice, type StudioDevice } from '../domain/studioDevice.js';
import type { DeviceKeyStore } from './keyStore.js';
import {
  deriveDeviceKeyFingerprint,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generateDeviceKeyPair,
  importPrivateKeyPkcs8,
  importPublicKeySpki,
  signBytes,
  verifyBytes,
} from './keypair.js';

/**
 * A device's live signing capability, bound to one keypair. The private
 * key material never leaves this object — nothing in the domain layer
 * (StudioDevice) ever carries private key bytes, only the public
 * fingerprint. See src/device/keyStore.ts for the current (dev-grade)
 * storage implementation level.
 */
export interface DeviceIdentity {
  readonly deviceId: DeviceId;
  readonly publicKeySpkiDer: Buffer;
  readonly fingerprint: string;
  signCanonical(payload: JsonValue): string;
  signBytes(message: Uint8Array): Buffer;
}

function buildIdentity(deviceId: DeviceId, publicKey: KeyObject, privateKey: KeyObject): DeviceIdentity {
  const publicKeySpkiDer = exportPublicKeySpki(publicKey);
  const fingerprint = deriveDeviceKeyFingerprint(publicKey);
  const identity: DeviceIdentity = {
    deviceId,
    publicKeySpkiDer,
    fingerprint,
    signCanonical(payload: JsonValue): string {
      return signBytes(privateKey, Buffer.from(canonicalize(payload), 'utf8')).toString('base64');
    },
    signBytes(message: Uint8Array): Buffer {
      return signBytes(privateKey, message);
    },
  };
  return Object.freeze(identity);
}

export interface CreateDeviceIdentityOptions {
  profileId: ProfileId;
  platform: Platform;
  appVersion: string;
  deviceId?: DeviceId;
  devicePublicId?: string;
  verifiedAt?: string;
}

export interface DeviceIdentityResult {
  readonly device: StudioDevice;
  readonly identity: DeviceIdentity;
}

/**
 * Generates a brand-new device keypair, persists the private key via the
 * given `DeviceKeyStore`, and returns the resulting `StudioDevice` record
 * plus a live `DeviceIdentity` for signing. `devicePublicId` and the
 * device's fingerprint are both derived deterministically from the same
 * public key so they never disagree.
 */
export function createDeviceIdentity(
  keyStore: DeviceKeyStore,
  options: CreateDeviceIdentityOptions,
): DeviceIdentityResult {
  const { publicKey, privateKey } = generateDeviceKeyPair();
  const fingerprint = deriveDeviceKeyFingerprint(publicKey);
  const deviceId = options.deviceId ?? asDeviceId(`device-${fingerprint.slice(0, 24)}`);
  const devicePublicId = options.devicePublicId ?? `pub-${fingerprint.slice(0, 32)}`;

  keyStore.save(deviceId, {
    publicKeySpkiDer: exportPublicKeySpki(publicKey),
    privateKeyPkcs8Der: exportPrivateKeyPkcs8(privateKey),
  });

  const device = createStudioDevice({
    id: deviceId,
    profileId: options.profileId,
    devicePublicId,
    platform: options.platform,
    appVersion: options.appVersion,
    deviceKeyFingerprint: fingerprint,
    ...(options.verifiedAt !== undefined ? { verifiedAt: options.verifiedAt } : {}),
  });

  return { device, identity: buildIdentity(deviceId, publicKey, privateKey) };
}

/** Loads a previously created device's signing identity from the key store. Returns undefined if no key material is stored for this device id. */
export function loadDeviceIdentity(keyStore: DeviceKeyStore, deviceId: DeviceId): DeviceIdentity | undefined {
  const material = keyStore.load(deviceId);
  if (material === undefined) {
    return undefined;
  }
  const publicKey = importPublicKeySpki(material.publicKeySpkiDer);
  const privateKey = importPrivateKeyPkcs8(material.privateKeyPkcs8Der);
  return buildIdentity(deviceId, publicKey, privateKey);
}

/**
 * Verifies a canonical payload's signature against a raw public key
 * (SPKI DER) — used to check a signature produced by *another* device's
 * identity, where only the public key is available, not a live
 * `DeviceIdentity`.
 */
export function verifyCanonicalSignature(publicKeySpkiDer: Buffer, payload: JsonValue, signatureBase64: string): boolean {
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch {
    return false;
  }
  if (signature.length === 0) {
    return false;
  }
  const publicKey = importPublicKeySpki(publicKeySpkiDer);
  return verifyBytes(publicKey, Buffer.from(canonicalize(payload), 'utf8'), signature);
}

export { revokeStudioDevice };
