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

  it('does not expose the raw local evidence store schema DDL', () => {
    expect('SCHEMA_V1' in pkg).toBe(false);
    expect('SCHEMA_V1_DDL' in pkg).toBe(false);
  });
});

describe('package public surface — local evidence store', () => {
  it('exports LocalEvidenceStore and its error/version types', () => {
    expect(typeof pkg.LocalEvidenceStore).toBe('function');
    expect(typeof pkg.StoreConflictError).toBe('function');
    expect(typeof pkg.UnsupportedSchemaVersionError).toBe('function');
    expect(typeof pkg.CURRENT_SCHEMA_VERSION).toBe('number');
  });

  it('does not expose raw store internals — node:sqlite, row mappers, or low-level database primitives', () => {
    expect('openEvidenceDatabase' in pkg).toBe(false);
    expect('closeEvidenceDatabase' in pkg).toBe(false);
    expect('withTransaction' in pkg).toBe(false);
    expect('isUniqueConstraintError' in pkg).toBe(false);
    expect('deviceToRow' in pkg).toBe(false);
    expect('rowToDevice' in pkg).toBe(false);
    expect('eventToRow' in pkg).toBe(false);
    expect('rowToEvent' in pkg).toBe(false);
  });
});
