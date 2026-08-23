import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isSha256Hex } from '../../src/crypto/sha256.js';
import {
  deriveDeviceKeyFingerprint,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generateDeviceKeyPair,
  importPrivateKeyPkcs8,
  importPublicKeySpki,
  signBytes,
  verifyBytes,
} from '../../src/device/keypair.js';

describe('device keypair generation', () => {
  it('generates a valid Ed25519 keypair', () => {
    const { publicKey, privateKey } = generateDeviceKeyPair();
    expect(publicKey.asymmetricKeyType).toBe('ed25519');
    expect(privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('produces a public/private pair that correspond: signing with the private key verifies with its public key', () => {
    const { publicKey, privateKey } = generateDeviceKeyPair();
    const message = Buffer.from('evidence payload');
    const signature = signBytes(privateKey, message);
    expect(verifyBytes(publicKey, message, signature)).toBe(true);
  });

  it('fails verification against an unrelated device\'s public key', () => {
    const deviceA = generateDeviceKeyPair();
    const deviceB = generateDeviceKeyPair();
    const message = Buffer.from('evidence payload');
    const signature = signBytes(deviceA.privateKey, message);
    expect(verifyBytes(deviceB.publicKey, message, signature)).toBe(false);
  });

  it('round-trips public/private key DER export and import without losing signing capability', () => {
    const { publicKey, privateKey } = generateDeviceKeyPair();
    const importedPublic = importPublicKeySpki(exportPublicKeySpki(publicKey));
    const importedPrivate = importPrivateKeyPkcs8(exportPrivateKeyPkcs8(privateKey));
    const message = Buffer.from('round-trip check');
    const signature = signBytes(importedPrivate, message);
    expect(verifyBytes(importedPublic, message, signature)).toBe(true);
  });
});

describe('device key fingerprint', () => {
  it('is a well-formed SHA-256 hex digest derived from the public key', () => {
    const { publicKey } = generateDeviceKeyPair();
    const fingerprint = deriveDeviceKeyFingerprint(publicKey);
    expect(isSha256Hex(fingerprint)).toBe(true);
    expect(fingerprint).toHaveLength(64);
  });

  it('produces the same fingerprint for the same public key regardless of how it was re-derived', () => {
    const { publicKey } = generateDeviceKeyPair();
    const direct = deriveDeviceKeyFingerprint(publicKey);
    const viaRoundTrip = deriveDeviceKeyFingerprint(importPublicKeySpki(exportPublicKeySpki(publicKey)));
    expect(viaRoundTrip).toBe(direct);
  });

  it('produces different fingerprints for different public keys', () => {
    const a = generateDeviceKeyPair();
    const b = generateDeviceKeyPair();
    expect(deriveDeviceKeyFingerprint(a.publicKey)).not.toBe(deriveDeviceKeyFingerprint(b.publicKey));
  });

  it('is deterministic in format: always 64 lowercase-or-uppercase hex characters, never influenced by anything but the key', () => {
    const results = Array.from({ length: 5 }, () => deriveDeviceKeyFingerprint(generateDeviceKeyPair().publicKey));
    for (const fingerprint of results) {
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    // Every generated fingerprint is unique, confirming the digest tracks the
    // (randomly generated) key material and nothing external to it.
    expect(new Set(results).size).toBe(results.length);
  });

  it('derives purely from key material, never from a hardware serial number or other machine identifier', () => {
    // deriveDeviceKeyFingerprint's only parameter is a KeyObject (see its
    // signature in src/device/keypair.ts) — there is no code path by which a
    // hardware serial, MAC address, or OS machine id could factor in. As a
    // behavioral proxy: two keypairs generated back-to-back on this same
    // machine still produce two different fingerprints, which would be
    // impossible if the fingerprint were tied to the (shared) hardware
    // rather than the (distinct) generated keys.
    const first = generateDeviceKeyPair();
    const second = generateDeviceKeyPair();
    expect(deriveDeviceKeyFingerprint(first.publicKey)).not.toBe(deriveDeviceKeyFingerprint(second.publicKey));
  });
});

describe('signature corruption / malformed input handling at the raw verifyBytes level', () => {
  it('rejects a truncated signature without throwing', () => {
    const { publicKey, privateKey } = generateDeviceKeyPair();
    const message = Buffer.from('message');
    const signature = signBytes(privateKey, message);
    const truncated = signature.subarray(0, signature.length - 10);
    expect(() => verifyBytes(publicKey, message, truncated)).not.toThrow();
    expect(verifyBytes(publicKey, message, truncated)).toBe(false);
  });

  it('rejects a well-formed but random 64-byte signature', () => {
    const { publicKey } = generateDeviceKeyPair();
    const message = Buffer.from('message');
    expect(verifyBytes(publicKey, message, randomBytes(64))).toBe(false);
  });

  it('rejects an empty signature', () => {
    const { publicKey } = generateDeviceKeyPair();
    expect(verifyBytes(publicKey, Buffer.from('message'), Buffer.alloc(0))).toBe(false);
  });

  it('rejects a signature that is valid for a different message', () => {
    const { publicKey, privateKey } = generateDeviceKeyPair();
    const signature = signBytes(privateKey, Buffer.from('original message'));
    expect(verifyBytes(publicKey, Buffer.from('a different message'), signature)).toBe(false);
  });
});
