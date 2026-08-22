import { createHash } from 'node:crypto';
import type { JsonValue } from './json.js';
import { canonicalize } from './canonical.js';

/** Hex-encoded SHA-256 digest of raw bytes. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Hex-encoded SHA-256 digest of a UTF-8 string. */
export function hashString(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Hex-encoded SHA-256 digest of a value's canonical serialization.
 * This is the ONLY correct way to hash a domain object — never hash
 * ad hoc JSON.stringify output.
 */
export function hashCanonicalValue(value: JsonValue): string {
  return hashString(canonicalize(value));
}

const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Structural check only: is this a 64-character hex string? Case is
 * accepted either way here — callers that persist a digest (e.g.
 * ProjectAsset.sha256) normalize it to lowercase themselves so the same
 * logical hash always canonicalizes and hashes identically.
 */
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}
