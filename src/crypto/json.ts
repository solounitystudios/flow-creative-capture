/**
 * The value universe canonical serialization accepts. Deliberately excludes
 * Date, Map, Set, RegExp, class instances, functions, symbols, and bigint —
 * all of those have more than one "reasonable" JSON representation, which
 * is exactly what canonical hashing cannot tolerate. Callers normalize to
 * this shape explicitly (e.g. timestamps as ISO strings) before hashing.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
