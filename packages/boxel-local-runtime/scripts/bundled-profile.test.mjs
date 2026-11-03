import assert from 'node:assert/strict';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareBundledBoxelProfile } from '../src/bundled-profile.ts';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'boxel-bundled-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assetDirectory = path.join(root, 'installed');
  const dataDirectory = path.join(root, 'user data');
  const assets = {
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    postgresBin: 'postgres/bin',
    tuwunelBinary: 'matrix/tuwunel',
    chromeBinary: 'chrome/chrome',
    ollamaBinary: 'ollama/ollama',
    modelsDirectory: 'models',
    modelIds: ['fixture:1'],
    titleModel: 'fixture:1',
  };
  for (const file of [
    assets.tuwunelBinary,
    assets.chromeBinary,
    assets.ollamaBinary,
    'models/manifest',
  ]) {
    await mkdir(path.dirname(path.join(assetDirectory, file)), {
      recursive: true,
    });
    await writeFile(path.join(assetDirectory, file), 'fixture');
  }
  await mkdir(path.join(assetDirectory, assets.postgresBin), {
    recursive: true,
  });
  const save = () =>
    writeFile(
      path.join(assetDirectory, 'native-assets.json'),
      JSON.stringify(assets),
    );
  await save();
  return { assets, assetDirectory, dataDirectory, save };
}

test('creates a private native profile and writable model cache without modifying installed assets', async (t) => {
  const options = await fixture(t);
  const profile = await prepareBundledBoxelProfile(options);
  const result = JSON.parse(await readFile(profile, 'utf8'));
  assert.equal(
    result.ollama.modelsDirectory,
    path.join(await realpath(options.dataDirectory), 'models'),
  );
  assert.equal((await stat(profile)).mode & 0o077, 0);
  await assert.rejects(
    readFile(path.join(options.dataDirectory, 'models/manifest')),
    { code: 'ENOENT' },
  );
  const userModel = path.join(result.ollama.modelsDirectory, 'manifest');
  await writeFile(userModel, 'user model');
  await prepareBundledBoxelProfile(options);
  assert.equal(await readFile(userModel, 'utf8'), 'user model');
  assert.equal(
    await readFile(
      path.join(options.assetDirectory, 'models/manifest'),
      'utf8',
    ),
    'fixture',
  );
});

test('preserves an explicit private native profile instead of replacing its configuration', async (t) => {
  const options = await fixture(t);
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  const profile = path.join(options.dataDirectory, 'profile.json');
  const contents = JSON.stringify({ custom: 'existing configuration' });
  await writeFile(profile, contents, { mode: 0o600 });
  assert.equal(
    await prepareBundledBoxelProfile(options),
    await realpath(profile),
  );
  assert.equal(await readFile(profile, 'utf8'), contents);
});

test('rejects unsupported assets, path traversal, external symlinks and writes inside the installation', async (t) => {
  const options = await fixture(t);
  const original = options.assets.tuwunelBinary;
  options.assets.tuwunelBinary = '../outside';
  await options.save();
  await assert.rejects(prepareBundledBoxelProfile(options), /asset path/);
  options.assets.tuwunelBinary = 'external';
  await symlink('/etc/hosts', path.join(options.assetDirectory, 'external'));
  await options.save();
  await assert.rejects(prepareBundledBoxelProfile(options), /escapes/);
  options.assets.tuwunelBinary = original;
  await options.save();
  await assert.rejects(
    prepareBundledBoxelProfile({
      ...options,
      dataDirectory: path.join(options.assetDirectory, 'data'),
    }),
    /outside/,
  );
  options.assets.arch = 'unsupported';
  await options.save();
  await assert.rejects(prepareBundledBoxelProfile(options), /support/);
});

test('supports a hosted-first package without Ollama or seeded weights', async (t) => {
  const options = await fixture(t);
  options.assets.ollamaBinary = null;
  options.assets.modelsDirectory = null;
  await options.save();
  const filename = await prepareBundledBoxelProfile(options);
  const result = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(result.ollama, undefined);
  assert.equal(result.modelBaseURL, 'http://127.0.0.1:11434/v1');
  await assert.rejects(
    readFile(path.join(options.dataDirectory, 'models/manifest')),
    { code: 'ENOENT' },
  );
});

test('relocates managed binaries across releases while preserving user model cache and policies', async (t) => {
  const options = await fixture(t);
  const previous = path.join(
    path.dirname(options.assetDirectory),
    'previous assets',
  );
  await cp(options.assetDirectory, previous, { recursive: true });
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  const filename = path.join(options.dataDirectory, 'profile.json');
  const saved = {
    postgresBin: path.join(previous, options.assets.postgresBin),
    tuwunelBinary: path.join(previous, options.assets.tuwunelBinary),
    chromeBinary: '/custom/browser',
    ollama: {
      binary: path.join(previous, options.assets.ollamaBinary),
      modelsDirectory: '/custom/models',
    },
    publishedProxyPolicies: [{ name: 'geography' }],
  };
  await writeFile(filename, JSON.stringify(saved), { mode: 0o600 });
  await prepareBundledBoxelProfile({
    ...options,
    previousAssetDirectories: [previous],
  });
  const actual = JSON.parse(await readFile(filename, 'utf8'));
  const currentAssets = await realpath(options.assetDirectory);
  assert.deepEqual(actual, {
    ...saved,
    postgresBin: path.join(currentAssets, options.assets.postgresBin),
    tuwunelBinary: path.join(currentAssets, options.assets.tuwunelBinary),
    ollama: {
      ...saved.ollama,
      binary: path.join(currentAssets, options.assets.ollamaBinary),
    },
  });
  assert.equal((await stat(filename)).mode & 0o077, 0);
});
