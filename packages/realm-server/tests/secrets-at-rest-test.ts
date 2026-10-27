import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from '@cardstack/runtime-common';
import {
  DATA_KEY_ENCRYPTION_CONTEXT,
  encodeSecretsKeyringIpc,
  KmsKeyProvider,
  LocalKeyProvider,
  receiveSecretsKeyring,
  resetSecretsAtRest,
  SecretDecryptionError,
  secretEncryptionContext,
  SecretsAtRestStartupError,
  SecretsKeyring,
  secretsKeyProviderFromEnv,
  secretsKeyring,
  SECRETS_KEYRING_REQUEST,
  startSecretsAtRest,
  unwrapDataKeys,
  type KmsDecrypter,
  type SealedSecret,
  type SecretBinding,
  wrappedDataKeyId,
} from '../lib/secrets-at-rest/index.ts';

// Every line logged on the `secrets-at-rest` channel while `fn` runs, at info
// and louder whatever LOG_LEVELS says.
async function secretsLogDuring(fn: () => Promise<void>): Promise<string[]> {
  let log = logger('secrets-at-rest');
  let lines: string[] = [];
  let originalFactory = log.methodFactory;
  let originalLevel = log.getLevel();
  log.methodFactory = (methodName, level, loggerName) => {
    let raw = originalFactory(methodName, level, loggerName);
    return (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
      raw(...args);
    };
  };
  log.setLevel('info');
  try {
    await fn();
  } finally {
    log.methodFactory = originalFactory;
    log.setLevel(originalLevel);
  }
  return lines;
}

// Stands in for KMS: unwraps only the blob it wrapped, under the exact context
// it was wrapped with, and records every call.
function fakeKms(dataKey: Buffer): {
  kms: KmsDecrypter;
  wrappedDataKey: string;
  calls: Parameters<KmsDecrypter['decrypt']>[0][];
} {
  let blob = randomBytes(64);
  let calls: Parameters<KmsDecrypter['decrypt']>[0][] = [];
  return {
    wrappedDataKey: blob.toString('base64'),
    calls,
    kms: {
      async decrypt(input) {
        calls.push(input);
        if (
          !Buffer.from(input.CiphertextBlob).equals(blob) ||
          JSON.stringify(input.EncryptionContext) !==
            JSON.stringify(DATA_KEY_ENCRYPTION_CONTEXT)
        ) {
          throw new Error('InvalidCiphertextException');
        }
        return { Plaintext: Uint8Array.from(dataKey) };
      },
    },
  };
}

// Stands in for KMS holding several wrapped data keys: unwraps each blob it
// wrapped, under the data-key encryption context, and records every call.
function fakeKmsWithKeys(dataKeys: Buffer[]): {
  kms: KmsDecrypter;
  wrappedDataKeys: string[];
  calls: Parameters<KmsDecrypter['decrypt']>[0][];
} {
  let blobs = dataKeys.map(() => randomBytes(64));
  let calls: Parameters<KmsDecrypter['decrypt']>[0][] = [];
  return {
    wrappedDataKeys: blobs.map((blob) => blob.toString('base64')),
    calls,
    kms: {
      async decrypt(input) {
        calls.push(input);
        let i = blobs.findIndex((blob) =>
          Buffer.from(input.CiphertextBlob).equals(blob),
        );
        if (
          i === -1 ||
          JSON.stringify(input.EncryptionContext) !==
            JSON.stringify(DATA_KEY_ENCRYPTION_CONTEXT)
        ) {
          throw new Error('InvalidCiphertextException');
        }
        return { Plaintext: Uint8Array.from(dataKeys[i]) };
      },
    },
  };
}

function flip(buffer: Buffer, index = 0): Buffer {
  let copy = Buffer.from(buffer);
  copy[index] ^= 0x01;
  return copy;
}

function openError(
  keyring: SecretsKeyring,
  sealed: SealedSecret,
  binding: SecretBinding,
): unknown {
  try {
    keyring.open(sealed, binding);
  } catch (error) {
    return error;
  }
  return undefined;
}

const SECRET = 'sk-live-correct-horse-battery-staple';
const FIELD = 'oauth_clients.refresh_token';
const OWNER = '@secret-owner:example.test';
const ROW_ID = 'b1f0c9a2-7f0e-4f53-9d2a-2c9e3f1d8a11';
const DESTINATION = 'https://api.vendor.example/v1/';

