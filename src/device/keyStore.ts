import { existsSync, mkdirSync, readFileSync, chmodSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Abstraction over where a device's private key material lives, so the
 * rest of the codebase never depends on a specific storage mechanism.
 *
 * CURRENT IMPLEMENTATION LEVEL — read before relying on this for anything
 * real: `FileDeviceKeyStore` below is a development/local-file store, NOT
 * production-grade secret storage. It writes the private key to a plain
 * file, base64-encoded, with POSIX file permissions restricted to the
 * owner (`0o600`) where the OS honors that (Linux/macOS — Windows ACLs
 * differ and are not implemented here). This protects against *other
 * unprivileged local users* reading the file on a POSIX system; it does
 * NOT protect against:
 *   - anyone with root/Administrator access to the machine,
 *   - anyone with read access to a filesystem backup or disk image,
 *   - malware running as the same user,
 *   - the file being copied elsewhere.
 * A real Studio Companion build MUST replace this with actual OS-level
 * secure storage (macOS Keychain, Windows Credential Manager / DPAPI, a
 * Linux Secret Service / libsecret backend) before any user's trust
 * relies on key secrecy. Do not describe this implementation as "secure
 * storage" anywhere outside this file's own documentation.
 */
export interface StoredKeyMaterial {
  readonly publicKeySpkiDer: Buffer;
  readonly privateKeyPkcs8Der: Buffer;
}

export interface DeviceKeyStore {
  save(deviceId: string, material: StoredKeyMaterial): void;
  load(deviceId: string): StoredKeyMaterial | undefined;
  delete(deviceId: string): void;
}

interface KeyFileContents {
  readonly publicKeySpkiDerBase64: string;
  readonly privateKeyPkcs8DerBase64: string;
}

export class FileDeviceKeyStore implements DeviceKeyStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private pathFor(deviceId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(deviceId)) {
      throw new Error(`FileDeviceKeyStore: deviceId "${deviceId}" contains characters unsafe for a file name`);
    }
    return join(this.directory, `${deviceId}.key.json`);
  }

  save(deviceId: string, material: StoredKeyMaterial): void {
    const contents: KeyFileContents = {
      publicKeySpkiDerBase64: material.publicKeySpkiDer.toString('base64'),
      privateKeyPkcs8DerBase64: material.privateKeyPkcs8Der.toString('base64'),
    };
    const path = this.pathFor(deviceId);
    writeFileSync(path, JSON.stringify(contents), { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best-effort: not all filesystems/platforms support POSIX permission bits.
    }
  }

  load(deviceId: string): StoredKeyMaterial | undefined {
    const path = this.pathFor(deviceId);
    if (!existsSync(path)) {
      return undefined;
    }
    const contents = JSON.parse(readFileSync(path, 'utf8')) as KeyFileContents;
    return {
      publicKeySpkiDer: Buffer.from(contents.publicKeySpkiDerBase64, 'base64'),
      privateKeyPkcs8Der: Buffer.from(contents.privateKeyPkcs8DerBase64, 'base64'),
    };
  }

  delete(deviceId: string): void {
    const path = this.pathFor(deviceId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}
