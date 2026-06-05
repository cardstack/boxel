import { settled, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { Deferred, SupportedMimeType } from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

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
  getRelationshipMembershipState,
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

function relationship(url: string, fieldName: string) {
  let card = getService('store').peek(url) as CardDefType;
  return getRelationshipMembershipState(card, fieldName);
}

module(
  'Acceptance | getRelationshipMembershipState loading state',
  function (hooks) {
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
      // Each subject card always renders its field (kicking the lazy load /
      // search) and overlays a spinner driven by `getRelationshipMembershipState(...).isLoading`
      // — the observe-only live loading state a card author would render.
      class LinksToSubject extends CardDef {
        @field pet = linksTo(() => Pet);
        get petLoading() {
          return getRelationshipMembershipState(this, 'pet').isLoading;
        }
        static isolated = class extends Component<typeof LinksToSubject> {
          <template>
            {{#if @model.petLoading}}<div data-test-loading></div>{{/if}}
            <div data-test-content>{{@model.pet.firstName}}</div>
          </template>
        };
      }
      class LinksToManySubject extends CardDef {
        @field pets = linksToMany(() => Pet);
        get petsLoading() {
          return getRelationshipMembershipState(this, 'pets').isLoading;
        }
        static isolated = class extends Component<typeof LinksToManySubject> {
          <template>
            {{#if @model.petsLoading}}<div data-test-loading></div>{{/if}}
            {{#each @model.pets as |pet|}}
              <span data-test-item>{{pet.firstName}}</span>
            {{/each}}
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
          return getRelationshipMembershipState(this, 'matches').isLoading;
        }
        static isolated = class extends Component<typeof QuerySubject> {
          <template>
            {{#if @model.matchesLoading}}<div data-test-loading></div>{{/if}}
            {{#each @model.matches as |match|}}
              <span data-test-match>{{match.name}}</span>
            {{/each}}
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

    test('linksTo: isLoading true with a not-loaded membership while in flight, then false with a present membership', async function (assert) {
      let network = getService('network') as NetworkService;
      let gate = await mountGatedCard(network, {
        cardUrl: LINKSTO_URL,
        modify: (json) => delete json.included,
        gateUrlIncludes: 'Pet/mango',
      });
      let cardSelector = `[data-test-stack-card="${LINKSTO_URL}"]`;
      try {
        // Capture but don't await yet: the gate holds the load/search in
        // flight, so the app won't settle (and this promise won't resolve)
        // until we release below. Awaiting it before then would deadlock.
        let navigation = visitOperatorMode({
          stacks: [[{ id: LINKSTO_URL, format: 'isolated' }]],
        });

        await waitFor(`${cardSelector} [data-test-loading]`);
        let inFlight = relationship(LINKSTO_URL, 'pet');
        assert.true(
          inFlight.isLoading,
          'isLoading is true while the link is in flight',
        );
        assert.strictEqual(
          inFlight.membership?.length,
          1,
          'a singular linksTo has a one-element membership',
        );
        assert.strictEqual(
          inFlight.membership?.[0].kind,
          'not-loaded',
          'the member is not-loaded while in flight',
        );

        gate.release();
        await navigation;
        await settled();

        assert
          .dom(`${cardSelector} [data-test-loading]`)
          .doesNotExist('spinner cleared');
        let resolved = relationship(LINKSTO_URL, 'pet');
        assert.false(
          resolved.isLoading,
          'isLoading is false once the link resolves',
        );
        assert.strictEqual(resolved.membership?.length, 1);
        assert.strictEqual(
          resolved.membership?.[0].kind,
          'present',
          'member is present',
        );
        assert.strictEqual(
          (resolved.membership?.[0] as any).value?.firstName,
          'Mango',
          'the resolved card is carried on the member',
        );
        assert.dom(`${cardSelector} [data-test-content]`).hasText('Mango');
      } finally {
        gate.unmount();
      }
    });

    test('linksToMany: isLoading stays true until every element settles; membership stays a full-length array', async function (assert) {
      let network = getService('network') as NetworkService;
      // Gate only the second element: the first resolves on its own, the second
      // is held — so the field must stay loading until BOTH have settled.
      let gate = await mountGatedCard(network, {
        cardUrl: LINKSTOMANY_URL,
        modify: (json) => delete json.included,
        gateUrlIncludes: 'Pet/vangogh',
      });
      let cardSelector = `[data-test-stack-card="${LINKSTOMANY_URL}"]`;
      try {
        // Capture but don't await yet: the gate holds the load/search in
        // flight, so the app won't settle (and this promise won't resolve)
        // until we release below. Awaiting it before then would deadlock.
        let navigation = visitOperatorMode({
          stacks: [[{ id: LINKSTOMANY_URL, format: 'isolated' }]],
        });

        await waitFor(`${cardSelector} [data-test-loading]`);
        let inFlight = relationship(LINKSTOMANY_URL, 'pets');
        assert.true(
          inFlight.isLoading,
          'isLoading is true while an element is in flight',
        );
        assert.strictEqual(
          inFlight.membership?.length,
          2,
          'a declared linksToMany keeps a full-length array membership while loading',
        );
        let anyNotLoaded = Boolean(
          inFlight.membership?.some((m) => m.kind === 'not-loaded'),
        );
        assert.true(anyNotLoaded, 'at least one element is still not-loaded');

        gate.release();
        await navigation;
        await settled();

        assert
          .dom(`${cardSelector} [data-test-loading]`)
          .doesNotExist('spinner cleared');
        let resolved = relationship(LINKSTOMANY_URL, 'pets');
        assert.false(
          resolved.isLoading,
          'isLoading is false once every element resolves',
        );
        assert.deepEqual(
          resolved.membership?.map((m) => m.kind),
          ['present', 'present'],
          'every element is present',
        );
        assert.deepEqual(
          resolved.membership?.map((m) => (m as any).value?.firstName),
          ['Mango', 'Vangogh'],
          'the resolved cards are carried on the members',
        );
      } finally {
        gate.unmount();
      }
    });

    test('query-backed linksToMany: membership is undefined while the search runs, then an array consistent with a normal linksToMany', async function (assert) {
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
        // Capture but don't await yet: the gate holds the load/search in
        // flight, so the app won't settle (and this promise won't resolve)
        // until we release below. Awaiting it before then would deadlock.
        let navigation = visitOperatorMode({
          stacks: [[{ id: QUERY_URL, format: 'isolated' }]],
        });

        await waitFor(`${cardSelector} [data-test-loading]`);
        let inFlight = relationship(QUERY_URL, 'matches');
        assert.true(
          inFlight.isLoading,
          'isLoading is true while the search runs',
        );
        assert.strictEqual(
          inFlight.membership,
          undefined,
          'membership is undefined while the query is in flight',
        );

        gate.release();
        await navigation;
        await settled();

        assert
          .dom(`${cardSelector} [data-test-loading]`)
          .doesNotExist('spinner cleared');
        let resolved = relationship(QUERY_URL, 'matches');
        assert.false(
          resolved.isLoading,
          'isLoading is false once the search settles',
        );
        assert.strictEqual(
          resolved.membership?.length,
          1,
          'membership is populated as an array once results arrive',
        );
        // Consistent with a normal linksToMany member: present, carrying the card
        // and a stable string reference.
        assert.strictEqual(resolved.membership?.[0].kind, 'present');
        assert.strictEqual(
          (resolved.membership?.[0] as any).value?.name,
          'Target',
          'the resolved card is carried on the member',
        );
        assert.strictEqual(
          typeof resolved.membership?.[0].reference,
          'string',
          'the member carries a reference, like a declared linksToMany',
        );
        assert.dom(`${cardSelector} [data-test-match]`).hasText('Target');
      } finally {
        gate.unmount();
      }
    });
  },
);
