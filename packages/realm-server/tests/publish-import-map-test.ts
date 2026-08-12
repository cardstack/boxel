import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { rebindPublishedImportMap } from '../lib/publish-import-map.ts';

const SERVER = 'https://realm-server.example.com';

async function withRealm(
  map: unknown | undefined,
  fn: (dir: string) => Promise<void>,
) {
  let dir = await mkdtemp(join(tmpdir(), 'publish-import-map-'));
  try {
    if (map !== undefined) {
      await writeFile(
        join(dir, 'importmap.json'),
        typeof map === 'string' ? map : JSON.stringify(map, null, 2),
      );
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readMap(dir: string) {
  return JSON.parse(await readFile(join(dir, 'importmap.json'), 'utf8'));
}

// Publishing copies a realm onto a DIFFERENT ORIGIN. These three fixtures are
// the whole contract: what travels with the tree, what has to be re-pointed
// at the server it came from, and what is nobody's to touch.
module(basename(import.meta.filename), function () {
  module('rebind the published import map', function () {
    test('an origin-relative package pin is re-pointed at the source server', async function (assert) {
      await withRealm(
        { imports: { palette: '/demo/_packages/lib/palette@1.0.0/index.js' } },
        async (dir) => {
          let report = await rebindPublishedImportMap(dir, {
            serverURL: SERVER,
          });
          assert.strictEqual(report.rewritten, 1, 'one entry was re-homed');
          assert.strictEqual(
            (await readMap(dir)).imports.palette,
            `${SERVER}/demo/_packages/lib/palette@1.0.0/index.js`,
            'the pin now names the server that actually holds the package store',
          );
        },
      );
    });

    test('a relative reference is left exactly as it was', async function (assert) {
      // The reason most of a realm needs no re-homing: a relative reference
      // means the same thing wherever the tree is mounted, so rewriting it
      // could only make it wrong.
      await withRealm({ imports: { local: './lib/local.js' } }, async (dir) => {
        let report = await rebindPublishedImportMap(dir, { serverURL: SERVER });
        assert.strictEqual(report.rewritten, 0, 'nothing was rewritten');
        assert.strictEqual(
          (await readMap(dir)).imports.local,
          './lib/local.js',
          'the relative pin travels with the tree untouched',
        );
      });
    });

    test('a foreign absolute URL is left alone, and reported', async function (assert) {
      // The regression that matters. Rewriting someone else's URL invents an
      // address that may not exist; dropping it loses information. It
      // survives, and the caller is told what it did not carry.
      await withRealm(
        { imports: { upstream: 'https://esm.sh/three@0.169.0' } },
        async (dir) => {
          let report = await rebindPublishedImportMap(dir, {
            serverURL: SERVER,
          });
          assert.strictEqual(report.rewritten, 0, 'nothing was rewritten');
          assert.deepEqual(
            report.foreign,
            ['https://esm.sh/three@0.169.0'],
            'the reference this publish does not carry is named, not hidden',
          );
          assert.strictEqual(
            (await readMap(dir)).imports.upstream,
            'https://esm.sh/three@0.169.0',
            'and the value itself is untouched',
          );
        },
      );
    });

    test('scoped pins are re-homed like top-level ones', async function (assert) {
      await withRealm(
        {
          scopes: {
            'legacy/': {
              palette: '/demo/_packages/lib/palette@2.0.0/index.js',
            },
          },
        },
        async (dir) => {
          await rebindPublishedImportMap(dir, { serverURL: SERVER });
          assert.strictEqual(
            (await readMap(dir)).scopes['legacy/'].palette,
            `${SERVER}/demo/_packages/lib/palette@2.0.0/index.js`,
            'a scope is as origin-dependent as the realm-wide table',
          );
        },
      );
    });

    test('a depot-local parent becomes fully qualified', async function (assert) {
      // `deck.extends` resolves under the SOURCE REALM's own `_packages/`
      // door, so a published remix loses the thing it inherits unless the
      // parent is spelled absolutely — realm and all.
      await withRealm(
        { deck: { extends: 'acme/gallery@1.2.3' } },
        async (dir) => {
          await rebindPublishedImportMap(dir, {
            serverURL: SERVER,
            sourceRealmURL: `${SERVER}/demo/`,
          });
          assert.strictEqual(
            (await readMap(dir)).deck.extends,
            `${SERVER}/demo/_packages/acme/gallery@1.2.3/`,
            'the published remix can still find its parent',
          );
        },
      );
    });

    test('a bare parent is left alone when no source realm is known', async function (assert) {
      // A realm server governs no global publisher namespace, so
      // `acme/gallery@1.2.3` is meaningless without knowing whose it is.
      // Leaving it beats rewriting it to an address that resolves to the wrong
      // package or to none.
      await withRealm(
        { deck: { extends: 'acme/gallery@1.2.3' } },
        async (dir) => {
          await rebindPublishedImportMap(dir, { serverURL: SERVER });
          assert.strictEqual(
            (await readMap(dir)).deck.extends,
            'acme/gallery@1.2.3',
            'an unqualifiable parent is not guessed at',
          );
        },
      );
    });

    test('a realm with no map publishes unchanged', async function (assert) {
      await withRealm(undefined, async (dir) => {
        let report = await rebindPublishedImportMap(dir, {
          serverURL: SERVER,
        });
        assert.true(report.absent, 'no map is the ordinary case, not an error');
      });
    });

    test('an unreadable map is left alone rather than half-written', async function (assert) {
      // A map that is already broken is not made worse by publishing it, and
      // publish must not fail because of it.
      await withRealm('{ not json', async (dir) => {
        let report = await rebindPublishedImportMap(dir, {
          serverURL: SERVER,
        });
        assert.strictEqual(report.rewritten, 0, 'nothing was rewritten');
        assert.strictEqual(
          await readFile(join(dir, 'importmap.json'), 'utf8'),
          '{ not json',
          'the bytes are exactly as they arrived',
        );
      });
    });
  });
});
