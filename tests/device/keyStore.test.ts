import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveDeviceKeyFingerprint,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generateDeviceKeyPair,
  importPublicKeySpki,
} from '../../src/device/keypair.js';
import { FileDeviceKeyStore, type StoredKeyMaterial } from '../../src/device/keyStore.js';

/**
 * FileDeviceKeyStore is development/local-only storage — see its own doc
 * comment in src/device/keyStore.ts and SECURITY.md. These tests prove it
 * does what it claims (save/load/delete round-trip, owner-only file
 * permissions where the OS supports that), NOT that it is secure against a
 * privileged local attacker. It explicitly does not protect against
 * root/Administrator access, same-user malware, disk imaging, or copied
 * backups — nothing here should be read as testing (or implying) otherwise.
 *
 * All tests use a fresh OS temp directory per test and clean it up
 * afterward; no key material is ever written into the repository.
 */

const tempDirs: string[] = [];

function makeStore(): { dir: string; store: FileDeviceKeyStore } {
  const base = mkdtempSync(join(tmpdir(), 'flow-keystore-test-'));
  tempDirs.push(base);
  // Use a not-yet-existing nested path so FileDeviceKeyStore's own
  // mkdirSync call (not mkdtemp's default mode) is what creates the
  // directory — this is what actually exercises the 0700 mode it sets.
  const dir = join(base, 'keys');
  return { dir, store: new FileDeviceKeyStore(dir) };
}

function makeMaterial(): StoredKeyMaterial {
  const { publicKey, privateKey } = generateDeviceKeyPair();
  return {
    publicKeySpkiDer: exportPublicKeySpki(publicKey),
    privateKeyPkcs8Der: exportPrivateKeyPkcs8(privateKey),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('FileDeviceKeyStore', () => {
  it('returns undefined for a device with no stored key material', () => {
    const { store } = makeStore();
    expect(store.load('device-that-does-not-exist')).toBeUndefined();
  });

  it('round-trips saved key material exactly (byte-for-byte)', () => {
    const { store } = makeStore();
    const material = makeMaterial();
    store.save('device-1', material);
    const loaded = store.load('device-1');
    expect(loaded).toBeDefined();
    expect(loaded?.publicKeySpkiDer.equals(material.publicKeySpkiDer)).toBe(true);
    expect(loaded?.privateKeyPkcs8Der.equals(material.privateKeyPkcs8Der)).toBe(true);
  });

  it('a round-tripped public key still derives the original fingerprint', () => {
    const { store } = makeStore();
    const { publicKey, privateKey } = generateDeviceKeyPair();
    const fingerprint = deriveDeviceKeyFingerprint(publicKey);
    store.save('device-1', {
      publicKeySpkiDer: exportPublicKeySpki(publicKey),
      privateKeyPkcs8Der: exportPrivateKeyPkcs8(privateKey),
    });
    const loaded = store.load('device-1');
    expect(loaded).toBeDefined();
    const reimported = importPublicKeySpki(loaded!.publicKeySpkiDer);
    expect(deriveDeviceKeyFingerprint(reimported)).toBe(fingerprint);
  });

  it('deletes stored key material', () => {
    const { store } = makeStore();
    store.save('device-1', makeMaterial());
    store.delete('device-1');
    expect(store.load('device-1')).toBeUndefined();
  });

  it('deleting a key that was never saved is a safe no-op', () => {
    const { store } = makeStore();
    expect(() => store.delete('never-existed')).not.toThrow();
  });

  it('keeps two devices\' key material independent', () => {
    const { store } = makeStore();
    const materialA = makeMaterial();
    const materialB = makeMaterial();
    store.save('device-a', materialA);
    store.save('device-b', materialB);
    expect(store.load('device-a')?.publicKeySpkiDer.equals(materialA.publicKeySpkiDer)).toBe(true);
    expect(store.load('device-b')?.publicKeySpkiDer.equals(materialB.publicKeySpkiDer)).toBe(true);
  });

  it('rejects a device id containing path-unsafe characters, rather than resolving it against an unexpected path', () => {
    const { store } = makeStore();
    expect(() => store.load('../../etc/passwd')).toThrow();
    expect(() => store.save('../../etc/passwd', makeMaterial())).toThrow();
  });

  it.runIf(platform() !== 'win32')(
    'restricts the saved key file to owner-only permissions (0600) on POSIX systems',
    () => {
      const { dir, store } = makeStore();
      store.save('device-1', makeMaterial());
      const mode = statSync(join(dir, 'device-1.key.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it.runIf(platform() !== 'win32')('restricts the key store directory to owner-only access (0700) on POSIX systems', () => {
    const { dir } = makeStore();
    const mode = statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});
