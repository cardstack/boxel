import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { StoreMeta } from '@cardstack/deck/node';
import {
  selectInvalidations,
  type DependencyRow,
} from '../lib/package-publish-invalidation.ts';

// Publishing a compatible Version and working out who was running code that
// just changed underneath them. `deck-the-range-is-on-disk.md` §3, first
// bullet.
//
// The interesting cases are all about the difference between SATISFIES and
// RESOLVES TO. Getting that wrong in the permissive direction reindexes every
// realm on every backport; getting it wrong in the strict direction leaves
// instances indexed against code they are no longer running, which is the
// exact divergence this work exists to close.

const REALM = 'https://realm.example.com/experiments/';
const OTHER = 'https://realm.example.com/other/';
const NAME = 'experiments/greeter';

function meta(
  versions: string[],
  tags: Record<string, string> = {},
): StoreMeta {
  return {
    name: NAME,
    versions: Object.fromEntries(
      versions.map((v) => [v, {} as StoreMeta['versions'][string]]),
    ),
    tags,
  };
}

// The dep spelling the index actually holds: absolute, percent-encoded,
// executable extension already trimmed.
function dep(spec: string, path = 'index'): string {
  return `https://realm.example.com/demo/_packages/${NAME}@${encodeURIComponent(
    spec,
  )}/${path}`;
}

function row(url: string, spec: string, realmURL = REALM): DependencyRow {
  return { realmURL, url, dep: dep(spec) };
}

module(basename(import.meta.filename), function () {
  module('a published Version invalidates the ranges it now answers', () => {
    test('the range that advances is selected', function (assert) {
      let selected = selectInvalidations({
        rows: [row(`${REALM}pinned-to-v2.json`, '^2.0.0')],
        meta: meta(['2.0.0', '2.2.0', '2.3.0']),
        name: NAME,
        version: '2.3.0',
      });
      assert.deepEqual(selected, [
        {
          realmURL: REALM,
          urls: [`${REALM}pinned-to-v2.json`],
          ranges: ['^2.0.0'],
        },
      ]);
    });

    test('a backport onto an older line moves nothing', function (assert) {
      // `2.1.5` satisfies `^2.0.0`. It is not what `^2.0.0` resolves to —
      // `2.2.0` still wins — so nothing governed by that range is running
      // different code and nothing should be reindexed. This is the case that
      // `semver.satisfies` would get wrong.
      assert.deepEqual(
        selectInvalidations({
          rows: [row(`${REALM}pinned-to-v2.json`, '^2.0.0')],
          meta: meta(['2.0.0', '2.1.5', '2.2.0']),
          name: NAME,
          version: '2.1.5',
        }),
        [],
      );
    });

    test('a range the new Version is outside of is untouched', function (assert) {
      assert.deepEqual(
        selectInvalidations({
          rows: [row(`${REALM}pinned-to-v1.json`, '^1.0.0')],
          meta: meta(['1.4.0', '2.3.0']),
          name: NAME,
          version: '2.3.0',
        }),
        [],
      );
    });

    test('an exactly-pinned instance heals when its Version arrives', function (assert) {
      // Held, not broken: data present, intent present, code not there yet.
      // Publishing the Version it named is what makes it resolvable, so it
      // has to be reindexed for the same reason an advancing range does.
      let selected = selectInvalidations({
        rows: [row(`${REALM}waiting.json`, '2.3.0')],
        meta: meta(['2.2.0', '2.3.0']),
        name: NAME,
        version: '2.3.0',
      });
      assert.deepEqual(selected[0]?.urls, [`${REALM}waiting.json`]);
    });

    test('an exact pin to an older Version stays put', function (assert) {
      assert.deepEqual(
        selectInvalidations({
          rows: [row(`${REALM}fixture.json`, '2.2.0')],
          meta: meta(['2.2.0', '2.3.0']),
          name: NAME,
          version: '2.3.0',
        }),
        [],
        'a range of one is a promise not to move',
      );
    });

    test('a dist-tag counts when it points at the new Version', function (assert) {
      let selected = selectInvalidations({
        rows: [row(`${REALM}on-latest.json`, 'latest')],
        meta: meta(['2.2.0', '2.3.0'], { latest: '2.3.0' }),
        name: NAME,
        version: '2.3.0',
      });
      assert.deepEqual(selected[0]?.ranges, ['latest']);
    });

    test('results are grouped per realm', function (assert) {
      // Each realm reindexes itself, so the caller needs them apart — and a
      // realm mounted on a peer has to be identifiable to be skipped.
      let selected = selectInvalidations({
        rows: [
          row(`${REALM}a.json`, '^2.0.0'),
          row(`${OTHER}b.json`, '^2.1.0', OTHER),
          row(`${REALM}c.json`, '^2.0.0'),
        ],
        meta: meta(['2.0.0', '2.3.0']),
        name: NAME,
        version: '2.3.0',
      });
      assert.deepEqual(
        selected.map((s) => [s.realmURL, s.urls.length]),
        [
          [REALM, 2],
          [OTHER, 1],
        ],
      );
    });

    test('one file naming the range twice is listed once', function (assert) {
      // A module can import both `…/index` and `…/shared` from the same
      // range; the SQL returns a row per dep, and the reindex seed wants a
      // file list, not a dep list.
      let selected = selectInvalidations({
        rows: [
          { realmURL: REALM, url: `${REALM}app.gts`, dep: dep('^2.0.0') },
          {
            realmURL: REALM,
            url: `${REALM}app.gts`,
            dep: dep('^2.0.0', 'shared'),
          },
        ],
        meta: meta(['2.0.0', '2.3.0']),
        name: NAME,
        version: '2.3.0',
      });
      assert.deepEqual(selected[0]?.urls, [`${REALM}app.gts`]);
    });

    test('another package sharing the prefix is not this package', function (assert) {
      // `experiments/greeter-extras` starts with `experiments/greeter`. The
      // marker `specFrom` looks for ends in `@`, which is what keeps the two
      // apart — a plain `startsWith` on the name would not.
      assert.deepEqual(
        selectInvalidations({
          rows: [
            {
              realmURL: REALM,
              url: `${REALM}a.json`,
              dep: `https://realm.example.com/demo/_packages/${NAME}-extras@%5E2.0.0/index`,
            },
          ],
          meta: meta(['2.0.0', '2.3.0']),
          name: NAME,
          version: '2.3.0',
        }),
        [],
      );
    });

    test('a spec that is not valid percent-encoding is skipped, not fatal', function (assert) {
      // A publish that already succeeded must not be reported as an error
      // because some unrelated row is malformed.
      assert.deepEqual(
        selectInvalidations({
          rows: [
            {
              realmURL: REALM,
              url: `${REALM}a.json`,
              dep: `https://realm.example.com/demo/_packages/${NAME}@%ZZ/index`,
            },
            row(`${REALM}good.json`, '^2.0.0'),
          ],
          meta: meta(['2.0.0', '2.3.0']),
          name: NAME,
          version: '2.3.0',
        }),
        [
          {
            realmURL: REALM,
            urls: [`${REALM}good.json`],
            ranges: ['^2.0.0'],
          },
        ],
      );
    });
  });
});
