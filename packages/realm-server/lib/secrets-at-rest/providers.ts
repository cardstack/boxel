import { createHash } from 'node:crypto';
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import type { DataKey } from './envelope.ts';

// Where the process gets the data keys it seals secrets under. Both providers
// hand the same envelope a 32-byte key, so development and CI exercise exactly
// the code a deployed server runs.

export type SecretsProviderName = 'kms' | 'secret-store' | 'local';

export interface LoadedDataKeys {
  keys: DataKey[];
  currentKeyId: string;
}

export interface SecretsKeyProvider {
  readonly name: SecretsProviderName;
  loadDataKeys(): Promise<LoadedDataKeys>;
}

// The context every wrapped data key is generated under. The key policy lets
// the realm-server and worker task roles unwrap only ciphertexts that carry it.
export const DATA_KEY_ENCRYPTION_CONTEXT: Record<string, string> = {
  purpose: 'boxel-secrets-data-key',
};

// The slice of the KMS client the provider uses, so tests can stand in for it.
export interface KmsDecrypter {
  decrypt(input: {
    KeyId: string;
    CiphertextBlob: Uint8Array;
    EncryptionContext: Record<string, string>;
  }): Promise<{ Plaintext?: Uint8Array }>;
}

// The client takes its region from the key's ARN, so it reaches the region the
// key lives in whatever region the task runs in, and bounds each call so an
// unreachable KMS fails startup instead of holding it open.
function defaultKmsDecrypter(keyArn: string): KmsDecrypter {
  let region = keyArn.split(':')[3];
  if (!keyArn.startsWith('arn:') || !region) {
    throw new Error(
      `SECRETS_KMS_KEY_ARN is not a KMS key ARN with a region: ${keyArn}`,
    );
  }
  let client = new KMSClient({
    region,
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000 },
  });
  return {
    decrypt: (input) => client.send(new DecryptCommand(input)),
  };
}

// Names a data key by a hash of its wrapped form, which is public, stable for
// the life of the data key, and different for every data key.
export function wrappedDataKeyId(wrappedDataKey: Buffer): string {
  return `kms-${createHash('sha256')
    .update(wrappedDataKey)
    .digest('hex')
    .slice(0, 16)}`;
}

function decodeWrappedDataKey(wrappedDataKey: string, setting: string): Buffer {
  let blob = Buffer.from(wrappedDataKey.trim(), 'base64');
  if (blob.length === 0) {
    throw new Error(`${setting} is not a base64 ciphertext`);
  }
  return blob;
}

// Unwraps the data keys KMS wrapped, once each, at startup. After that every
// seal and open is local, so a KMS outage doesn't stop a running process. A
// worker manager unwraps once for all of its workers, so a respawned worker
// never calls KMS either.
//
// The wrapped data key is the current one, which every seal uses. Additional
// wrapped data keys are loaded only to open values sealed under them: the
// data key a rotation is moving away from, and the one it is about to move
// to, so every process can open rows sealed under either while a deploy rolls
// out.
export class KmsKeyProvider implements SecretsKeyProvider {
  readonly name = 'kms';
  #keyArn: string;
  #wrappedDataKey: Buffer;
  #additionalWrappedDataKeys: Buffer[];
  #kms: KmsDecrypter;

