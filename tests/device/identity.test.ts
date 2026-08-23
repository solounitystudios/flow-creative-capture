import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asDeviceId, asProfileId } from '../../src/domain/ids.js';
import {
  createDeviceIdentity,
  loadDeviceIdentity,
  verifyCanonicalSignature,
} from '../../src/device/identity.js';
import { FileDeviceKeyStore } from '../../src/device/keyStore.js';

/**
 * These tests prove DeviceIdentity correctly binds a device id to a real
 * keypair and that its signatures verify. They do NOT — and cannot — prove
 * anything about who physically operated the device or that its private
 * key has never been copied. A DeviceIdentity signature proves possession
 * of a private key at signing time, not human identity or key secrecy
 * (see SECURITY.md "Stolen key" / "Impersonation").
 */

const tempDirs: string[] = [];

function makeKeyStore(): FileDeviceKeyStore {
  const dir = mkdtempSync(join(tmpdir(), 'flow-identity-test-'));
  tempDirs.push(dir);
  return new FileDeviceKeyStore(dir);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('DeviceIdentity creation', () => {
  it('binds the generated keypair to the resulting StudioDevice: fingerprint and identity match', () => {
    const store = makeKeyStore();
    const { device, identity } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
    });
    expect(identity.deviceId).toBe(device.id);
    expect(identity.fingerprint).toBe(device.deviceKeyFingerprint);
  });

  it('honors an explicit deviceId when provided', () => {
    const store = makeKeyStore();
    const explicitId = asDeviceId('device-explicit-01');
    const { device, identity } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-1'),
      platform: 'windows',
      appVersion: '2.0.0',
      deviceId: explicitId,
    });
    expect(device.id).toBe(explicitId);
    expect(identity.deviceId).toBe(explicitId);
  });
});

describe('DeviceIdentity persistence', () => {
  it('loading a previously created identity reproduces the same public identity (fingerprint and public key)', () => {
    const store = makeKeyStore();
    const deviceId = asDeviceId('device-persisted-01');
    const { identity: original } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-1'),
      platform: 'linux',
      appVersion: '1.0.0',
      deviceId,
    });

    const loaded = loadDeviceIdentity(store, deviceId);
    expect(loaded).toBeDefined();
    expect(loaded?.fingerprint).toBe(original.fingerprint);
    expect(loaded?.publicKeySpkiDer.equals(original.publicKeySpkiDer)).toBe(true);
  });

  it('returns undefined when loading a device id with no stored key material', () => {
    const store = makeKeyStore();
    expect(loadDeviceIdentity(store, asDeviceId('never-created'))).toBeUndefined();
  });
});

describe('DeviceIdentity canonical signing', () => {
  it('produces canonical signatures that verify against its own public key', () => {
    const store = makeKeyStore();
    const { identity } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
    });
    const payload = { batchId: 'b1', eventCount: 3 };
    const signature = identity.signCanonical(payload);
    expect(verifyCanonicalSignature(identity.publicKeySpkiDer, payload, signature)).toBe(true);
  });

  it('another device cannot verify as the original identity merely by supplying its own public key', () => {
    const store = makeKeyStore();
    const { identity: identityA } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
    });
    const { identity: identityB } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-2'),
      platform: 'ios',
      appVersion: '1.0.0',
    });

    const payload = { batchId: 'b1', eventCount: 3 };
    const signature = identityA.signCanonical(payload);

    expect(verifyCanonicalSignature(identityB.publicKeySpkiDer, payload, signature)).toBe(false);
    // The same payload signed by B does not match A's public key either.
    const signatureB = identityB.signCanonical(payload);
    expect(verifyCanonicalSignature(identityA.publicKeySpkiDer, payload, signatureB)).toBe(false);
  });

  it('rejects a signature whose payload was altered after signing', () => {
    const store = makeKeyStore();
    const { identity } = createDeviceIdentity(store, {
      profileId: asProfileId('profile-1'),
      platform: 'macos',
      appVersion: '1.0.0',
    });
    const signature = identity.signCanonical({ batchId: 'b1', eventCount: 3 });
    expect(verifyCanonicalSignature(identity.publicKeySpkiDer, { batchId: 'b1', eventCount: 4 }, signature)).toBe(
      false,
    );
  });
});
