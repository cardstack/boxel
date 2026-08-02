import { RealmRunnerError } from './errors.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function byteLength(value) {
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

function bytesToBase64(bytes) {
  let binary = '';
  let chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new RealmRunnerError(
      'NOTEBOOK_CORRUPT',
      'Realm Notebook encrypted data is not valid base64',
    );
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assertStorageKey(key) {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > 512 ||
    !/^[a-z0-9][a-z0-9/_.-]*$/i.test(key) ||
    key.includes('..') ||
    key.startsWith('/') ||
    key.endsWith('/')
  ) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'Realm Notebook storage key is invalid',
    );
  }
}

/**
 * Process-local notebook storage with sliding TTL. It is suitable for Matrix
 * room turns and ad-hoc agent sessions where durability beyond the active
 * Realm Server process is not wanted.
 */
export class MemoryNotebookStorage {
  constructor({ now = () => Date.now(), maxEntries = 2_000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  prune() {
    let now = this.now();
    for (let [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  async get(key) {
    assertStorageKey(key);
    this.prune();
    return clone(this.entries.get(key)?.value);
  }

  async set(key, value, { expiresAt = null } = {}) {
    assertStorageKey(key);
    this.prune();
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      throw new RealmRunnerError(
        'NOTEBOOK_STORAGE_LIMIT',
        `Ephemeral Realm Notebook storage is limited to ${this.maxEntries} records`,
      );
    }
    this.entries.set(key, { value: clone(value), expiresAt });
  }

  async delete(key) {
    assertStorageKey(key);
    this.entries.delete(key);
  }

  async touchPrefix(prefix, expiresAt) {
    assertStorageKey(prefix);
    this.prune();
    let keyPrefix = `${prefix}/`;
    for (let [key, entry] of this.entries) {
      if (key === prefix || key.startsWith(keyPrefix)) {
        entry.expiresAt = expiresAt;
      }
    }
  }
}

/**
 * Stores notebook records as ordinary, non-executable Realm files. Callers
 * should wrap this adapter in EncryptedNotebookStorage because notebook
 * outputs can contain material read from Realms other than the storage Realm.
 */
export class RealmFileNotebookStorage {
  constructor({
    adapter,
    realmUrl,
    prefix = '.boxel/realm-notebooks',
    maxRecordBytes = 2 * 1024 * 1024,
    now = () => Date.now(),
  }) {
    if (!adapter) throw new TypeError('adapter is required');
    if (!realmUrl) throw new TypeError('realmUrl is required');
    this.adapter = adapter;
    this.realmUrl = realmUrl;
    this.prefix = prefix.replace(/^\/+|\/+$/g, '');
    this.maxRecordBytes = maxRecordBytes;
    this.now = now;
  }

  pathFor(key) {
    assertStorageKey(key);
    return `${this.prefix}/${key}.realm-notebook`;
  }

  async get(key) {
    let path = this.pathFor(key);
    let source = await this.adapter.readText(
      this.realmUrl,
      path,
      this.maxRecordBytes,
    );
    if (source === undefined) return undefined;
    let envelope;
    try {
      envelope = JSON.parse(source);
    } catch {
      throw new RealmRunnerError(
        'NOTEBOOK_CORRUPT',
        `Realm Notebook record ${key} is not valid JSON`,
      );
    }
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      envelope.version !== 1 ||
      !('value' in envelope)
    ) {
      throw new RealmRunnerError(
        'NOTEBOOK_CORRUPT',
        `Realm Notebook record ${key} has an unsupported format`,
      );
    }
    if (
      envelope.expiresAt !== null &&
      (!Number.isFinite(envelope.expiresAt) || envelope.expiresAt <= this.now())
    ) {
      return undefined;
    }
    return envelope.value;
  }

  async set(key, value, { expiresAt = null } = {}) {
    let path = this.pathFor(key);
    let envelope = { version: 1, expiresAt, value };
    let source = `${JSON.stringify(envelope)}\n`;
    if (byteLength(envelope) > this.maxRecordBytes) {
      throw new RealmRunnerError(
        'NOTEBOOK_STORAGE_LIMIT',
        `Realm Notebook record exceeds ${this.maxRecordBytes} bytes`,
      );
    }
    let before = await this.adapter.readText(
      this.realmUrl,
      path,
      this.maxRecordBytes,
    );
    await this.adapter.atomicWrite(this.realmUrl, [
      {
        operation: before === undefined ? 'create' : 'update',
        path,
        content: source,
        exists: before !== undefined,
      },
    ]);
  }

  async delete(key) {
    let path = this.pathFor(key);
    let before = await this.adapter.readText(
      this.realmUrl,
      path,
      this.maxRecordBytes,
    );
    if (before === undefined) return;
    await this.adapter.atomicWrite(this.realmUrl, [
      { operation: 'remove', path, exists: true },
    ]);
  }
}

/**
 * Authenticated encryption decorator for durable notebook records. The
 * storage key is included as AES-GCM additional authenticated data so records
 * cannot be swapped between cells without detection.
 */
export class EncryptedNotebookStorage {
  constructor({ storage, keyMaterial }) {
    if (!storage) throw new TypeError('storage is required');
    if (typeof keyMaterial !== 'string' || keyMaterial.length < 16) {
      throw new TypeError(
        'Realm Notebook encryption key material must be at least 16 characters',
      );
    }
    this.storage = storage;
    this.keyPromise = this.deriveKey(keyMaterial);
  }

  async deriveKey(keyMaterial) {
    let digest = await crypto.subtle.digest(
      'SHA-256',
      textEncoder.encode(keyMaterial),
    );
    return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  }

  async get(key) {
    let encrypted = await this.storage.get(key);
    if (encrypted === undefined) return undefined;
    if (
      !encrypted ||
      typeof encrypted !== 'object' ||
      encrypted.version !== 1 ||
      encrypted.algorithm !== 'A256GCM' ||
      typeof encrypted.iv !== 'string' ||
      typeof encrypted.ciphertext !== 'string'
    ) {
      throw new RealmRunnerError(
        'NOTEBOOK_CORRUPT',
        `Realm Notebook record ${key} is not encrypted`,
      );
    }
    try {
      let plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToBytes(encrypted.iv),
          additionalData: textEncoder.encode(key),
        },
        await this.keyPromise,
        base64ToBytes(encrypted.ciphertext),
      );
      return JSON.parse(textDecoder.decode(plaintext));
    } catch (error) {
      if (error instanceof RealmRunnerError) throw error;
      throw new RealmRunnerError(
        'NOTEBOOK_CORRUPT',
        `Realm Notebook record ${key} failed authentication`,
      );
    }
  }

  async set(key, value, options) {
    let iv = crypto.getRandomValues(new Uint8Array(12));
    let ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: textEncoder.encode(key),
      },
      await this.keyPromise,
      textEncoder.encode(JSON.stringify(value)),
    );
    await this.storage.set(
      key,
      {
        version: 1,
        algorithm: 'A256GCM',
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      },
      options,
    );
  }

  async delete(key) {
    return this.storage.delete(key);
  }
}
