import type { DeviceId } from '../../../src/domain/ids.js';
import type { DeviceKeyStore } from '../../../src/device/keyStore.js';
import { loadDeviceIdentity, type DeviceIdentity } from '../../../src/device/identity.js';

/**
 * FIXED, NON-SECRET, FIXTURE-ONLY Ed25519 key material for the Cold
 * Nights demo fixture (`scripts/generateFixture.ts`) — never used for any
 * real `StudioDevice`, never read by the local Studio service
 * (`apps/capture-studio/service`), and never a substitute for the real
 * CSPRNG-backed `generateDeviceKeyPair` (`src/device/keypair.ts`), which
 * every actual device identity in this codebase still uses unchanged.
 *
 * WHY THIS EXISTS: `generateFixture.ts` previously called the real
 * `createDeviceIdentity`, which generates a brand-new Ed25519 keypair via
 * Node's real CSPRNG on every run — by design, since that's exactly what
 * a real device identity must do (see `src/device/keypair.ts`'s
 * docstring). That's correct for production identity, but it meant the
 * Cold Nights fixture's device public keys, batch signatures, and every
 * hash derived from them (`integrityManifest.canonicalHash`, delivery
 * package hashes, ...) changed on every regeneration, even though the
 * SCENARIO data itself (via `createDeterministicClock`) was already fully
 * deterministic. That non-determinism was the actual cause of the
 * generated-fixture diff noise this pass investigated and fixed.
 *
 * THE FIX, KEPT NARROW: these two keypairs were generated ONCE (the exact
 * same way `generateDeviceKeyPair` generates any real one — this is not a
 * weaker algorithm or a hand-rolled key), and their DER bytes are
 * hardcoded here as plain base64 constants. `loadDeterministicFixtureIdentity`
 * below pre-seeds a `DeviceKeyStore` with this fixed material and loads it
 * via the existing, curated `loadDeviceIdentity` — the exact same public
 * entry point any real consumer uses to load a previously-created
 * identity. No production code path changes: `src/device/keypair.ts`'s
 * `generateDeviceKeyPair` is untouched and still the only thing any real
 * `createDeviceIdentity` call ever uses.
 *
 * These keys being public (committed to source control, printed in this
 * file) is fine BECAUSE they are fixture-only: nothing downstream ever
 * treats a Cold Nights fixture signature as real evidence, and no
 * `StudioDevice` anywhere in this codebase is ever bootstrapped from this
 * file outside `generateFixture.ts` itself.
 */

const NIGHTWIRE_PUBLIC_SPKI_DER_BASE64 = 'MCowBQYDK2VwAyEAKAkKWOh7T/CeDHAq+ZvvhdCEaVzTAYnFNyDe44DSj+0=';
const NIGHTWIRE_PRIVATE_PKCS8_DER_BASE64 = 'MC4CAQAwBQYDK2VwBCIEILR6OR4zsc9ImbkUlCQ/k9Ub0yCxNjBiS5/cfM2rJdTO';
const MARCUS_PUBLIC_SPKI_DER_BASE64 = 'MCowBQYDK2VwAyEA1g8tNl55GwtUStsjNSGYn8nZk2t0nXS8EgvGHWR1dg4=';
const MARCUS_PRIVATE_PKCS8_DER_BASE64 = 'MC4CAQAwBQYDK2VwBCIEIGUGPA1zXf4s0T7cB+yf9buZQsOkLcnAY5ukJA+YwnlT';

const FIXTURE_KEYS_BY_LABEL: Readonly<Record<'nightwire' | 'marcus', { publicKeySpkiDerBase64: string; privateKeyPkcs8DerBase64: string }>> = {
  nightwire: {
    publicKeySpkiDerBase64: NIGHTWIRE_PUBLIC_SPKI_DER_BASE64,
    privateKeyPkcs8DerBase64: NIGHTWIRE_PRIVATE_PKCS8_DER_BASE64,
  },
  marcus: {
    publicKeySpkiDerBase64: MARCUS_PUBLIC_SPKI_DER_BASE64,
    privateKeyPkcs8DerBase64: MARCUS_PRIVATE_PKCS8_DER_BASE64,
  },
};

/**
 * Pre-seeds `keyStore` with fixed fixture key material for `deviceId`,
 * then loads it via the real `loadDeviceIdentity` — producing a fully
 * functional `DeviceIdentity` (real Ed25519 signing, real fingerprint
 * derivation) whose keypair is simply the same one every run, instead of
 * a freshly random one. Deterministic in, deterministic out.
 */
export function loadDeterministicFixtureIdentity(
  keyStore: DeviceKeyStore,
  deviceId: DeviceId,
  label: 'nightwire' | 'marcus',
): DeviceIdentity {
  const keys = FIXTURE_KEYS_BY_LABEL[label];
  keyStore.save(deviceId, {
    publicKeySpkiDer: Buffer.from(keys.publicKeySpkiDerBase64, 'base64'),
    privateKeyPkcs8Der: Buffer.from(keys.privateKeyPkcs8DerBase64, 'base64'),
  });
  const identity = loadDeviceIdentity(keyStore, deviceId);
  if (identity === undefined) {
    throw new Error(`loadDeterministicFixtureIdentity: failed to load the key material it just saved for ${deviceId}`);
  }
  return identity;
}
