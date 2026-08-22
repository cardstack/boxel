import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inspectStore, pack, publishToStore } from '@cardstack/deck/node';
import {
  deckLibSpecFromPackage,
  planDeckInstall,
  planDeckRemix,
  planDeckUse,
  type DeckLibSpec,
} from '@cardstack/runtime-common';
import QUnit from 'qunit';

const { module, test } = QUnit;

const dispatchDashboard: DeckLibSpec = {
  packageRRI: '@catalog/dispatch-dashboard@3.4.0/',
  specifier: '@acme/dispatch-dashboard',
  entry: 'app/dashboard.js',
  lock: {
    imports: {
      '@acme/charts': '@catalog/charts@2.8.1/index.js',
      '@acme/theme': '@catalog/theme@1.6.0/index.js',
    },
    scopes: {
      '@catalog/dispatch-dashboard@3.4.0/legacy/': {
        '@acme/charts': '@catalog/charts@1.9.0/index.js',
      },
    },
    integrity: {
      '@catalog/charts@2.8.1/index.js': 'sha256-charts-281',
      '@catalog/theme@1.6.0/index.js': 'sha256-theme-160',
    },
  },
};

function productPack(version: string) {
  return pack([
    {
      path: 'package.json',
      bytes: Buffer.from(
        JSON.stringify({
          name: '@acme/dispatch-dashboard',
          version,
          type: 'module',
          exports: './app/dashboard.js',
        }) + '\n',
      ),
    },
    {
      path: 'importmap.json',
      bytes: Buffer.from(JSON.stringify(dispatchDashboard.lock) + '\n'),
    },
    {
      path: 'app/dashboard.js',
      bytes: Buffer.from('export { dashboard } from "./views/view-00.js";\n'),
    },
    ...Array.from({ length: 48 }, (_, index) => ({
      path: `app/views/view-${String(index).padStart(2, '0')}.js`,
      bytes: Buffer.from(`export const dashboard = "view ${index}";\n`),
    })),
  ]);
}

module('thin Deck adoption verbs', function (hooks) {
  let root: string;
  let storeDir: string;
  let consumerDir: string;

  hooks.beforeEach(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-adopt-'));
    storeDir = join(root, 'catalog', '.deck', 'store');
    consumerDir = join(root, 'ana', 'dispatch-control');
    await mkdir(consumerDir, { recursive: true });
    await publishToStore(
      storeDir,
      'catalog/dispatch-dashboard',
      '3.4.0',
      productPack('3.4.0'),
    );
  });

  hooks.afterEach(async function () {
    await rm(root, { recursive: true, force: true });
  });

  test('use selects an immutable entry and writes nothing', function (assert) {
    let plan = planDeckUse(dispatchDashboard);

    assert.strictEqual(plan.verb, 'use');
    assert.strictEqual(
      plan.selected,
      '@catalog/dispatch-dashboard@3.4.0/app/dashboard.js',
    );
    assert.deepEqual(plan.writes, []);
    assert.deepEqual(plan.filesToCopy, []);
  });

  test('conventional package documents adapt into the thin action contract', function (assert) {
    let spec = deckLibSpecFromPackage({
      packageRRI: '@catalog/dispatch-dashboard@3.4.0/',
      packageJson: {
        name: '@acme/dispatch-dashboard',
        version: '3.4.0',
        exports: { '.': { browser: './app/dashboard.js' } },
      },
      lock: dispatchDashboard.lock,
    });

    assert.deepEqual(spec, dispatchDashboard);
  });

  test('install writes one exact lock without copying package files', function (assert) {
    let plan = planDeckInstall(dispatchDashboard, {
      imports: {
        '@acme/session': '@catalog/session@4.1.0/index.js',
      },
      scopes: {},
    });
    let written = JSON.parse(plan.writes[0].contents);

    assert.deepEqual(plan.filesToCopy, []);
    assert.deepEqual(
      plan.writes.map((write) => write.path),
      ['importmap.json'],
    );
    assert.strictEqual(
      written.imports['@acme/dispatch-dashboard'],
      '@catalog/dispatch-dashboard@3.4.0/app/dashboard.js',
    );
    assert.strictEqual(
      written.imports['@acme/charts'],
      '@catalog/charts@2.8.1/index.js',
    );
    assert.strictEqual(
      written.imports['@acme/session'],
      '@catalog/session@4.1.0/index.js',
    );
  });

  test('remix leaves the 51-file product in CAS and authors only inheritance', async function (assert) {
    let before = await inspectStore(storeDir);
    let plan = planDeckRemix(dispatchDashboard);
    for (let write of plan.writes) {
      await writeFile(join(consumerDir, write.path), write.contents);
    }
    let after = await inspectStore(storeDir);
    let authoredFiles = await readdir(consumerDir);
    let authored = JSON.parse(plan.writes[0].contents);

    assert.deepEqual(authoredFiles, ['importmap.json']);
    assert.deepEqual(plan.filesToCopy, []);
    assert.strictEqual(authored.deck.extends, dispatchDashboard.packageRRI);
    assert.deepEqual(authored.imports, {});
    assert.deepEqual(authored.scopes, {});
    assert.deepEqual(after, before, 'remix writes no tree or object into CAS');
    assert.strictEqual(
      plan.effectiveLock.imports['@acme/theme'],
      '@catalog/theme@1.6.0/index.js',
      'the untouched dependency remains inherited',
    );
  });

  test('a remix override changes one binding and inherited scopes follow it', function (assert) {
    let plan = planDeckRemix(dispatchDashboard, {
      imports: {
        '@acme/charts': '@ana/charts@2.8.1-dispatch.1/index.js',
      },
      scopes: {},
    });
    let authored = JSON.parse(plan.writes[0].contents);

    assert.deepEqual(authored.imports, {
      '@acme/charts': '@ana/charts@2.8.1-dispatch.1/index.js',
    });
    assert.strictEqual(
      plan.effectiveLock.imports['@acme/charts'],
      '@ana/charts@2.8.1-dispatch.1/index.js',
    );
    assert.strictEqual(
      plan.effectiveLock.scopes['@catalog/dispatch-dashboard@3.4.0/legacy/'][
        '@acme/charts'
      ],
      '@ana/charts@2.8.1-dispatch.1/index.js',
      'Deck inheritance propagates an override into inherited scopes',
    );
    assert.strictEqual(
      plan.effectiveLock.imports['@acme/theme'],
      '@catalog/theme@1.6.0/index.js',
      '47 other modules and the theme remain inherited',
    );
  });

  test('mutable packages and mutable dependency targets fail closed', function (assert) {
    assert.throws(
      () =>
        planDeckUse({
          ...dispatchDashboard,
          packageRRI: '@catalog/dispatch-dashboard/',
        }),
      /exact package root/,
    );
    assert.throws(
      () =>
        planDeckInstall({
          ...dispatchDashboard,
          lock: {
            imports: { theme: '@catalog/theme/index.js' },
            scopes: {},
          },
        }),
      /only target exact Versions/,
    );
  });
});
