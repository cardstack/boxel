import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader, Realm } from '@cardstack/runtime-common';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// The realm's import map, in the form it actually takes on disk.
//
// `decklist-loader-test` proves the Loader honours a decklist once one is in
// the virtual network; it puts one there by hand. This proves the other half:
// that a realm carrying an `importmap.json` gets that file's pins applied to
// it, with nobody calling `setRealmDecklist` from a test.
//
// The file is NOT A CARD — `deck-multi-package-design.md` §2 — and the tests
// below depend on that being true rather than merely stated. Nothing here
// writes a `meta.adoptsFrom`, nothing indexes an instance, and the pins are
// available to the loader before any card class has been evaluated.
module('Unit | decklist | a realm loads its import map', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;
  let testRealm: Realm;
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    ({ realm: testRealm } = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          // The web import-map shape, verbatim. A browser could load this.
          // Everything relative, so the map is portable between hosts — the
          // realm is the base.
          'importmap.json': {
            imports: { palette: './palette-v2.js' },
            scopes: {
              'legacy-viewer/': { palette: './palette-v1.js' },
            },
          },
          'palette-v1.js': `
            export const VERSION = 1;
            export function pick(index) {
              return ['#b91c1c', '#15803d', '#1d4ed8'][index];
            }
          `,
          'palette-v2.js': `
            export const VERSION = 2;
            export function pick(name) {
              return { crimson: '#b91c1c', amber: '#f59e0b' }[name];
            }
          `,
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
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    loader.getVirtualNetwork()?.clearDecklist();
  });

  test('the file in the realm is what pins the versions', async function (assert) {
    // `ensureRealmMeta` is the ordinary boot path — it resolves the realm's
    // `_info`, which is where the import-map load hangs off. Nothing in this
    // test mentions the virtual network.
    await getService('realm').ensureRealmMeta(testRealmURL);

    let gallery = await loader.import<{ describe(): string }>(
      `${testRealmURL}gallery/scene`,
    );
    let legacy = await loader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer/scene`,
    );

    assert.strictEqual(
      gallery.describe(),
      '2:#f59e0b',
      "the gallery got v2 from the file's realm-wide imports",
    );
    assert.strictEqual(
      legacy.describe(),
      '1:#b91c1c',
      "the legacy viewer got v1 from the file's scope",
    );
  });

  // Re-reading the file after it changes rebinds the modules it governs.
  //
  // SCOPE, stated precisely so this test is not read as more than it is. An
  // import-map edit propagates in two legs: the realm's index event has to
  // reach the store, and the store then has to reload the pins before
  // rebuilding. This exercises the SECOND leg by calling the same entry point
  // the store's handler calls. The first leg — SSE delivery — is not
  // exercised here; index events do not reach the store in this harness, and
  // an earlier version of this test that relied on them failed for that
  // reason rather than for anything wrong with the propagation. That leg is
  // verified by moving the control in the running app.
  //
  // Ordering is what this is really guarding. `reloadDecklistFor` must
  // complete before the rebuild: rebuild first and it re-imports against the
  // versions being replaced, reproduces them exactly, and reads as if nothing
  // propagated at all.
  test('editing the file changes which version a module gets', async function (assert) {
    await getService('realm').login(testRealmURL);
    await getService('realm').ensureRealmMeta(testRealmURL);

    let before = await loader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer/scene`,
    );
    assert.strictEqual(
      before.describe(),
      '1:#b91c1c',
      'the scope pins the legacy viewer to v1 to begin with',
    );

    // What moving a version control amounts to: the scope is dropped, so the
    // legacy viewer falls back to the realm-wide v2.
    await testRealm.write(
      'importmap.json',
      JSON.stringify({
        imports: { palette: './palette-v2.js' },
        scopes: {},
      }),
    );
    await settled();

    // What the store's index handler does when it sees this file invalidated.
    // Called directly because the event does not arrive here.
    await getService('realm').reloadDecklistFor(testRealmURL);
    await settled();

    // Ask the loader-service again rather than reusing the handle from
    // `beforeEach`: a rebuild may replace the loader rather than mutate it,
    // and the old instance keeps answering with the pins it was built with.
    let currentLoader = getService('loader-service').loader;
    let after = await currentLoader.import<{ describe(): string }>(
      `${testRealmURL}legacy-viewer/scene`,
    );
    assert.strictEqual(
      after.describe(),
      '2:undefined',
      'the same module now gets v2 — and v2.pick(0) is undefined, which is what an unported caller looks like',
    );
  });

  // A map that names a parent it cannot inherit from applies NOTHING — not
  // even the half of itself that parsed. L11, fail closed: an app quietly
  // missing the entries it inherited is worse than an import that fails, and
  // much harder to read. `deck.extends` must name an exact version, so a tag
  // is refused rather than resolved.
  //
  // Note what is asserted: the `imports` block below is perfectly well
  // formed. If the pin still applied, a typo'd parent would look like it had
  // worked.
  test('a map that cannot inherit applies nothing at all', async function (assert) {
    await getService('realm').login(testRealmURL);
    await getService('realm').ensureRealmMeta(testRealmURL);

    await testRealm.write(
      'importmap.json',
      JSON.stringify({
        imports: { palette: './palette-v1.js' },
        deck: { extends: 'latest' },
      }),
    );
    await settled();
    await getService('realm').reloadDecklistFor(testRealmURL);
    await settled();

    // `https://packages/…` is the virtual network's sentinel for a bare
    // specifier nothing claimed. It resolves nowhere — the package-shim
    // handler answers a fetch of it with a 404 that names the specifier and
    // says no decklist in scope maps it — so this is what "the pin did not
    // apply" looks like from the resolver, and it is loud rather than silent.
    assert.strictEqual(
      getService('loader-service')
        .loader.getVirtualNetwork()!
        .resolveImport('palette', `${testRealmURL}gallery/scene.js`),
      'https://packages/palette',
      'no pin survives a parent that cannot be honoured',
    );
  });

  // REMIX IS A MAP, NOT A COPY.
  //
  // The realm below holds no copy of the deck it remixes. Its whole
  // contribution is one `importmap.json`: `deck.extends` names an exact
  // published parent, and a single entry overrides one of the parent's pins.
  // Everything the parent declared and the child did not mention is
  // inherited. That is the difference between changing one module of a
  // two-hundred-module app and duplicating two hundred files.
  //
  // The property this really guards is WHOSE base a relative value resolves
  // against. The parent writes `./ui.js` meaning a file beside itself; the
  // child writes `./palette-v2.js` meaning a file beside ITSELF. Resolve the
  // flattened map against one base — the obvious implementation — and every
  // inherited entry silently re-homes onto the remix, where it either 404s
  // or, worse, finds an unrelated file of the same name.
  test('a remix inherits its parent and overrides one entry', async function (assert) {
    await getService('realm').login(testRealmURL);

    // The parent, published under its own exact address. Its `ui.js` is only
    // reachable from here — the remix has no such file.
    await testRealm.write(
      'vendor/gallery@1.0.0/importmap.json',
      JSON.stringify({
        imports: { palette: './palette-v1.js', 'gallery-ui': './ui.js' },
      }),
    );
    await testRealm.write(
      'vendor/gallery@1.0.0/palette-v1.js',
      'export const VERSION = 1;\nexport function pick() { return "parent"; }\n',
    );
    await testRealm.write(
      'vendor/gallery@1.0.0/ui.js',
      'export const WHO = "parent ui";\n',
    );

    // The remix. One file, two facts: who it descends from, and the one pin
    // it disagrees about.
    await testRealm.write(
      'importmap.json',
      JSON.stringify({
        deck: { extends: `${testRealmURL}vendor/gallery@1.0.0/` },
        imports: { palette: './palette-v2.js' },
      }),
    );
    await settled();
    await getService('realm').reloadDecklistFor(testRealmURL);
    await settled();

    let vn = getService('loader-service').loader.getVirtualNetwork()!;
    let importer = `${testRealmURL}gallery/scene.js`;

    assert.strictEqual(
      vn.resolveImport('gallery-ui', importer),
      `${testRealmURL}vendor/gallery@1.0.0/ui.js`,
      "the inherited entry still points inside the PARENT, not at the remix's own root",
    );
    assert.strictEqual(
      vn.resolveImport('palette', importer),
      `${testRealmURL}palette-v2.js`,
      'the overridden entry resolves against the REMIX, which is where its file lives',
    );
  });

  test('the pins are scoped to the realm that owns the file', async function (assert) {
    await getService('realm').ensureRealmMeta(testRealmURL);

    // A module outside this realm asking for the same specifier must not
    // pick up this realm's pin. This is the property `setRealmDecklist`
    // exists for, checked here against a map that really came from a realm
    // file rather than one installed by a test.
    let outsider = 'https://somewhere-else.example.com/app/scene.gts';
    assert.notStrictEqual(
      loader.getVirtualNetwork()!.resolveImport('palette', outsider),
      `${testRealmURL}palette-v2.js`,
      "another realm's module is not governed by this realm's import map",
    );
  });
});
