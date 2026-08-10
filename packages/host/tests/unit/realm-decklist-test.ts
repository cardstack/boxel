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

// The decklist as a CARD, which is the form the user actually meets it in.
//
// `decklist-loader-test` proves the Loader honours a decklist once one is in
// the virtual network; it puts one there by hand. This proves the other half:
// that a realm carrying a Decklist card gets that card's pins applied to it,
// with nobody calling `setRealmDecklist` from a test.
//
// The card sits alongside the RealmConfig card at `<realm>/realm.json` — a
// card instance at a well-known id that configures the environment rather
// than describing content, and one that can govern many cards in its realm
// without being any of them.
module('Unit | decklist | a realm loads its Decklist card', function (hooks) {
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
          // The card class. It lives in the realm, not in base — the host
          // never loads it, so it does not have to. See the comment on
          // `loadDecklist`: the decklist is read as card source precisely so
          // that configuring the loader requires neither loading a card class
          // through the loader being configured, nor an index that cannot
          // exist yet at the moment the pins are needed. Both fields are
          // stored for the same reason — a computed field is invisible to a
          // reader holding only the bytes.
          'decklist-card.gts': `
            import { CardDef, field, contains } from '@cardstack/base/card-api';
            import { JsonField } from '@cardstack/base/json-field';
            export class Decklist extends CardDef {
              static displayName = 'Decklist';
              @field imports = contains(JsonField);
              @field scopes = contains(JsonField);
            }
          `,
          // The instance. Everything relative, so the card is portable
          // between hosts — the realm is the base.
          'decklist.json': {
            data: {
              attributes: {
                title: 'Workspace pins',
                imports: { palette: './palette-v2.js' },
                scopes: {
                  'legacy-viewer/': { palette: './palette-v1.js' },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}decklist-card`,
                  name: 'Decklist',
                },
              },
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

  test('the card in the realm is what pins the versions', async function (assert) {
    // `ensureRealmMeta` is the ordinary boot path — it resolves the realm's
    // `_info`, which is where the decklist load hangs off. Nothing in this
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
      "the gallery got v2 from the card's realm-wide imports",
    );
    assert.strictEqual(
      legacy.describe(),
      '1:#b91c1c',
      "the legacy viewer got v1 from the card's scope",
    );
  });

  // Re-reading the card after it changes rebinds the modules it governs.
  //
  // SCOPE, stated precisely so this test is not read as more than it is. A
  // decklist edit propagates in two legs: the realm's index event has to
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
  test('editing the card changes which version a module gets', async function (assert) {
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

    // What moving a version control in the card's UI amounts to: the scope
    // is dropped, so the legacy viewer falls back to the realm-wide v2.
    await testRealm.write(
      'decklist.json',
      JSON.stringify({
        data: {
          attributes: {
            title: 'Workspace pins',
            imports: { palette: './palette-v2.js' },
            scopes: {},
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}decklist-card`,
              name: 'Decklist',
            },
          },
        },
      }),
    );
    await settled();

    // What the store's index handler does when it sees this card
    // invalidated. Called directly because the event does not arrive here.
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

  test('the pins are scoped to the realm that owns the card', async function (assert) {
    await getService('realm').ensureRealmMeta(testRealmURL);

    // A module outside this realm asking for the same specifier must not
    // pick up this realm's pin. This is the property `setRealmDecklist`
    // exists for, checked here against a decklist that really came from a
    // card rather than one installed by a test.
    let outsider = 'https://somewhere-else.example.com/app/scene.gts';
    assert.notStrictEqual(
      loader.getVirtualNetwork()!.resolveImport('palette', outsider),
      `${testRealmURL}palette-v2.js`,
      "another realm's module is not governed by this realm's decklist",
    );
  });
});
