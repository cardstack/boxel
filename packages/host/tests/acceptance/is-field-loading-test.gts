import { findAll, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { Deferred, SupportedMimeType } from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  getRelationship,
  isFieldLoading,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const SUBJECTS_MODULE = `${testRealmURL}subjects`;
const LINKSTO_URL = `${testRealmURL}linksto-subject`;
const LINKSTOMANY_URL = `${testRealmURL}linkstomany-subject`;
const QUERY_URL = `${testRealmURL}query-subject`;

// Prefetch a card document, let `modify` mutate it (to force the host into a
// real load — strip `included` so declared links resolve lazily, or clear a
// query field's server-resolved relationships so it falls back to a live
// search), then mount a handler that serves the modified document AND holds
// any request whose URL contains `gateUrlIncludes` until released. That hold is
// the deterministic in-flight window the live-loading assertions depend on.
async function mountGatedCard(
  network: NetworkService,
  opts: {
    cardUrl: string;
    modify: (json: any) => void;
    gateUrlIncludes: string;
  },
): Promise<{ release: () => void; unmount: () => void }> {
  let prefetch = await network.virtualNetwork.fetch(
    new Request(opts.cardUrl, {
      headers: { Accept: SupportedMimeType.CardJson },
    }),
  );
  let json = await prefetch.json();
  opts.modify(json);
  let body = JSON.stringify(json);

  let gate = new Deferred<void>();
  let handler = async (request: Request) => {
    let url = new URL(request.url);
    if (url.href.includes(opts.gateUrlIncludes)) {
      await gate.promise;
    }
    if (
      request.method === 'GET' &&
      request.url === opts.cardUrl &&
      request.headers.get('Accept')?.includes('card+json')
    ) {
      return new Response(body, {
        status: 200,
        headers: new Headers({ 'content-type': SupportedMimeType.CardJson }),
      });
    }
    return null;
  };
  network.virtualNetwork.mount(handler, { prepend: true });
  return {
    release: () => gate.fulfill(),
    unmount: () => network.virtualNetwork.unmount(handler),
  };
}

module('Acceptance | isFieldLoading', function (hooks) {
  setupApplicationTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: false,
  });

  hooks.beforeEach(async function () {
    class Person extends CardDef {
      @field name = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
    }
    // Each subject card drives a spinner off `isFieldLoading` for one field
    // type — the live loading state a card author would render.
    class LinksToSubject extends CardDef {
      @field pet = linksTo(() => Pet);
      get petLoading() {
        return isFieldLoading(this, 'pet').isLoading;
      }
      static isolated = class extends Component<typeof LinksToSubject> {
        <template>
          {{#if @model.petLoading}}
            <div data-test-loading>loading</div>
          {{else}}
            <div data-test-loaded>{{@model.pet.firstName}}</div>
          {{/if}}
        </template>
      };
    }
    class LinksToManySubject extends CardDef {
      @field pets = linksToMany(() => Pet);
      get petsLoading() {
        return isFieldLoading(this, 'pets').isLoading;
      }
      static isolated = class extends Component<typeof LinksToManySubject> {
        <template>
          {{#if @model.petsLoading}}
            <div data-test-loading>loading</div>
          {{else}}
            <div data-test-loaded>{{@model.pets.length}}</div>
          {{/if}}
        </template>
      };
    }
    class QuerySubject extends CardDef {
      @field cardTitle = contains(StringField);
      @field matches = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
          page: { size: 10, number: 0 },
        },
      });
      get matchesLoading() {
        return isFieldLoading(this, 'matches').isLoading;
      }
      static isolated = class extends Component<typeof QuerySubject> {
        <template>
          {{#if @model.matchesLoading}}
            <div data-test-loading>loading</div>
          {{else}}
            <ul data-test-loaded>
              {{#each @model.matches as |match|}}
                <li data-test-match>{{match.name}}</li>
              {{/each}}
            </ul>
          {{/if}}
        </template>
      };
    }
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'subjects.gts': {
          Person,
          Pet,
          LinksToSubject,
          LinksToManySubject,
          QuerySubject,
        },
        'Pet/mango.json': new Pet({ firstName: 'Mango' }),
        'Pet/vangogh.json': new Pet({ firstName: 'Vangogh' }),
        'Person/target.json': new Person({ name: 'Target' }),
        'linksto-subject.json': {
          data: {
            attributes: {},
            relationships: {
              pet: { links: { self: `${testRealmURL}Pet/mango` } },
            },
            meta: {
              adoptsFrom: { module: SUBJECTS_MODULE, name: 'LinksToSubject' },
            },
          },
        },
        'linkstomany-subject.json': {
          data: {
            attributes: {},
            relationships: {
              'pets.0': { links: { self: `${testRealmURL}Pet/mango` } },
              'pets.1': { links: { self: `${testRealmURL}Pet/vangogh` } },
            },
            meta: {
              adoptsFrom: {
                module: SUBJECTS_MODULE,
                name: 'LinksToManySubject',
              },
            },
          },
        },
        'query-subject.json': {
          data: {
            attributes: { cardTitle: 'Target' },
            meta: {
              adoptsFrom: { module: SUBJECTS_MODULE, name: 'QuerySubject' },
            },
          },
        },
      },
    });
  });

  test('linksTo: the template shows a live loading state while the link is in flight, then clears when it resolves', async function (assert) {
    let network = getService('network') as NetworkService;
    // Strip `included` so the linked Pet resolves via a real (gateable) lazy load.
    let gate = await mountGatedCard(network, {
      cardUrl: LINKSTO_URL,
      modify: (json) => delete json.included,
      gateUrlIncludes: 'Pet/mango',
    });
    let cardSelector = `[data-test-stack-card="${LINKSTO_URL}"]`;
    try {
      // Capture but don't await yet: the gate holds the load/search in flight,
      // so the app won't settle (and this promise won't resolve) until we
      // release below. Awaiting it before then would deadlock the test.
      let navigation = visitOperatorMode({
        stacks: [[{ id: LINKSTO_URL, format: 'isolated' }]],
      });

      await waitFor(`${cardSelector} [data-test-loading]`);
      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .exists('shows the loading state while the link is in flight');

      gate.release();
      await navigation;
      await settled();

      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .doesNotExist('loading state clears once the link resolves');
      assert
        .dom(`${cardSelector} [data-test-loaded]`)
        .hasText('Mango', 'the link renders live after it resolves');
    } finally {
      gate.unmount();
    }
  });

  test('linksToMany: isLoading stays true until every element has settled, then live flips to false', async function (assert) {
    let network = getService('network') as NetworkService;
    // Gate only the second element: the first resolves on its own, the second
    // is held — so the field must stay "loading" until BOTH have settled.
    let gate = await mountGatedCard(network, {
      cardUrl: LINKSTOMANY_URL,
      modify: (json) => delete json.included,
      gateUrlIncludes: 'Pet/vangogh',
    });
    let cardSelector = `[data-test-stack-card="${LINKSTOMANY_URL}"]`;
    try {
      // Capture but don't await yet: the gate holds the load/search in flight,
      // so the app won't settle (and this promise won't resolve) until we
      // release below. Awaiting it before then would deadlock the test.
      let navigation = visitOperatorMode({
        stacks: [[{ id: LINKSTOMANY_URL, format: 'isolated' }]],
      });

      await waitFor(`${cardSelector} [data-test-loading]`);
      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .exists('shows the loading state while elements are in flight');

      // The crux of the plural collapse: wait for the first element to resolve
      // while the second stays gated, and assert the field is STILL loading.
      let subject = getService('store').peek(LINKSTOMANY_URL) as any;
      await waitUntil(() => {
        let slots = getRelationship(subject, 'pets');
        return Array.isArray(slots) && slots[0]?.kind === 'present';
      });
      let slots = getRelationship(subject, 'pets') as { kind: string }[];
      assert.strictEqual(
        slots[0].kind,
        'present',
        'first element has resolved',
      );
      assert.strictEqual(
        slots[1].kind,
        'not-loaded',
        'second element is still in flight',
      );
      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .exists(
          'still loading while one element is settling, even though the other already resolved',
        );

      gate.release();
      await navigation;
      await settled();

      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .doesNotExist('loading state clears once every element resolves');
      assert
        .dom(`${cardSelector} [data-test-loaded]`)
        .hasText('2', 'both elements rendered live after they resolved');
    } finally {
      gate.unmount();
    }
  });

  test('query-backed linksToMany: the template shows a live loading state while the search is in flight, then clears when it settles', async function (assert) {
    let network = getService('network') as NetworkService;
    // Clear the server-resolved matches so the host runs its client-side
    // fallback search (the only way an SPA observes a query-field search in
    // flight — query fields are otherwise server-populated on render).
    let gate = await mountGatedCard(network, {
      cardUrl: QUERY_URL,
      modify: (json) => {
        let rel = json.data.relationships?.matches;
        if (rel) {
          rel.data = [];
          rel.meta = {
            errors: [
              {
                realm: testRealmURL,
                type: 'fetch-error',
                message: 'forced fallback',
                status: 502,
              },
            ],
          };
          for (let key of Object.keys(json.data.relationships)) {
            if (key.startsWith('matches.')) {
              delete json.data.relationships[key];
            }
          }
        }
      },
      gateUrlIncludes: '/_federated-search',
    });
    let cardSelector = `[data-test-stack-card="${QUERY_URL}"]`;
    try {
      // Capture but don't await yet: the gate holds the load/search in flight,
      // so the app won't settle (and this promise won't resolve) until we
      // release below. Awaiting it before then would deadlock the test.
      let navigation = visitOperatorMode({
        stacks: [[{ id: QUERY_URL, format: 'isolated' }]],
      });

      await waitFor(`${cardSelector} [data-test-loading]`);
      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .exists('shows the loading state while the search is in flight');

      gate.release();
      await navigation;
      await settled();

      assert
        .dom(`${cardSelector} [data-test-loading]`)
        .doesNotExist('loading state clears once the search settles');
      let matchElements = findAll(`${cardSelector} [data-test-match]`);
      assert.deepEqual(
        matchElements.map((el) => el.textContent?.trim()),
        ['Target'],
        'the query results render live after the search resolves',
      );
    } finally {
      gate.unmount();
    }
  });
});
