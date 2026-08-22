import type { JsonValue } from './json.js';

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Serializes a value into a deterministic, canonical string suitable for
 * hashing. Two logically-equal objects ALWAYS produce the same string,
 * regardless of the key insertion order used to build them.
 *
 * Rules:
 *  - object keys are sorted lexicographically (recursively)
 *  - arrays preserve semantic order (never sorted)
 *  - strings use JSON string escaping
 *  - numbers must be finite; -0 normalizes to 0
 *  - undefined, NaN, Infinity, bigint, functions, symbols, Date/Map/Set/etc.
 *    are all rejected rather than silently coerced
 */
export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError(`Cannot canonicalize non-finite number: ${String(value)}`);
    }
    const normalized = Object.is(value, -0) ? 0 : value;
    return JSON.stringify(normalized);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const entryValue = value[key];
      if (entryValue === undefined) {
        throw new CanonicalizationError(
          `Cannot canonicalize object with undefined value at key "${key}"; omit the key instead`,
        );
      }
      return `${JSON.stringify(key)}:${serialize(entryValue)}`;
    });
    return `{${entries.join(',')}}`;
  }

  throw new CanonicalizationError(
    `Cannot canonicalize value of type "${typeof value}" (${Object.prototype.toString.call(value)}); ` +
      'normalize it to a string/number/boolean/null/array/plain-object first',
  );
}
