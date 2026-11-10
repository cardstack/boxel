import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createLocalSecretsStore } from '../../realm-server/lib/local-secrets.ts';
import { createLocalIdentityStore } from '../../realm-server/lib/local-identity-store.ts';

const synchronous = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`sealed:${value}`),
  decryptString: (value) => {
    const text = value.toString();
    if (!text.startsWith('sealed:')) throw new Error('Invalid ciphertext');
    return text.slice(7);
  },
};
const asynchronous = {
  ...synchronous,
  encryptString: async (value) => synchronous.encryptString(value),
  decryptString: async (value) => synchronous.decryptString(value),
};

test('async native encryption preserves secrets created by the synchronous provider', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'boxel-async-secrets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    BOXEL_LOCAL_SECRETS_PROVIDER: 'keychain',
    BOXEL_LOCAL_SECRETS_DIR: directory,
  };
  const original = await createLocalSecretsStore(
    env,
    synchronous,
  ).loadOrCreate();
  const bytes = await readFile(path.join(directory, 'secrets.bin'));
  assert.deepEqual(
    await createLocalSecretsStore(env, asynchronous).loadOrCreate(),
    original,
  );
  assert.deepEqual(await readFile(path.join(directory, 'secrets.bin')), bytes);
  const failing = {
    ...asynchronous,
    decryptString: async () => {
      throw new Error('Unavailable');
    },
  };
  await assert.rejects(
    createLocalSecretsStore(env, failing).loadOrCreate(),
    /Cannot unlock/,
  );
  assert.deepEqual(await readFile(path.join(directory, 'secrets.bin')), bytes);
});

test('async native identity encryption reopens existing key records without replacing them', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'boxel-async-identity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = {
    directory,
    stackId: 'default',
    localMatrixServerName: 'default.boxel.localhost',
    hostedVerifier: { verify: async () => undefined },
  };
  await createLocalIdentityStore({ ...options, encryption: synchronous });
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const before = await Promise.all(
    files.map((name) => readFile(path.join(directory, name))),
  );
  const store = await createLocalIdentityStore({
    ...options,
    encryption: asynchronous,
  });
  assert.equal(await store.isLinked('@bob:default.boxel.localhost'), false);
  assert.deepEqual(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
    files,
  );
  assert.deepEqual(
    await Promise.all(
      files.map((name) => readFile(path.join(directory, name))),
    ),
    before,
  );
});
