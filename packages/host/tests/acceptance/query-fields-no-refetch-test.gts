import {
  click,
  fillIn,
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

import type CardService from '@cardstack/host/services/card-service';
import type NetworkService from '@cardstack/host/services/network';

import {
  saveCard,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import {
  setupBaseRealm,
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const QUERY_CARD_URL = `${testRealmURL}query-card`;

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
      class QueryCard extends CardDef {
        @field title = contains(StringField);
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
              <@fields.title @format='edit' />
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
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'query-card.gts': { Person, QueryCard },
          'Person/target.json': new Person({ name: 'Target' }),
          'Person/not-target.json': new Person({ name: 'Not Target' }),
          'query-card.json': new QueryCard({
            title: 'Target',
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

    test('query-backed fields refresh again when local inputs change while a fetch is in flight', async function (assert) {
      assert.expect(6);
      let cardService = getService('card-service') as CardService;
      let originalFetchJSON = cardService.fetchJSON;

      let searchCount = 0;
      let firstSearchDeferred:
        | { promise: Promise<void>; resolve: () => void }
        | undefined;

      function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
        let resolve!: () => void;
        let promise = new Promise<void>((res) => {
          resolve = res;
        });
        return { promise, resolve };
      }

      cardService.fetchJSON = async function (
        ...args: Parameters<CardService['fetchJSON']>
      ) {
        let [href] = args;
        if (typeof href === 'string' && href.endsWith('/_search')) {
          searchCount++;
          console.log('[intercepted _search]', href);
          if (!firstSearchDeferred) {
            firstSearchDeferred = makeDeferred();
            await firstSearchDeferred.promise;
          }
        }
        return await originalFetchJSON.apply(this, args);
      };

      try {
        await visitOperatorMode({
          stacks: [[{ id: QUERY_CARD_URL, format: 'isolated' }]],
        });
        await settled();

        let cardSelector = `[data-test-stack-card="${QUERY_CARD_URL}"]`;
        await waitFor(`${cardSelector} [data-test-field="title"] input`);

        let titleSelector = `${cardSelector} [data-test-field="title"] input`;
        let titleInput =
          document.querySelector<HTMLInputElement>(titleSelector);
        assert.strictEqual(
          titleInput?.value,
          'Target',
          'precondition reflects initial title',
        );

        await fillIn(titleSelector, 'Not Target');
        await waitUntil(() => searchCount === 1, {
          timeout: 2000,
          timeoutMessage: 'first search never started',
        });

        await fillIn(titleSelector, 'Target');

        assert.strictEqual(
          searchCount,
          1,
          'second edit waited for in-flight refresh to finish',
        );

        firstSearchDeferred?.resolve();
        firstSearchDeferred = undefined;

        await waitUntil(() => searchCount >= 2, {
          timeout: 2000,
          timeoutMessage: 'second search never triggered',
        });
        assert.ok(
          searchCount >= 2,
          'second search triggered after in-flight refresh completed',
        );

        let finalValue =
          document.querySelector<HTMLInputElement>(titleSelector)?.value;
        assert.strictEqual(
          finalValue,
          'Target',
          'title input reflects last edit',
        );
        assert
          .dom(`${cardSelector} [data-test-favorite]`)
          .includesText(
            'Target',
            'linksTo field displays the latest query results',
          );
        assert.deepEqual(
          findAll(`${cardSelector} [data-test-match]`).map((el) =>
            el.textContent?.trim(),
          ),
          ['Target'],
          'linksToMany reflects the latest query signature',
        );
      } finally {
        cardService.fetchJSON = originalFetchJSON;
      }
    });
  },
);
