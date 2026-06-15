import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  type RenderRouteOptions,
  type SearchEntryWireQuery,
  baseRealm,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  testRealmURL,
  testRRI,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
} from '../helpers';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// A card that renders the v2 `@context.searchResultsComponent` inside a
// prerenderable (isolated) template — the first surface that drives
// `getSearchEntriesResource` through the render route. The resource's in-flight
// v2 search must be registered with the render store's readiness signal, or the
// settle loop captures HTML before the search resolves and the prerendered
// directory shows an empty result list. The default query returns html-backed
// `search-entry`s (the searched cards are indexed), so each result renders the
// other card's prerendered fitted HTML inert — the dominant prerender path,
// where nothing else deposits into the store to move its load generation.
module('Acceptance | prerender | search results', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const DEFAULT_RENDER_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({ clearCache: true } as RenderRouteOptions),
  );
  const renderPath = (url: string, suffix: string, nonce = 0) =>
    `/render/${encodeURIComponent(
      url,
    )}/${nonce}/${DEFAULT_RENDER_OPTIONS_SEGMENT}${suffix}`;

  const PET_REF = { module: testRRI('pet'), name: 'Pet' };
  const MANGO = `${testRealmURL}Pet/mango`;
  const VAN_GOGH = `${testRealmURL}Pet/van-gogh`;

  hooks.beforeEach(async function () {
    (globalThis as any).__doNotSuppressRenderRouteError = true;
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api') =
      await loader.import(`${baseRealm.url}card-api`);

    let { field, contains, CardDef, StringField, Component } = cardApi;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      static fitted = class Fitted extends Component<typeof Pet> {
        <template>
          <div data-test-pet-name><@fields.name /></div>
        </template>
      };
    }

    class PetDirectory extends CardDef {
      static displayName = 'Pet Directory';
      static isolated = class Isolated extends Component<typeof PetDirectory> {
        get query(): SearchEntryWireQuery {
          return {
            filter: { 'item.on': PET_REF },
            realms: [testRealmURL],
          };
        }
        <template>
          <div data-test-pet-directory>
            <@context.searchResultsComponent @query={{this.query}} />
          </div>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'pet.gts': { Pet },
        'pet-directory.gts': { PetDirectory },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango' },
            meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
          },
        },
        'Pet/van-gogh.json': {
          data: {
            attributes: { name: 'Van Gogh' },
            meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
          },
        },
        'PetDirectory/directory.json': {
          data: {
            attributes: { title: 'Directory' },
            meta: {
              adoptsFrom: { module: '../pet-directory', name: 'PetDirectory' },
            },
          },
        },
      },
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__doNotSuppressRenderRouteError;
  });

  test('prerenders the v2 @context search surface with results present', async function (assert) {
    let url = `${testRealmURL}PetDirectory/directory.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { status, value } = await capturePrerenderResult('innerHTML');

    assert.strictEqual(status, 'ready', 'the directory prerender is ready');
    assert
      .dom('[data-test-pet-directory]')
      .exists('the directory isolated template rendered');
    assert.ok(
      value.includes(`data-test-search-result="${MANGO}"`),
      `the first search result is captured in the prerendered HTML, not an empty list. got: ${value.slice(0, 600)}`,
    );
    assert.ok(
      value.includes(`data-test-search-result="${VAN_GOGH}"`),
      'the second search result is captured in the prerendered HTML',
    );
    assert.ok(
      /data-test-pet-name[^>]*>\s*Mango/s.test(value),
      'the first result renders the searched card prerendered HTML inert (Mango)',
    );
    assert.ok(
      /data-test-pet-name[^>]*>\s*Van Gogh/s.test(value),
      'the second result renders the searched card prerendered HTML inert (Van Gogh)',
    );
  });
});
