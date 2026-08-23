import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pack, publishToStore } from '@cardstack/deck/node';
import QUnit from 'qunit';

import {
  buildDeckVersionIndex,
  queryDeckVersionIndex,
} from '../lib/deck-version-index.ts';

const { module, test } = QUnit;

module('immutable Deck Version index', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-version-index-'));
    let bytes = pack([
      {
        path: 'package.json',
        bytes: Buffer.from(
          JSON.stringify({ name: '@cardstack/pretui', version: '0.4.0' }),
        ),
      },
      {
        path: 'PretuiComponent/knowndate.json',
        bytes: Buffer.from(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                componentName: 'KnownDate',
                category: 'Inputs',
                brief: 'Birthday and expiry entry with permissive parsing',
              },
              meta: {
                adoptsFrom: {
                  module: '../pretui-component',
                  name: 'PretuiComponent',
                },
              },
            },
          }),
        ),
      },
      {
        path: 'controls-known-date.gts',
        bytes: Buffer.from('export class KnownDate {}'),
      },
    ]);
    await publishToStore(
      join(realmDir, '.deck', 'store'),
      'cardstack/pretui',
      '0.4.0',
      bytes,
      { now: new Date('2026-08-23T00:00:00.000Z') },
    );
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('persists and reuses a deterministic snapshot keyed by tree hash', async function (assert) {
    let first = await buildDeckVersionIndex({
      realmDir,
      packageName: 'cardstack/pretui',
      version: '0.4.0',
    });
    let second = await buildDeckVersionIndex({
      realmDir,
      packageName: 'cardstack/pretui',
      version: '0.4.0',
    });
    let stored = JSON.parse(
      await readFile(
        join(
          realmDir,
          '.deck',
          'indexes',
          'versions',
          `${first.treeHash}.json`,
        ),
        'utf8',
      ),
    );

    assert.deepEqual(second, first);
    assert.strictEqual(stored.indexHash, first.indexHash);
    assert.strictEqual(
      first.cards[0].rri,
      '@cardstack/pretui@0.4.0/PretuiComponent/knowndate',
    );
    assert.strictEqual(queryDeckVersionIndex(first, 'birthday').length, 1);
    assert.strictEqual(queryDeckVersionIndex(first, 'route map').length, 0);
  });
});