  constructor({
    keyArn,
    wrappedDataKey,
    additionalWrappedDataKeys = [],
    kms,
  }: {
    keyArn: string;
    // The base64 CiphertextBlob, as stored in SSM.
    wrappedDataKey: string;
    // More base64 CiphertextBlobs, loaded to open and never to seal.
    additionalWrappedDataKeys?: string[];
    kms?: KmsDecrypter;
  }) {
    this.#keyArn = keyArn;
    this.#wrappedDataKey = decodeWrappedDataKey(
      wrappedDataKey,
      'SECRETS_WRAPPED_DATA_KEY',
    );
    this.#additionalWrappedDataKeys = additionalWrappedDataKeys.map((blob) =>
      decodeWrappedDataKey(blob, 'SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS'),
    );
    this.#kms = kms ?? defaultKmsDecrypter(keyArn);
  }

  // The id of the current data key.
  get keyId(): string {
    return wrappedDataKeyId(this.#wrappedDataKey);
  }

  async loadDataKeys(): Promise<LoadedDataKeys> {
    let blobs = [this.#wrappedDataKey, ...this.#additionalWrappedDataKeys];
    let keyIds = blobs.map(wrappedDataKeyId);
    let repeated = keyIds.find((keyId, i) => keyIds.indexOf(keyId) !== i);
    if (repeated) {
      throw new Error(
        `Data key ${repeated} is listed more than once across SECRETS_WRAPPED_DATA_KEY and SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`,
      );
    }
    let keys: DataKey[] = [];
    try {
      for (let [i, blob] of blobs.entries()) {
        keys.push({ keyId: keyIds[i], key: await this.#unwrap(blob) });
      }
    } catch (e) {
      // Leave no unwrapped key behind when a later one fails to unwrap.
      for (let { key } of keys) {
        key.fill(0);
      }
      throw e;
    }
    return { keys, currentKeyId: this.keyId };
  }

  async #unwrap(blob: Buffer): Promise<Buffer> {
    let { Plaintext } = await this.#kms.decrypt({
      KeyId: this.#keyArn,
      CiphertextBlob: blob,
      EncryptionContext: DATA_KEY_ENCRYPTION_CONTEXT,
    });
    if (!Plaintext) {
      throw new Error(
        `KMS returned no plaintext for the wrapped data key ${wrappedDataKeyId(blob)}`,
      );
    }
    let key = Buffer.from(Plaintext);
    Plaintext.fill(0);
    return key;
  }
}

// Non-AWS deployments may load a dedicated data key from their managed
// secret store. Unlike the public local-development key, this key must be
// generated randomly and must never be stored in the database or image.
export class SecretStoreKeyProvider implements SecretsKeyProvider {
  readonly name = 'secret-store';
  #key: Buffer;
  constructor(value: string) {
    let key = Buffer.from(value, 'base64');
    if (
      key.length !== 32 ||
      key.toString('base64') !== value ||
      key.equals(LOCAL_DATA_KEY)
    ) {
      throw new Error(
        'SECRETS_DATA_KEY must be a private, canonical base64 32-byte key',
      );
    }
    this.#key = key;
  }
  async loadDataKeys(): Promise<LoadedDataKeys> {
    let keyId = `secret-store-${createHash('sha256').update(this.#key).digest('hex').slice(0, 16)}`;
    return {
      currentKeyId: keyId,
      keys: [{ keyId, key: Buffer.from(this.#key) }],
    };
  }
}

// A fixed development data key. It is public, so nothing sealed under it is
// secret; a deployed server refuses to start with this provider.
export const LOCAL_DATA_KEY_ID = 'local-development';
const LOCAL_DATA_KEY = createHash('sha256')
  .update('boxel local development secrets data key', 'utf8')
  .digest();

export class LocalKeyProvider implements SecretsKeyProvider {
  readonly name = 'local';

  async loadDataKeys(): Promise<LoadedDataKeys> {
    return {
      keys: [{ keyId: LOCAL_DATA_KEY_ID, key: Buffer.from(LOCAL_DATA_KEY) }],
      currentKeyId: LOCAL_DATA_KEY_ID,
    };
  }
}

// Picks the provider the environment configures: KMS when both of its
// settings are present, the local provider when neither is. Exactly one of
// them is a misconfiguration and throws. SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS,
// a comma-separated list of wrapped data keys loaded only to open, belongs to
// the KMS provider and is a misconfiguration without it.
export function secretsKeyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { kms }: { kms?: KmsDecrypter } = {},
): SecretsKeyProvider {
  let keyArn = env.SECRETS_KMS_KEY_ARN?.trim();
  let wrappedDataKey = env.SECRETS_WRAPPED_DATA_KEY?.trim();
  let additionalWrappedDataKeys = (
    env.SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS ?? ''
  )
    .split(',')
    .map((blob) => blob.trim())
    .filter(Boolean);
  if (keyArn && wrappedDataKey) {
    return new KmsKeyProvider({
      keyArn,
      wrappedDataKey,
      additionalWrappedDataKeys,
      kms,
    });
  }
  if (keyArn || wrappedDataKey) {
    throw new Error(
      `SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY must be set together, but only ${
        keyArn ? 'SECRETS_KMS_KEY_ARN' : 'SECRETS_WRAPPED_DATA_KEY'
      } is set`,
    );
  }
  if (additionalWrappedDataKeys.length > 0) {
    throw new Error(
      'SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS is set, but SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are not',
    );
  }
  if (env.SECRETS_DATA_KEY) {
    return new SecretStoreKeyProvider(env.SECRETS_DATA_KEY);
  }
  return new LocalKeyProvider();
}
