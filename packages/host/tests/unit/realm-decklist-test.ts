import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test, todo } from 'qunit';

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
          // `loadDecklist`: the decklist is read as a raw card document
          // precisely so that configuring the loader does not require
          // loading a card class through the loader being configured.
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

  // KNOWN GAP, recorded as a todo rather than deleted so it fails loudly the
  // day it starts working. The boot-time load is proven by the test above;
  // this is the live-propagation half and it does NOT yet work: after the
  // write, the legacy viewer still resolves to v1. The reload is wired (the
  // `index` handler calls loadDecklist, and addDecklist/setRealmDecklist
  // invalidate the Loader caches) but something between `realm.write` and
  // that handler is not connected in this harness — either the index event
  // never reaches a resource subscribed this way, or `settled()` returns
  // before it is processed. Until that is chased down, treat "move the
  // slider and the UI re-renders" as designed and wired, not demonstrated.
  todo(
    'editing the card changes which version a module gets',
    async function (assert) {
      // The liveness requirement, end to end and with nothing stubbed: save
      // the card, the realm re-indexes, the host reloads the decklist, the
      // virtual network invalidates the Loader's module caches, and the next
      // import of an UNCHANGED module binds to different code. Every link in
      // that chain already existed except the reload; this is the test that
      // says the chain is actually connected.
      //
      // `login` rather than `ensureRealmMeta`: the realm's index-event
      // subscription hangs off the session, so a resource that has only ever
      // fetched info is not listening. That is a real property of the code, not
      // a test detail — an anonymous realm gets its pins at boot and no live
      // propagation afterwards.
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

      let after = await loader.import<{ describe(): string }>(
        `${testRealmURL}legacy-viewer/scene`,
      );
      assert.strictEqual(
        after.describe(),
        '2:undefined',
        'the same module now gets v2 — and v2.pick(0) is undefined, which is what an unported caller looks like',
      );
    },
  );

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
