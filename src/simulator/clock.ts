/**
 * A deterministic, injectable clock. Reading wall-clock time inside
 * provenance-critical code makes runs non-reproducible; the simulator
 * instead ticks forward from a fixed seed so the same scenario always
 * produces the same timestamps (and therefore the same hashes).
 */
export type Clock = () => string;

export function createDeterministicClock(startIsoTimestamp: string, stepMillis = 60_000): Clock {
  let current = Date.parse(startIsoTimestamp);
  if (Number.isNaN(current)) {
    throw new Error(`createDeterministicClock: "${startIsoTimestamp}" is not a valid ISO timestamp`);
  }
  return () => {
    const iso = new Date(current).toISOString();
    current += stepMillis;
    return iso;
  };
}
