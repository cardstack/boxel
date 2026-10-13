import { createHash } from 'node:crypto';
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import type { DataKey } from './envelope.ts';

// Where the process gets the data keys it seals secrets under. Both providers
// hand the same envelope a 32-byte key, so development and CI exercise exactly
// the code a deployed server runs.

export type SecretsProviderName = 'kms' | 'local';

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

// Unwraps the data key KMS wrapped, once, at startup. After that every seal and
// open is local, so a KMS outage doesn't stop a running process. A worker
// manager unwraps once for all of its workers, so a respawned worker never
// calls KMS either.
export class KmsKeyProvider implements SecretsKeyProvider {
  readonly name = 'kms';
  #keyArn: string;
  #wrappedDataKey: Buffer;
  #kms: KmsDecrypter;

  constructor({
    keyArn,
    wrappedDataKey,
    kms,
  }: {
    keyArn: string;
    // The base64 CiphertextBlob, as stored in SSM.
    wrappedDataKey: string;
    kms?: KmsDecrypter;
  }) {
    this.#keyArn = keyArn;
    this.#wrappedDataKey = Buffer.from(wrappedDataKey.trim(), 'base64');
    if (this.#wrappedDataKey.length === 0) {
      throw new Error('SECRETS_WRAPPED_DATA_KEY is not a base64 ciphertext');
    }
    this.#kms = kms ?? defaultKmsDecrypter(keyArn);
  }

  // Names the data key by a hash of its wrapped form, which is public, stable
  // for the life of the data key, and different for every data key.
  get keyId(): string {
    return `kms-${createHash('sha256')
      .update(this.#wrappedDataKey)
      .digest('hex')
      .slice(0, 16)}`;
  }

  async loadDataKeys(): Promise<LoadedDataKeys> {
    let { Plaintext } = await this.#kms.decrypt({
      KeyId: this.#keyArn,
      CiphertextBlob: this.#wrappedDataKey,
      EncryptionContext: DATA_KEY_ENCRYPTION_CONTEXT,
    });
    if (!Plaintext) {
      throw new Error('KMS returned no plaintext for the wrapped data key');
    }
    let key = Buffer.from(Plaintext);
    Plaintext.fill(0);
    return { keys: [{ keyId: this.keyId, key }], currentKeyId: this.keyId };
  }
}

// A fixed development data key. It is public, so nothing sealed under it is
// secret; a deployed server refuses to start with this provider.
const LOCAL_DATA_KEY_ID = 'local-development';
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
// them is a misconfiguration and throws.
export function secretsKeyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { kms }: { kms?: KmsDecrypter } = {},
): SecretsKeyProvider {
  let keyArn = env.SECRETS_KMS_KEY_ARN?.trim();
  let wrappedDataKey = env.SECRETS_WRAPPED_DATA_KEY?.trim();
  if (keyArn && wrappedDataKey) {
    return new KmsKeyProvider({ keyArn, wrappedDataKey, kms });
  }
  if (keyArn || wrappedDataKey) {
    throw new Error(
      `SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY must be set together, but only ${
        keyArn ? 'SECRETS_KMS_KEY_ARN' : 'SECRETS_WRAPPED_DATA_KEY'
      } is set`,
    );
  }
  return new LocalKeyProvider();
}
