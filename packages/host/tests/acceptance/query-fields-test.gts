import {
  click,
  fillIn,
  find,
  findAll,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';
import { testRealmURLToUsername } from '@cardstack/runtime-common/helpers/const';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type NetworkService from '@cardstack/host/services/network';

import type StoreService from '@cardstack/host/services/store';

import {
  saveCard,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import {
  cardAPI,
  CardDef,
  Component,
  contains,
  field,
  FieldDef,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const QUERY_CARD_URL = `${testRealmURL}query-card`;
const QUERY_CARD_2_URL = `${testRealmURL}query-card-2`;
const QUERY_CARD_NESTED_URL = `${testRealmURL}query-card-nested`;
const QUERY_CARD_MISSING_URL = `${testRealmURL}query-card-missing`;

module(
  'Acceptance | Query Fields | host respects server-populated results',
  function (hooks) {
    setupApplicationTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
    });
    let loader: Loader;
    let PersonClass: typeof CardDef;

    hooks.beforeEach(async function () {
      class Person extends CardDef {
        @field name = contains(StringField);
      }
      PersonClass = Person;
      class QueryLinksField extends FieldDef {
        @field cardTitle = contains(StringField);
        @field favorite = linksTo(() => Person, {
          query: {
            filter: {
              eq: { name: '$this.title' },
            },
          },
        });
        @field matches = linksToMany(() => Person, {
          query: {
            filter: {
              eq: { name: '$this.title' },
            },
            page: {
              size: 10,
              number: 0,
            },
          },
        });
      }
      class QueryCard extends CardDef {
        @field cardTitle = contains(StringField);
        @field favorite = linksTo(() => Person, {
          query: {
            filter: {
              eq: { name: '$this.title' },
            },
          },
        });
        @field matches = linksToMany(() => Person, {
          query: {
            filter: {
              eq: { name: '$this.title' },
            },
            page: {
              size: 10,
              number: 0,
            },
          },
        });
        static isolated = class Isolated extends Component<typeof QueryCard> {
          <template>
            <div data-test-inline-title>
              <@fields.cardTitle @format='edit' />
            </div>
            <div data-test-favorite>
              {{#if @model.favorite}}
                {{@model.favorite.name}}
              {{/if}}
            </div>
            <ul data-test-matches>
              {{#each @model.matches as |match|}}
                <li data-test-match>{{match.name}}</li>
              {{/each}}
            </ul>
          </template>
        };
      }
      class QueryCardNested extends CardDef {
        @field queries = contains(QueryLinksField);
        static isolated = class Isolated extends Component<
          typeof QueryCardNested
        > {
          <template>
            <div data-test-inline-title>
              <@fields.queries.title @format='edit' />
            </div>
            <div data-test-favorite>
              {{#if @model.queries.favorite}}
                {{@model.queries.favorite.name}}
              {{/if}}
            </div>
            <ul data-test-matches>
              {{#each @model.queries.matches as |match|}}
                <li data-test-match>{{match.name}}</li>
              {{/each}}
            </ul>
          </template>
        };
      }
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'query-card.gts': { Person, QueryCard },
          'query-card-nested.gts': { Person, QueryCardNested, QueryLinksField },
          'Person/target.json': new Person({ name: 'Target' }),
          'Person/not-target.json': new Person({ name: 'Not Target' }),
          'query-card.json': new QueryCard({
            cardTitle: 'Target',
          }),
          'query-card-2.json': new QueryCard({
            cardTitle: 'Not Target',
          }),
          'query-card-nested.json': new QueryCardNested({
            queries: new QueryLinksField({
              cardTitle: 'Target',
            }),
          }),
          'query-card-missing.json': new QueryCard({
            cardTitle: 'Missing',
          }),
        },
      });
      loader = getService('loader-service').loader;
    });

    test('host does not re-fetch query-backed relationships', async function (assert) {
      assert.expect(9);
      let network = getService('network') as NetworkService;

      let interceptedSearchRequests: string[] = [];
      let handler = async (request: Request) => {
        let url = new URL(request.url);
        if (url.pathname.endsWith('/_search')) {
          interceptedSearchRequests.push(request.url);
        }
        return null;
      };

      network.virtualNetwork.mount(handler, { prepend: true });
      try {
        interceptedSearchRequests = [];
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_URL, format: 'isolated' }]],
        });
        await settled();

        assert.strictEqual(
          interceptedSearchRequests.length,
          0,
          'no search requests before editing',
        );

        let cardSelector = `[data-test-stack-card="${QUERY_CARD_URL}"]`;
        assert.dom(cardSelector).exists('query card is open in operator mode');
        await waitFor(`${cardSelector} [data-test-favorite]`);

        assert.strictEqual(
          interceptedSearchRequests.length,
          0,
          'no _search requests were triggered while materializing query-backed relationships',
        );
        assert
          .dom(`${cardSelector} [data-test-favorite]`)
          .includesText(
            'Target',
            'linksTo query field was hydrated from server response',
          );

        let matchElements = findAll(`${cardSelector} [data-test-match]`);
        assert.deepEqual(
          matchElements.map((el) => el.textContent?.trim()),
          ['Target'],
          'linksToMany query field was hydrated from server response',
        );
        assert
          .dom(cardSelector)
          .includesText(
            'Target',
            'rendered card displays data without re-fetching',
          );

        await click(`${cardSelector} [data-test-edit-button]`);
        await waitFor(`${cardSelector} [data-test-card-format="edit"]`);

        assert
          .dom(`${cardSelector} [data-test-links-to-editor="favorite"]`)
          .doesNotExist('linksTo editor is hidden for query-backed field');
        assert
          .dom(`${cardSelector} [data-test-add-new="favorite"]`)
          .doesNotExist('add button is hidden for query-backed linksTo');
        assert
          .dom(`${cardSelector} [data-test-links-to-many="matches"]`)
          .doesNotExist('linksToMany editor is hidden for query-backed field');
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });

    test('linksTo query field hydrates null without re-fetch when no result', async function (assert) {
      assert.expect(4);
      let network = getService('network') as NetworkService;
      let interceptedSearchRequests: string[] = [];
      let handler = async (request: Request) => {
        let url = new URL(request.url);
        if (url.pathname.endsWith('/_search')) {
          interceptedSearchRequests.push(request.url);
        }
        return null;
      };

      network.virtualNetwork.mount(handler, { prepend: true });
      try {
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_MISSING_URL, format: 'isolated' }]],
        });
        await settled();

        let cardSelector = `[data-test-stack-card="${QUERY_CARD_MISSING_URL}"]`;
        assert
          .dom(cardSelector)
          .exists('query card with missing result is rendered');
        await waitFor(`${cardSelector} [data-test-matches]`);

        assert.strictEqual(
          interceptedSearchRequests.length,
          0,
          'no search requests triggered when server returned null query relationship',
        );

        let favoriteText = findAll(
          `${cardSelector} [data-test-favorite]`,
        )[0]?.textContent?.trim();
        assert.strictEqual(
          favoriteText,
          '',
          'linksTo query field renders empty when no result is returned',
        );
        assert.strictEqual(
          findAll(`${cardSelector} [data-test-match]`).length,
          0,
          'linksToMany query field renders empty when no results are returned',
        );
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });

    test('linksToMany query fields append new matches after realm invalidations', async function (assert) {
      assert.expect(6);

      let network = getService('network') as NetworkService;
      let interceptedSearchRequests: string[] = [];
      let handler = async (request: Request) => {
        let url = new URL(request.url);
        if (url.pathname.endsWith('/_search')) {
          interceptedSearchRequests.push(request.url);
        }
        return null;
      };

      network.virtualNetwork.mount(handler, { prepend: true });
      try {
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_URL, format: 'isolated' }]],
        });
        await settled();

        let cardSelector = `[data-test-stack-card="${QUERY_CARD_URL}"]`;
        assert.dom(cardSelector).exists('single query card is rendered');
        await waitFor(`${cardSelector} [data-test-matches]`);
        assert.strictEqual(
          findAll(`${cardSelector} [data-test-match]`).length,
          1,
          'linksToMany field starts with one hydrated match',
        );

        assert.strictEqual(
          interceptedSearchRequests.length,
          0,
          'no query runs while hydrating server-provided results',
        );

        let realmMatrixUsername = testRealmURLToUsername(testRealmURL);
        let realmRoomId = mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        );

        await saveCard(
          new PersonClass({ name: 'Target' }),
          `${testRealmURL}Person/new-match`,
          loader,
        );
        mockMatrixUtils.simulateRemoteMessage(
          realmRoomId,
          realmMatrixUsername,
          {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [`${testRealmURL}Person/new-match`],
          },
          { type: APP_BOXEL_REALM_EVENT_TYPE },
        );
        await settled();

        assert.strictEqual(
          interceptedSearchRequests.length,
          2,
          'realm invalidation triggers a refresh for each query-backed field',
        );
        assert.ok(
          interceptedSearchRequests[0].includes('_search'),
          'query refresh targets the realm search endpoint',
        );
        assert.strictEqual(
          findAll(`${cardSelector} [data-test-match]`).length,
          2,
          'linksToMany field shows the newly added match after refresh',
        );
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });

    test('query-backed relationships defined within FieldDef are hydrated without refetch', async function (assert) {
      assert.expect(3);
      let network = getService('network') as NetworkService;
      let interceptedSearchRequests: string[] = [];
      let handler = async (request: Request) => {
        let url = new URL(request.url);
        if (url.pathname.endsWith('/_search')) {
          interceptedSearchRequests.push(request.url);
        }
        return null;
      };

      network.virtualNetwork.mount(handler, { prepend: true });
      try {
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_NESTED_URL, format: 'isolated' }]],
        });
        let cardSelector = `[data-test-stack-card="${QUERY_CARD_NESTED_URL}"]`;
        await waitFor(`${cardSelector} [data-test-matches]`);

        assert.strictEqual(
          interceptedSearchRequests.length,
          0,
          'no search requests triggered while hydrating nested query-backed relationships',
        );
        assert
          .dom(`${cardSelector} [data-test-favorite]`)
          .includesText(
            'Target',
            'nested linksTo query field hydrated from server response',
          );
        assert.deepEqual(
          findAll(`${cardSelector} [data-test-match]`).map((el) =>
            el.textContent?.trim(),
          ),
          ['Target'],
          'nested linksToMany query field hydrated from server response',
        );
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });

    test('query fields do not respond to realm invalidations once garbage collected', async function (assert) {
      assert.expect(3);

      let network = getService('network') as NetworkService;
      let interceptedSearchRequests: string[] = [];
      let handler = async (request: Request) => {
        let url = new URL(request.url);
        if (url.pathname.endsWith('/_search')) {
          interceptedSearchRequests.push(request.url);
        }
        return null;
      };
      network.virtualNetwork.mount(handler, { prepend: true });

      try {
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_URL, format: 'isolated' }]],
        });
        await settled();

        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_2_URL, format: 'isolated' }]],
        });
        await settled();

        let store = getService('store') as StoreService;
        (store as any).store.sweep(cardAPI);
        (store as any).store.sweep(cardAPI);
        await settled();

        let realmMatrixUsername = testRealmURLToUsername(testRealmURL);
        let realmRoomId = mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        );

        await saveCard(
          new PersonClass({ name: 'Not Target' }),
          `${testRealmURL}Person/new-match`,
          loader,
        );
        mockMatrixUtils.simulateRemoteMessage(
          realmRoomId,
          realmMatrixUsername,
          {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [`${testRealmURL}Person/new-match`],
          },
          { type: APP_BOXEL_REALM_EVENT_TYPE },
        );
        await settled();

        assert.strictEqual(
          interceptedSearchRequests.length,
          2,
          'realm invalidation triggers a refresh for each query-backed field',
        );
        assert.ok(
          interceptedSearchRequests[0].includes('_search'),
          'query refresh targets the realm search endpoint',
        );
        let cardSelector = `[data-test-stack-card="${QUERY_CARD_2_URL}"]`;
        assert.strictEqual(
          findAll(`${cardSelector} [data-test-match]`).length,
          2,
          'linksToMany field shows the newly added match after refresh',
        );
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });

    test('interpolated value in query fields triggers search refresh', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: QUERY_CARD_URL, format: 'isolated' }]],
      });
      let cardSelector = `[data-test-stack-card="${QUERY_CARD_URL}"]`;
      await waitFor(`${cardSelector} [data-test-matches]`);
      // assert on initial matches
      let matchElements = findAll(`${cardSelector} [data-test-match]`);
      assert.deepEqual(
        matchElements.map((el) => el.textContent?.trim()),
        ['Target'],
        'linksToMany query field was hydrated with initial value',
      );
      let titleElement = `${cardSelector} [data-test-inline-title] input`;
      await waitFor(titleElement);
      await fillIn(titleElement, 'Not Target');

      //assert on new matches
      matchElements = findAll(`${cardSelector} [data-test-match]`);
      assert.deepEqual(
        matchElements.map((el) => el.textContent?.trim()),
        ['Not Target'],
        'linksToMany query field was updated after changing the interpolated value',
      );
    });

    test('saves omit query-backed relationships from JSON payload', async function (assert) {
      let interceptedBody: any;
      let network = getService('network') as NetworkService;
      let handler = async (request: Request) => {
        if (request.method === 'PATCH' && request.url.endsWith('/query-card')) {
          interceptedBody = await request.clone().json();
        }
        return null;
      };
      network.virtualNetwork.mount(handler, { prepend: true });

      try {
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_URL, format: 'isolated' }]],
        });
        await waitFor('[data-test-edit-button]');
        await click('[data-test-edit-button]');
        await fillIn('[data-test-field="cardTitle"] input', 'Not Target');

        await waitUntil(
          () => {
            return (
              find('[data-test-last-saved]')
                ?.textContent?.trim()
                ?.startsWith('Saved') ?? false
            );
          },
          { timeoutMessage: 'auto-save did not complete' },
        );

        assert.ok(interceptedBody, 'captured auto-save payload');
        let relationships = interceptedBody?.data?.relationships ?? {};
        assert.notOk(
          'favorite' in relationships,
          'linksTo query field was omitted from PATCH body',
        );
        assert.notOk(
          'matches' in relationships,
          'linksToMany query field was omitted from PATCH body',
        );
        assert.notOk(
          'matches.0' in relationships,
          'linksToMany query field was omitted from PATCH body',
        );
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });
  },
);
