import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  assertPortableLinks,
  isRuntimeSource,
  stageRuntimeTree,
} from './package-tree.mjs';

const exec = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'boxel-package-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'checkout');
  await mkdir(sourceRoot);
  const git = (args) => exec('git', args, { cwd: sourceRoot });
  await git(['init', '--quiet']);
  await mkdir(path.join(sourceRoot, 'scripts'));
  await writeFile(
    path.join(sourceRoot, 'scripts/env-slug.js'),
    'exports.sanitizeSlug = (value) => value.toLowerCase();',
  );
  for (const name of [
    'boxel-local-runtime',
    'realm-server',
    'ai-bot',
    'base',
    'host',
    'boxel-icons',
  ]) {
    const directory = path.join(sourceRoot, 'packages', name);
    await mkdir(path.join(directory, 'dist'), { recursive: true });
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: `@cardstack/${name}`, type: 'module' }),
    );
    await writeFile(
      path.join(directory, 'dist/index.js'),
      'export const version = 1;',
    );
  }
  await git(['add', '.']);
  await git([
    '-c',
    'user.name=Package fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ]);
  return { root, sourceRoot, destination: path.join(root, 'payload'), git };
}

test('moves the installed dependency graph without the source checkout or package manager', async (t) => {
  const { root, sourceRoot, destination, git } = await fixture(t);
  const realm = path.join(sourceRoot, 'packages/realm-server');
  const deletedSource = path.join(realm, 'deleted-local-script.cjs');
  await writeFile(deletedSource, 'do not ship deleted source');
  await git(['add', 'packages/realm-server/deleted-local-script.cjs']);
  await rm(deletedSource);
  const dependency = path.join(
    sourceRoot,
    'node_modules/.pnpm/fixture/node_modules/runtime-fixture',
  );
  await mkdir(dependency, { recursive: true });
  await writeFile(
    path.join(dependency, 'package.json'),
    JSON.stringify({
      name: 'runtime-fixture',
      type: 'module',
      exports: './index.js',
    }),
  );
  await writeFile(path.join(dependency, 'index.js'), 'export default 42;');
  await mkdir(path.join(dependency, 'test'));
  await writeFile(path.join(dependency, 'test/snakeoil.key'), 'fixture key');
  await writeFile(path.join(dependency, '.DS_Store'), 'finder state');
  await writeFile(path.join(dependency, 'LICENSE'), 'fixture license');
  await mkdir(path.join(realm, 'node_modules'));
  await symlink(dependency, path.join(realm, 'node_modules/runtime-fixture'));
  await writeFile(
    path.join(realm, 'package.json'),
    JSON.stringify({
      name: '@cardstack/realm-server',
      type: 'module',
      dependencies: { 'runtime-fixture': '1.0.0' },
      devDependencies: { 'not-installed-build-only': '1.0.0' },
    }),
  );
  await writeFile(
    path.join(realm, 'main.js'),
    "import value from 'runtime-fixture'; import { sanitizeSlug } from '../../scripts/env-slug.js'; export default [value, sanitizeSlug('EXPERIMENT')];",
  );
  await writeFile(path.join(realm, '.env'), 'do not ship');
  await writeFile(path.join(realm, 'profile.json'), 'do not ship');
  const metadata = await stageRuntimeTree({ sourceRoot, destination });
  assert.equal(metadata.packageCount, 7);
  assert.equal(metadata.developmentSourceLink, false);
  await assert.rejects(
    readFile(
      path.join(destination, 'packages/realm-server/deleted-local-script.cjs'),
    ),
  );
  await assert.rejects(
    readFile(path.join(destination, 'packages/realm-server/.env')),
  );
  await assert.rejects(
    readFile(path.join(destination, 'packages/realm-server/profile.json')),
  );
  await rm(sourceRoot, { recursive: true });
  const moved = path.join(root, 'moved payload');
  await rename(destination, moved);
  await assertPortableLinks(moved);
  const installedDependency = await realpath(
    path.join(moved, 'packages/realm-server/node_modules/runtime-fixture'),
  );
  await assert.rejects(
    readFile(path.join(installedDependency, 'test/snakeoil.key')),
  );
  await assert.rejects(readFile(path.join(installedDependency, '.DS_Store')));
  assert.equal(
    await readFile(path.join(installedDependency, 'LICENSE'), 'utf8'),
    'fixture license',
  );
  assert.deepEqual(
    (
      await import(
        pathToFileURL(path.join(moved, 'packages/realm-server/main.js')).href
      )
    ).default,
    [42, 'experiment'],
  );
});

test('rejects dependencies with links outside the artifact and removes incomplete output', async (t) => {
  const { sourceRoot, destination } = await fixture(t);
  const base = path.join(sourceRoot, 'packages/base');
  await symlink('/etc/hosts', path.join(base, 'external.txt'));
  await assert.rejects(
    stageRuntimeTree({ sourceRoot, destination }),
    /regular files/,
  );
  await assert.rejects(readFile(path.join(destination, 'runtime-build.json')));
});

test('refuses to overwrite output or build inside a source checkout', async (t) => {
  const { sourceRoot, destination } = await fixture(t);
  await assert.rejects(
    stageRuntimeTree({
      sourceRoot,
      destination: path.join(sourceRoot, 'release'),
    }),
    /outside/,
  );
  await mkdir(destination);
  await writeFile(path.join(destination, 'keep'), 'existing data');
  await assert.rejects(
    stageRuntimeTree({ sourceRoot, destination }),
    /already exists/,
  );
  assert.equal(
    await readFile(path.join(destination, 'keep'), 'utf8'),
    'existing data',
  );
});

test('excludes local state, environment files and test fixtures', () => {
  for (const file of [
    '.env',
    '.env.production',
    'local/.env',
    '.git/config',
    '.boxel-history/card.json',
    'tests/account.json',
    'test-fixtures/secret.txt',
    'secrets.bin',
    'credentials.json',
    'profile.json',
  ])
    assert.equal(isRuntimeSource(file), false, file);
  for (const file of [
    'migrations/001.ts',
    'scripts/migration-name-fixes.cjs',
    '.realm.json',
    '.boxelignore',
    'card-api.gts',
  ])
    assert.equal(isRuntimeSource(file), true, file);
});

test('includes generated Boxel UI assets resolved by the secure sign-in server', async (t) => {
  const { sourceRoot, destination, git } = await fixture(t);
  const realm = path.join(sourceRoot, 'packages/realm-server');
  const ui = path.join(sourceRoot, 'packages/boxel-ui');
  await mkdir(path.join(ui, 'dist/styles'), { recursive: true });
  await writeFile(path.join(ui, '.gitignore'), 'dist/\n');
  await writeFile(
    path.join(ui, 'package.json'),
    JSON.stringify({
      name: '@cardstack/boxel-ui',
      exports: { './styles/*': './dist/styles/*' },
    }),
  );
  await writeFile(
    path.join(ui, 'dist/styles/fonts.css'),
    'body { font-family: fixture; }',
  );
  await writeFile(
    path.join(realm, 'package.json'),
    JSON.stringify({
      name: '@cardstack/realm-server',
      devDependencies: { '@cardstack/boxel-ui': 'workspace:*' },
    }),
  );
  await mkdir(path.join(realm, 'node_modules/@cardstack'), { recursive: true });
  await symlink(ui, path.join(realm, 'node_modules/@cardstack/boxel-ui'));
  await git(['add', '.']);
  await stageRuntimeTree({ sourceRoot, destination });
  await rm(sourceRoot, { recursive: true });
  const { createRequire } = await import('node:module');
  const require = createRequire(
    path.join(destination, 'packages/realm-server/main.js'),
  );
  assert.equal(
    await readFile(
      require.resolve('@cardstack/boxel-ui/styles/fonts.css'),
      'utf8',
    ),
    'body { font-family: fixture; }',
  );
});

for (const [version, included] of [
  ['1.0.0', false],
  ['2.1.0', true],
]) {
  test(`stages only compatible installed optional peers (${version})`, async (t) => {
    const { sourceRoot, destination } = await fixture(t);
    const dependency = path.join(sourceRoot, 'node_modules/optional-fixture');
    await mkdir(dependency, { recursive: true });
    await writeFile(
      path.join(dependency, 'package.json'),
      JSON.stringify({ name: 'optional-fixture', version }),
    );
    await writeFile(
      path.join(sourceRoot, 'packages/realm-server/package.json'),
      JSON.stringify({
        name: '@cardstack/realm-server',
        peerDependencies: { 'optional-fixture': '^2.0.0' },
        peerDependenciesMeta: { 'optional-fixture': { optional: true } },
      }),
    );
    const metadata = await stageRuntimeTree({ sourceRoot, destination });
    assert.equal(metadata.packageCount, included ? 7 : 6);
    const installed = path.join(
      destination,
      'packages/realm-server/node_modules/optional-fixture/package.json',
    );
    if (included)
      assert.equal(
        JSON.parse(await readFile(installed, 'utf8')).version,
        version,
      );
    else await assert.rejects(readFile(installed), { code: 'ENOENT' });
  });
}
