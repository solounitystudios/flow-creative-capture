import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('package public surface — device signing', () => {
  it('exports the device identity, batch signing, trust, and key store primitives', () => {
    expect(typeof pkg.createDeviceIdentity).toBe('function');
    expect(typeof pkg.loadDeviceIdentity).toBe('function');
    expect(typeof pkg.verifyCanonicalSignature).toBe('function');
    expect(typeof pkg.buildBatchSigningPayload).toBe('function');
    expect(typeof pkg.signProvenanceBatch).toBe('function');
    expect(typeof pkg.verifySignedBatch).toBe('function');
    expect(typeof pkg.evaluateBatchTrust).toBe('function');
    expect(typeof pkg.FileDeviceKeyStore).toBe('function');
  });

  it('still exports domain-level device revocation (unchanged by this batch)', () => {
    expect(typeof pkg.revokeStudioDevice).toBe('function');
    expect(typeof pkg.isDeviceActive).toBe('function');
  });

  it('does not expose raw keypair primitives at the package root — consumers use DeviceIdentity instead', () => {
    expect('generateDeviceKeyPair' in pkg).toBe(false);
    expect('signBytes' in pkg).toBe(false);
    expect('verifyBytes' in pkg).toBe(false);
    expect('deriveDeviceKeyFingerprint' in pkg).toBe(false);
  });

  it('does not expose the unwired local evidence store schema', () => {
    expect('SCHEMA_V1' in pkg).toBe(false);
  });
});
