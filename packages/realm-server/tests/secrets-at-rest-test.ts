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
      let binding = { owner: OWNER, id: ROW_ID, destination: DESTINATION };
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
      let binding = { owner: OWNER, id: ROW_ID };
      let first = ring.seal(SECRET, binding);
      let second = ring.seal(SECRET, binding);
      assert.false(first.nonce.equals(second.nonce));
      assert.false(first.ciphertext.equals(second.ciphertext));
    });

    test('tampering with the ciphertext, tag or nonce stops it opening', function (assert) {
      let ring = keyring();
      let binding = { owner: OWNER, id: ROW_ID, destination: DESTINATION };
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

    test('a secret moved to another owner, row or destination does not open', function (assert) {
      let ring = keyring();
      let binding = { owner: OWNER, id: ROW_ID, destination: DESTINATION };
      let sealed = ring.seal(SECRET, binding);

      for (let [label, other] of [
        ['owner', { ...binding, owner: '@other-owner:example.test' }],
        ['id', { ...binding, id: 'another-row' }],
        ['destination', { ...binding, destination: 'https://evil.example/' }],
        ['no destination', { owner: OWNER, id: ROW_ID }],
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

    test('a secret sealed under a data key the process has not loaded does not open', function (assert) {
      let sealed = keyring('k1').seal(SECRET, { owner: OWNER, id: ROW_ID });
      let error = openError(keyring('k2'), sealed, {
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
      let binding = { owner: OWNER, id: ROW_ID };
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
      let pending = { owner: OWNER, id: ROW_ID };
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
      let sealed = ring.seal(SECRET, { owner: OWNER, id: ROW_ID });
      assert.throws(
        () =>
          ring.reseal(
            sealed,
            { owner: '@other-owner:example.test', id: ROW_ID },
            {
              owner: '@other-owner:example.test',
              id: ROW_ID,
              destination: DESTINATION,
            },
          ),
        SecretDecryptionError,
      );
    });

    test('re-sealing moves the value onto the current data key', function (assert) {
      let binding = { owner: OWNER, id: ROW_ID };
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
    test('the context carries owner, id and the SHA-256 of the destination, never the destination', function (assert) {
      let context = secretEncryptionContext({
        owner: OWNER,
        id: ROW_ID,
        destination: DESTINATION,
      });
      assert.deepEqual(context, {
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
      assert.deepEqual(secretEncryptionContext({ owner: OWNER, id: ROW_ID }), {
        owner: OWNER,
        id: ROW_ID,
      });
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

      let binding = { owner: OWNER, id: ROW_ID };
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
      let binding = { owner: OWNER, id: ROW_ID };
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

      let binding = { owner: OWNER, id: ROW_ID, destination: DESTINATION };
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
