import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { hashBytes } from '../crypto/sha256.js';

/**
 * Device identity is a device-generated Ed25519 keypair, never a hardware
 * serial number or other invasive identifier. Ed25519 is chosen because
 * it is a conservative, well-supported, constant-time signature scheme
 * available directly in Node's built-in `node:crypto` (no added
 * dependency), with small fixed-size keys and signatures (32-byte public
 * key, 64-byte signature) and no parameter choices that can be gotten
 * wrong (unlike RSA key size or ECDSA curve/nonce handling).
 */
export interface DeviceKeyPair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey };
}

/** SPKI DER encoding of the public key — the canonical exported form used for storage and fingerprinting. */
export function exportPublicKeySpki(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' });
}

/** PKCS8 DER encoding of the private key. Handle with care — see src/device/keyStore.ts. */
export function exportPrivateKeyPkcs8(privateKey: KeyObject): Buffer {
  return privateKey.export({ type: 'pkcs8', format: 'der' });
}

export function importPublicKeySpki(der: Buffer): KeyObject {
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function importPrivateKeyPkcs8(der: Buffer): KeyObject {
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/**
 * Deterministic from the public key alone: sha256 of its SPKI DER
 * encoding. Two processes that independently derive a fingerprint from
 * the same public key always agree, without needing to compare raw keys.
 */
export function deriveDeviceKeyFingerprint(publicKey: KeyObject): string {
  return hashBytes(exportPublicKeySpki(publicKey));
}

export function signBytes(privateKey: KeyObject, message: Uint8Array): Buffer {
  // Ed25519's "sign" API takes a null algorithm — the algorithm is fixed by the key type.
  return cryptoSign(null, message, privateKey);
}

export function verifyBytes(publicKey: KeyObject, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return cryptoVerify(null, message, publicKey, signature);
  } catch {
    // A malformed signature (wrong length, invalid encoding) throws rather
    // than returning false — callers only care that verification failed.
    return false;
  }
}