module(basename(import.meta.filename), function (hooks) {
  hooks.afterEach(function () {
    resetSecretsAtRest();
  });

  function keyring(keyId = 'k1'): SecretsKeyring {
    return new SecretsKeyring([{ keyId, key: randomBytes(32) }], keyId);
  }

  module('sealing and opening', function () {
    test('a sealed secret opens under the binding it was sealed with', function (assert) {
      let ring = keyring();
      let binding = {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        destination: DESTINATION,
      };
      let sealed = ring.seal(SECRET, binding);

      assert.strictEqual(sealed.keyId, 'k1');
      assert.strictEqual(sealed.nonce.length, 12);
      assert.strictEqual(sealed.tag.length, 16);
      assert.false(
        sealed.ciphertext.toString('utf8').includes(SECRET),
        'the ciphertext does not carry the secret',
      );
      assert.strictEqual(ring.open(sealed, binding), SECRET);
    });

    test('sealing the same secret twice uses a fresh nonce', function (assert) {
      let ring = keyring();
      let binding = { field: FIELD, owner: OWNER, id: ROW_ID };
      let first = ring.seal(SECRET, binding);
      let second = ring.seal(SECRET, binding);
      assert.false(first.nonce.equals(second.nonce));
      assert.false(first.ciphertext.equals(second.ciphertext));
    });

    test('tampering with the ciphertext, tag or nonce stops it opening', function (assert) {
      let ring = keyring();
      let binding = {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        destination: DESTINATION,
      };
      let sealed = ring.seal(SECRET, binding);

      for (let [label, tampered] of [
        ['ciphertext', { ...sealed, ciphertext: flip(sealed.ciphertext) }],
        ['tag', { ...sealed, tag: flip(sealed.tag) }],
        ['nonce', { ...sealed, nonce: flip(sealed.nonce) }],
        ['truncated tag', { ...sealed, tag: sealed.tag.subarray(0, 8) }],
      ] as const) {
        let error = openError(ring, tampered, binding);
        assert.true(
          error instanceof SecretDecryptionError,
          `${label}: refused with SecretDecryptionError`,
        );
      }
    });

    test('a secret moved to another field, owner, row or destination does not open', function (assert) {
      let ring = keyring();
      let binding = {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        destination: DESTINATION,
      };
      let sealed = ring.seal(SECRET, binding);

      for (let [label, other] of [
        ['field', { ...binding, field: 'oauth_clients.client_secret' }],
        ['owner', { ...binding, owner: '@other-owner:example.test' }],
        ['id', { ...binding, id: 'another-row' }],
        ['destination', { ...binding, destination: 'https://evil.example/' }],
        ['no destination', { field: FIELD, owner: OWNER, id: ROW_ID }],
      ] as const) {
        let error = openError(ring, sealed, other);
        assert.true(
          error instanceof SecretDecryptionError,
          `${label}: refused with SecretDecryptionError`,
        );
        assert.false(
          String((error as Error).message).includes(SECRET),
          `${label}: the error does not carry the secret`,
        );
      }
    });

    test('two secrets on one row with the same destination cannot be swapped between columns', function (assert) {
      let ring = keyring();
      let row = { owner: OWNER, id: ROW_ID, destination: DESTINATION };
      let clientSecretBinding = {
        ...row,
        field: 'oauth_clients.client_secret',
      };
      let refreshTokenBinding = {
        ...row,
        field: 'oauth_clients.refresh_token',
      };
      let clientSecret = ring.seal('client-secret', clientSecretBinding);
      let refreshToken = ring.seal('refresh-token', refreshTokenBinding);

      assert.strictEqual(
        ring.open(clientSecret, clientSecretBinding),
        'client-secret',
      );
      assert.strictEqual(
        ring.open(refreshToken, refreshTokenBinding),
        'refresh-token',
      );
      assert.true(
        openError(ring, refreshToken, clientSecretBinding) instanceof
          SecretDecryptionError,
        'the refresh token copied into the client secret column does not open',
      );
      assert.true(
        openError(ring, clientSecret, refreshTokenBinding) instanceof
          SecretDecryptionError,
        'the client secret copied into the refresh token column does not open',
      );
    });

    test('a binding must name its field', function (assert) {
      assert.throws(
        () => keyring().seal(SECRET, { field: '', owner: OWNER, id: ROW_ID }),
        /must name the field/,
      );
    });

    test('a secret sealed under a data key the process has not loaded does not open', function (assert) {
      let sealed = keyring('k1').seal(SECRET, {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
      });
      let error = openError(keyring('k2'), sealed, {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
      });
      assert.true(error instanceof SecretDecryptionError);
      assert.true(String((error as Error).message).includes('k1'));
    });

    test('a key id swapped onto a value sealed under another key does not open', function (assert) {
      let k1 = randomBytes(32);
      let ring = new SecretsKeyring(
        [
          { keyId: 'k1', key: k1 },
          { keyId: 'k1-alias', key: k1 },
        ],
        'k1',
      );
      let binding = { field: FIELD, owner: OWNER, id: ROW_ID };
      let sealed = ring.seal(SECRET, binding);
      let error = openError(ring, { ...sealed, keyId: 'k1-alias' }, binding);
      assert.true(error instanceof SecretDecryptionError);
    });

    test('the keyring refuses a data key that is not 32 bytes', function (assert) {
      assert.throws(
        () => new SecretsKeyring([{ keyId: 'k1', key: randomBytes(16) }], 'k1'),
        /needs 32/,
      );
    });
  });

  module('binding a destination later', function () {
    test('a secret sealed without a destination opens under owner and id, and only under its destination once re-sealed', function (assert) {
      let ring = keyring();
      let pending = { field: FIELD, owner: OWNER, id: ROW_ID };
      let sealed = ring.seal(SECRET, pending);
      assert.strictEqual(ring.open(sealed, pending), SECRET);

      let bound = { ...pending, destination: DESTINATION };
      let resealed = ring.reseal(sealed, pending, bound);
      assert.strictEqual(ring.open(resealed, bound), SECRET);
      assert.true(
        openError(ring, resealed, pending) instanceof SecretDecryptionError,
        'no longer opens without its destination',
      );
      assert.true(
        openError(ring, resealed, {
          ...pending,
          destination: 'https://evil.example/',
        }) instanceof SecretDecryptionError,
        'does not open under another destination',
      );
    });

    test('re-sealing refuses a value that does not open under the binding it is said to have', function (assert) {
      let ring = keyring();
      let sealed = ring.seal(SECRET, {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
      });
      assert.throws(
        () =>
          ring.reseal(
            sealed,
            { field: FIELD, owner: '@other-owner:example.test', id: ROW_ID },
            {
              field: FIELD,
              owner: '@other-owner:example.test',
              id: ROW_ID,
              destination: DESTINATION,
            },
          ),
        SecretDecryptionError,
      );
    });

    test('re-sealing moves the value onto the current data key', function (assert) {
      let binding = { field: FIELD, owner: OWNER, id: ROW_ID };
      let oldKey = { keyId: 'old', key: randomBytes(32) };
      let newKey = { keyId: 'new', key: randomBytes(32) };
      let sealed = new SecretsKeyring([oldKey], 'old').seal(SECRET, binding);

      let ring = new SecretsKeyring([oldKey, newKey], 'new');
      let resealed = ring.reseal(sealed, binding, binding);
      assert.strictEqual(resealed.keyId, 'new');
      assert.strictEqual(
        new SecretsKeyring([newKey], 'new').open(resealed, binding),
        SECRET,
      );
    });
  });

  module('encryption context', function () {
    test('the context carries field, owner, id and the SHA-256 of the destination, never the destination', function (assert) {
      let context = secretEncryptionContext({
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        destination: DESTINATION,
      });
      assert.deepEqual(context, {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        destination_sha256: createHash('sha256')
          .update(DESTINATION)
          .digest('hex'),
      });
      assert.false(
        JSON.stringify(context).includes('vendor.example'),
        'the destination does not appear in the context',
      );
    });

    test('a secret with no destination yet has no destination in its context', function (assert) {
      assert.deepEqual(
        secretEncryptionContext({ field: FIELD, owner: OWNER, id: ROW_ID }),
        {
          field: FIELD,
          owner: OWNER,
          id: ROW_ID,
        },
      );
    });

    test('a copy names the row it copies, and opens only beside that row', function (assert) {
      let ring = keyring();
      let parentId = '6f2d4c1e-0b7a-4e95-8c3d-1a2b3c4d5e6f';
      let copy: SecretBinding = {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        parentId,
        destination: DESTINATION,
      };
      assert.strictEqual(
        secretEncryptionContext(copy).parent_id,
        parentId,
        'the context carries the parent id',
      );
      let sealed = ring.seal(SECRET, copy);
      assert.strictEqual(ring.open(sealed, copy), SECRET);
      assert.throws(
        () =>
          ring.open(sealed, {
            ...copy,
            parentId: '0e9a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c',
          }),
        SecretDecryptionError,
        'not beside another parent',
      );
      let { parentId: _parentId, ...withoutParent } = copy;
      assert.throws(
        () => ring.open(sealed, withoutParent),
        SecretDecryptionError,
        'nor with no parent',
      );
      assert.throws(
        () => ring.open(ring.seal(SECRET, withoutParent), copy),
        SecretDecryptionError,
        'and a value sealed with no parent does not open as a copy',
      );
    });
  });

  module('providers', function () {
    test('the KMS provider unwraps the data key once, under the data-key encryption context', async function (assert) {
      let dataKey = randomBytes(32);
      let { kms, wrappedDataKey, calls } = fakeKms(dataKey);
      let provider = new KmsKeyProvider({
        keyArn: 'arn:aws:kms:us-east-1:111122223333:key/test',
        wrappedDataKey,
        kms,
      });
      let ring = await startSecretsAtRest({ deployed: true, provider });

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].KeyId,
        'arn:aws:kms:us-east-1:111122223333:key/test',
      );
      assert.deepEqual(calls[0].EncryptionContext, {
        purpose: 'boxel-secrets-data-key',
      });

      let binding = { field: FIELD, owner: OWNER, id: ROW_ID };
      let sealed = ring.seal(SECRET, binding);
      assert.strictEqual(sealed.keyId, provider.keyId);
      assert.strictEqual(
        new SecretsKeyring(
          [{ keyId: provider.keyId, key: dataKey }],
          provider.keyId,
        ).open(sealed, binding),
        SECRET,
        'the value is sealed under the unwrapped data key',
      );
      for (let i = 0; i < 20; i++) {
        secretsKeyring().open(secretsKeyring().seal(SECRET, binding), binding);
      }
      assert.strictEqual(calls.length, 1, 'sealing and opening never call KMS');
    });

    test('the KMS key id names the wrapped data key and stays the same across restarts', function (assert) {
      let { kms, wrappedDataKey } = fakeKms(randomBytes(32));
      let keyArn = 'arn:aws:kms:us-east-1:111122223333:key/test';
      let first = new KmsKeyProvider({ keyArn, wrappedDataKey, kms });
      let second = new KmsKeyProvider({ keyArn, wrappedDataKey, kms });
      let other = new KmsKeyProvider({
        keyArn,
        wrappedDataKey: fakeKms(randomBytes(32)).wrappedDataKey,
        kms,
      });
      assert.true(/^kms-[0-9a-f]{16}$/.test(first.keyId));
      assert.strictEqual(first.keyId, second.keyId);
      assert.notStrictEqual(first.keyId, other.keyId);
    });

    test('the environment picks KMS when both settings are set, local when neither is', function (assert) {
      let { kms, wrappedDataKey } = fakeKms(randomBytes(32));
      assert.strictEqual(
        secretsKeyProviderFromEnv(
          {
            SECRETS_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:111122223333:key/test',
            SECRETS_WRAPPED_DATA_KEY: wrappedDataKey,
          },
          { kms },
        ).name,
        'kms',
      );
      assert.strictEqual(secretsKeyProviderFromEnv({}).name, 'local');
      assert.throws(
        () => secretsKeyProviderFromEnv({ SECRETS_KMS_KEY_ARN: 'arn:x' }),
        /must be set together, but only SECRETS_KMS_KEY_ARN is set/,
      );
      assert.throws(
        () =>
          secretsKeyProviderFromEnv({
            SECRETS_WRAPPED_DATA_KEY: wrappedDataKey,
          }),
        /must be set together, but only SECRETS_WRAPPED_DATA_KEY is set/,
      );
    });
  });

  module('additional data keys', function () {
    const KEY_ARN = 'arn:aws:kms:us-east-1:111122223333:key/test';

    test('additional data keys open what they sealed, and every new seal uses the current data key', async function (assert) {
      let oldKey = randomBytes(32);
      let newKey = randomBytes(32);
      let { kms, wrappedDataKeys, calls } = fakeKmsWithKeys([oldKey, newKey]);
      let [oldBlob, newBlob] = wrappedDataKeys;
      let oldKeyId = wrappedDataKeyId(Buffer.from(oldBlob, 'base64'));
      let newKeyId = wrappedDataKeyId(Buffer.from(newBlob, 'base64'));
      let binding = { field: FIELD, owner: OWNER, id: ROW_ID };
      let sealedUnderOld = new SecretsKeyring(
        [{ keyId: oldKeyId, key: oldKey }],
        oldKeyId,
      ).seal(SECRET, binding);
      let sealedUnderNew = new SecretsKeyring(
        [{ keyId: newKeyId, key: newKey }],
        newKeyId,
      ).seal(SECRET, binding);

      let ring = await startSecretsAtRest({
        deployed: true,
        env: {
          SECRETS_KMS_KEY_ARN: KEY_ARN,
          SECRETS_WRAPPED_DATA_KEY: newBlob,
          SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS: ` ${oldBlob} ,`,
        },
        kms,
      });

      assert.strictEqual(calls.length, 2, 'KMS unwraps each data key once');
      assert.strictEqual(ring.currentKeyId, newKeyId);
      assert.deepEqual(ring.keyIds, [newKeyId, oldKeyId]);
      assert.strictEqual(ring.open(sealedUnderOld, binding), SECRET);
      assert.strictEqual(ring.open(sealedUnderNew, binding), SECRET);
      assert.strictEqual(ring.seal(SECRET, binding).keyId, newKeyId);
    });

    test('a data key that is both current and additional fails startup', async function (assert) {
      let { kms, wrappedDataKeys, calls } = fakeKmsWithKeys([randomBytes(32)]);
      let error: unknown;
      try {
        await startSecretsAtRest({
          deployed: true,
          env: {
            SECRETS_KMS_KEY_ARN: KEY_ARN,
            SECRETS_WRAPPED_DATA_KEY: wrappedDataKeys[0],
            SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS: wrappedDataKeys[0],
          },
          kms,
        });
      } catch (e) {
        error = e;
      }
      assert.true(/is listed more than once/.test(String(error)));
      assert.strictEqual(calls.length, 0, 'nothing is unwrapped');
      assert.throws(() => secretsKeyring(), /not loaded/);
    });

    test('an additional data key that does not unwrap fails startup', async function (assert) {
      let { kms, wrappedDataKeys } = fakeKmsWithKeys([randomBytes(32)]);
      let error: unknown;
      try {
        await startSecretsAtRest({
          deployed: true,
          env: {
            SECRETS_KMS_KEY_ARN: KEY_ARN,
            SECRETS_WRAPPED_DATA_KEY: wrappedDataKeys[0],
            SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS:
              randomBytes(64).toString('base64'),
          },
          kms,
        });
      } catch (e) {
        error = e;
      }
      assert.true(/InvalidCiphertextException/.test(String(error)));
      assert.throws(() => secretsKeyring(), /not loaded/);
    });

    test('additional data keys without the KMS settings are a misconfiguration', function (assert) {
      assert.throws(
        () =>
          secretsKeyProviderFromEnv({
            SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS:
              randomBytes(64).toString('base64'),
          }),
        /SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS is set, but SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are not/,
      );
    });
  });

  module('startup self-check', function () {
    test('a deployed server refuses to start with the local provider', async function (assert) {
      let error: unknown;
      try {
        await startSecretsAtRest({ deployed: true, env: {} });
      } catch (e) {
        error = e;
      }
      assert.true(error instanceof SecretsAtRestStartupError);
      assert.true(
        String((error as Error).message).includes(
          'SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are not set',
        ),
      );
      assert.throws(() => secretsKeyring(), /not loaded/);
    });

    test('a local server starts with the local provider and reports it', async function (assert) {
      let lines = await secretsLogDuring(async () => {
        await startSecretsAtRest({ deployed: false, env: {} });
      });
      assert.deepEqual(lines, [
        'secrets at rest: provider=local deployed=false keyIds=local-development currentKeyId=local-development',
      ]);
      let binding = { field: FIELD, owner: OWNER, id: ROW_ID };
      assert.strictEqual(
        secretsKeyring().open(secretsKeyring().seal(SECRET, binding), binding),
        SECRET,
      );
      assert.strictEqual(new LocalKeyProvider().name, 'local');
    });

    test('a deployed server with KMS settings starts and reports its key ids, never key material', async function (assert) {
      let dataKey = randomBytes(32);
      let { kms, wrappedDataKey } = fakeKms(dataKey);
      let env = {
        SECRETS_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:111122223333:key/test',
        SECRETS_WRAPPED_DATA_KEY: wrappedDataKey,
      };
      let keyId = new KmsKeyProvider({
        keyArn: env.SECRETS_KMS_KEY_ARN,
        wrappedDataKey,
        kms,
      }).keyId;
      let lines = await secretsLogDuring(async () => {
        await startSecretsAtRest({ deployed: true, env, kms });
      });
      assert.deepEqual(lines, [
        `secrets at rest: provider=kms deployed=true keyIds=${keyId} currentKeyId=${keyId}`,
      ]);
      for (let encoding of ['hex', 'base64'] as const) {
        assert.false(
          lines.join('\n').includes(dataKey.toString(encoding)),
          `the data key does not appear in the log (${encoding})`,
        );
      }
    });

    test('a data key KMS refuses to unwrap stops startup', async function (assert) {
      let { kms } = fakeKms(randomBytes(32));
      let error: unknown;
      try {
        await startSecretsAtRest({
          deployed: true,
          env: {
            SECRETS_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:111122223333:key/test',
            SECRETS_WRAPPED_DATA_KEY: randomBytes(64).toString('base64'),
          },
          kms,
        });
      } catch (e) {
        error = e;
      }
      assert.true(/InvalidCiphertextException/.test(String(error)));
      assert.throws(() => secretsKeyring(), /not loaded/);
    });
  });
  module('worker keyring handoff', function () {
    // The two ends of the IPC channel between a worker manager and one worker:
    // the worker's `send` reaches the manager's handler, and the manager's
    // answer is emitted on the worker's side.
    function ipcPair(answer: (message: unknown) => string | undefined) {
      let worker = new EventEmitter() as EventEmitter & {
        send: (message: unknown) => boolean;
      };
      let sent: unknown[] = [];
      worker.send = (message: unknown) => {
        sent.push(message);
        let reply = answer(message);
        if (reply !== undefined) {
          setImmediate(() => worker.emit('message', reply));
        }
        return true;
      };
      return { worker, sent };
    }

    test('workers take the keys the manager unwrapped, and never call KMS themselves', async function (assert) {
      let dataKey = randomBytes(32);
      let { kms, wrappedDataKey, calls } = fakeKms(dataKey);
      let unwrapped = await unwrapDataKeys({
        deployed: true,
        env: {
          SECRETS_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:111122223333:key/test',
          SECRETS_WRAPPED_DATA_KEY: wrappedDataKey,
        },
        kms,
      });
      let managerAnswer = encodeSecretsKeyringIpc(unwrapped);

      let binding = {
        field: FIELD,
        owner: OWNER,
        id: ROW_ID,
        destination: DESTINATION,
      };
      let sealed = new SecretsKeyring(
        [{ keyId: unwrapped.currentKeyId, key: dataKey }],
        unwrapped.currentKeyId,
      ).seal(SECRET, binding);

      for (let i = 0; i < 3; i++) {
        resetSecretsAtRest();
        let { worker, sent } = ipcPair((message) =>
          message === SECRETS_KEYRING_REQUEST ? managerAnswer : undefined,
        );
        let lines = await secretsLogDuring(async () => {
          await receiveSecretsKeyring({ channel: worker as any });
        });
        assert.deepEqual(sent, [SECRETS_KEYRING_REQUEST]);
        assert.strictEqual(secretsKeyring().open(sealed, binding), SECRET);
        assert.false(
          lines.join('\n').includes(dataKey.toString('base64')),
          'the worker does not log the key it received',
        );
      }
      assert.strictEqual(
        calls.length,
        1,
        'only the manager called KMS, once, however many workers started',
      );
    });

    test('a worker refuses to start when the manager does not answer', async function (assert) {
      let { worker } = ipcPair(() => undefined);
      let error: unknown;
      try {
        await receiveSecretsKeyring({ channel: worker as any, timeoutMs: 50 });
      } catch (e) {
        error = e;
      }
      assert.true(/did not send the data keys within 50ms/.test(String(error)));
      assert.throws(() => secretsKeyring(), /not loaded/);
    });

    test('a worker with no IPC channel refuses to start', async function (assert) {
      let error: unknown;
      try {
        await receiveSecretsKeyring({
          channel: { on() {}, off() {}, send: undefined } as any,
        });
      } catch (e) {
        error = e;
      }
      assert.true(/has no IPC channel/.test(String(error)));
    });
  });
});
