import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// The browser proof for the importer-aware `define` shim.
//
// `packages/runtime-common/tests/decklist-resolution-test.ts` proves that
// `VirtualNetwork.resolveImport` answers correctly when it is CALLED with an
// importer. That is a test of the resolver, and it passed long before the
// Loader was capable of asking the question — the `define` shim had the
// importing module in hand and used it only as a relative base, so every
// module in a realm resolved a bare specifier identically no matter what any
// scope said.
//
// So the resolver test could not have caught the bug it appears to cover. The
// only honest proof is a real module graph: two modules, fetched and evaluated
// through `Loader.import`, that write the same `import ... from 'palette'` and
// end up bound to two different files. That is what runs below.
//
// Which of these tests actually discriminates was measured, not assumed: with
// the importer argument removed from the `define` shim, ONLY the first test
// fails, and it fails as `2:undefined` — the legacy viewer silently handed v2
// and calling v2's name-taking pick() with an index. The other four pass
// either way. They are still worth keeping (a prefix-match regression, a
// cache-collapse regression, and the unchanged no-decklist failure mode are
// all things that could break later) but the first test is the one carrying
// the claim.
module('Unit | decklist | two majors through the Loader', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          // Two majors of one library. The APIs are deliberately
          // incompatible — v1's pick() takes an index, v2's takes a name —
          // so a test cannot pass by accident if both modules happened to
          // resolve to the same file: it would throw or return undefined
          // rather than quietly agreeing.
          'palette-v1.js': `
            export const VERSION = 1;
            const COLORS = ['#b91c1c', '#15803d', '#1d4ed8'];
            export function pick(index) {
              return COLORS[index];
            }
          `,
          'palette-v2.js': `
            export const VERSION = 2;
            const COLORS = { crimson: '#b91c1c', forest: '#15803d', amber: '#f59e0b' };
            export function pick(name) {
              return COLORS[name];
            }
          `,
          // The two consumers. Byte-for-byte the same import statement.
          'gallery/scene.js': `
            import { VERSION, pick } from 'palette';
            export function describe() {
              return VERSION + ':' + pick('amber');
            }
          `,
          'legacy-viewer/scene.js': `
            import { VERSION, pick } from 'palette';
            export function describe() {
              return VERSION + ':' + pick(0);
            }
          `,
          // A neighbour whose path merely STARTS WITH the scope key. A scope
          // ending in `/` is a path prefix, not a string prefix; getting that
          // wrong hands the wrong major to an unrelated directory, and the
          // symptom is "the library is broken" rather than "the map is
          // wrong". Cheap to assert here, where a real graph is already
          // loading.
          'legacy-viewer-experiments/scene.js': `
            import { VERSION } from 'palette';
            export function describe() {
              return String(VERSION);
            }
          `,
        },
      }),
    );
  });

  hooks.afterEach(function () {
    loader.getVirtualNetwork()?.clearDecklist();
  });

  function pinLegacyToV1() {
    loader.getVirtualNetwork()!.addDecklist(
      {
        imports: { palette: 'palette-v2.js' },
        scopes: {
          'legacy-viewer/': { palette: 'palette-v1.js' },
        },
      },
      // Relative throughout, resolved against the realm — the same shape a
      // user would hand-write into a realm's importmap.json.
      testRealmURL,
    );
  }

  test('one specifier, two importers, two versions — in a live module graph', async function (assert) {
    pinLegacyToV1();

    let gallery = await loader.import<{ describe(): string }>(
      `${testRealmURL}gallery/scene`,
    );
    let legacy = await loader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer/scene`,
    );

    assert.strictEqual(
      gallery.describe(),
      '2:#f59e0b',
      'the gallery got v2 from the realm-wide import, and v2.pick takes a name',
    );
    assert.strictEqual(
      legacy.describe(),
      '1:#b91c1c',
      'the legacy viewer got v1 from its scope — same specifier, same realm, same loader',
    );
  });

  test('both majors are resident at once, as distinct modules', async function (assert) {
    pinLegacyToV1();

    await loader.import(`${testRealmURL}gallery/scene`);
    await loader.import(`${testRealmURL}legacy-viewer/scene`);

    // Not the same module object under two names: two separate evaluations
    // living side by side. If the Loader had collapsed them on a shared cache
    // key — the hazard, since several cache keys are computed without an
    // importer — these would be identical.
    let v1 = await loader.import<{ VERSION: number }>(
      `${testRealmURL}palette-v1`,
    );
    let v2 = await loader.import<{ VERSION: number }>(
      `${testRealmURL}palette-v2`,
    );
    assert.strictEqual(v1.VERSION, 1, 'v1 is loaded');
    assert.strictEqual(v2.VERSION, 2, 'v2 is loaded');
    assert.notStrictEqual(v1, v2, 'they are two modules, not one');
  });

  test('a sibling directory that merely shares a prefix is not governed', async function (assert) {
    pinLegacyToV1();

    let neighbour = await loader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer-experiments/scene`,
    );
    assert.strictEqual(
      neighbour.describe(),
      '2',
      '`legacy-viewer-experiments/` falls back to the realm-wide v2',
    );
  });

  test('editing the pin changes which version a module gets', async function (assert) {
    // The user-facing promise, exercised end to end: the decklist is data, a
    // card can rewrite it, and the next import binds to different code. What
    // makes this work is that `addDecklist` fires the mapping-change signal
    // the Loader already listens to, so its module caches are discarded —
    // without that the second import would return the first import's answer
    // and the UI would look frozen.
    loader
      .getVirtualNetwork()!
      .addDecklist({ imports: { palette: 'palette-v1.js' } }, testRealmURL);

    let before = await loader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer/scene`,
    );
    assert.strictEqual(before.describe(), '1:#b91c1c', 'before the edit: v1');

    loader.getVirtualNetwork()!.clearDecklist();
    loader
      .getVirtualNetwork()!
      .addDecklist({ imports: { palette: 'palette-v2.js' } }, testRealmURL);

    let after = await loader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer/scene`,
    );
    assert.strictEqual(
      after.describe(),
      '2:undefined',
      'after the edit: v2 — and v2.pick(0) is undefined, which is what an unported caller looks like',
    );
  });

  test('with no decklist loaded, a bare specifier behaves exactly as before', async function (assert) {
    // The no-regression half. `palette` is not a real package, so without a
    // decklist the import must fail the way any unknown bare specifier fails
    // today — not resolve to something surprising.
    try {
      await loader.import(`${testRealmURL}gallery/scene`);
      assert.ok(false, 'expected the unmapped bare specifier to fail');
    } catch (err: any) {
      assert.ok(
        true,
        `unmapped bare specifier still fails, as it did before: ${err.message}`,
      );
    }
  });
});
