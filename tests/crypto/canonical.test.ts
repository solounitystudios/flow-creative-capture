import { describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalize } from '../../src/crypto/canonical.js';

describe('canonicalize', () => {
  it('produces the same output regardless of key insertion order', () => {
    const a = canonicalize({ b: 2, a: 1, c: 3 });
    const b = canonicalize({ c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":3}');
  });

  it('sorts keys recursively in nested objects', () => {
    const a = canonicalize({ outer: { z: 1, y: { b: 2, a: 1 } } });
    const b = canonicalize({ outer: { y: { a: 1, b: 2 }, z: 1 } });
    expect(a).toBe(b);
    expect(a).toBe('{"outer":{"y":{"a":1,"b":2},"z":1}}');
  });

  it('preserves array element order (never sorts arrays)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize([3, 1, 2])).not.toBe(canonicalize([1, 2, 3]));
  });

  it('serializes primitives deterministically', () => {
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(null)).toBe('null');
  });

  it('normalizes -0 to 0', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize(-0)).toBe(canonicalize(0));
  });

  it('escapes strings using JSON string rules', () => {
    expect(canonicalize('a"b\nc')).toBe(JSON.stringify('a"b\nc'));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(CanonicalizationError);
  });

  it('rejects undefined values inside objects rather than silently dropping them', () => {
    const withUndefined = { a: 1, b: undefined } as unknown as Record<string, never>;
    expect(() => canonicalize(withUndefined)).toThrow(CanonicalizationError);
  });

  it('rejects values that are not part of the JSON value universe', () => {
    expect(() => canonicalize(new Date() as unknown as never)).toThrow(CanonicalizationError);
    expect(() => canonicalize((() => 1) as unknown as never)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Symbol('x') as unknown as never)).toThrow(CanonicalizationError);
    expect(() => canonicalize(10n as unknown as never)).toThrow(CanonicalizationError);
  });

  it('produces a fully deterministic hash-ready string for a realistic nested object', () => {
    const manifestA = {
      projectId: 'p1',
      assets: [
        { assetId: 'a2', sha256: 'deadbeef' },
        { assetId: 'a1', sha256: 'beefdead' },
      ],
      meta: { createdAt: '2026-01-01T00:00:00.000Z', tags: ['x', 'y'] },
    };
    const manifestB = {
      meta: { tags: ['x', 'y'], createdAt: '2026-01-01T00:00:00.000Z' },
      assets: [
        { sha256: 'deadbeef', assetId: 'a2' },
        { sha256: 'beefdead', assetId: 'a1' },
      ],
      projectId: 'p1',
    };
    expect(canonicalize(manifestA)).toBe(canonicalize(manifestB));
  });
});
