import { describe, expect, it } from 'vitest';
import { hashBytes, hashCanonicalValue, hashString, isSha256Hex } from '../../src/crypto/sha256.js';

describe('sha256 utilities', () => {
  it('hashes strings to the well-known SHA-256 test vector', () => {
    // SHA-256("abc")
    expect(hashString('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes bytes identically to the equivalent string', () => {
    const bytes = new TextEncoder().encode('abc');
    expect(hashBytes(bytes)).toBe(hashString('abc'));
  });

  it('produces a 64-char lowercase hex digest', () => {
    const digest = hashString('anything');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isSha256Hex(digest)).toBe(true);
  });

  it('rejects malformed hex digests', () => {
    expect(isSha256Hex('not-a-hash')).toBe(false);
    expect(isSha256Hex('a'.repeat(63))).toBe(false); // wrong length
    expect(isSha256Hex('a'.repeat(65))).toBe(false); // wrong length
  });

  it('accepts hex digests regardless of case (structural check only)', () => {
    expect(isSha256Hex('AB'.repeat(32))).toBe(true);
    expect(isSha256Hex('ab'.repeat(32))).toBe(true);
  });

  it('hashes a canonical object deterministically regardless of key order', () => {
    const h1 = hashCanonicalValue({ a: 1, b: 2 });
    const h2 = hashCanonicalValue({ b: 2, a: 1 });
    expect(h1).toBe(h2);
    expect(isSha256Hex(h1)).toBe(true);
  });

  it('produces different hashes for logically different objects', () => {
    const h1 = hashCanonicalValue({ a: 1 });
    const h2 = hashCanonicalValue({ a: 2 });
    expect(h1).not.toBe(h2);
  });
});
