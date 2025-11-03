import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  isCardInstance,
  isSingleCardDocument,
} from '@cardstack/runtime-common';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type NetworkService from '@cardstack/host/services/network';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../helpers';
import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

const QUERY_CARD_URL = `${testRealmURL}query-card`;

module(
  'Integration | Query Fields | host respects server-populated results',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function () {
      class Person extends CardDef {
        @field name = contains(StringField);
      }

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
          },
        });
        static isolated = class Isolated extends Component<typeof QueryCard> {
          <template>
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
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'query-card.gts': { QueryCard },
          'Person/target.json': new Person({ name: 'Target' }),
          'query-card.json': {
            data: {
              attributes: {
                title: 'Target',
              },
              meta: {
                adoptsFrom: {
                  module: './query-card',
                  name: 'QueryCard',
                },
              },
            },
          },
        },
      });
    });

    test('host does not re-fetch query-backed relationships', async function (assert) {
      assert.expect(5);
      let network = getService('network') as NetworkService;
      let store = getService('store') as StoreService;
      let cardService = getService('card-service') as CardService;
      let loaderService = getService('loader-service') as LoaderService;

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
        let doc = await cardService.fetchJSON(QUERY_CARD_URL);
        assert.ok(doc, 'server returned a card document');
        if (!doc || !isSingleCardDocument(doc)) {
          throw new Error('expected server to return a single card document');
        }
        let looseDoc = doc as LooseSingleCardDocument;
        let queryCardInstance = await store.add(looseDoc, {
          doNotPersist: true,
          relativeTo: new URL(QUERY_CARD_URL),
        });

        if (!isCardInstance(queryCardInstance)) {
          throw new Error('expected card instance');
        }

        type PersonInstance = CardDefType & { name: string };
        type QueryCardInstance = CardDefType & {
          favorite: PersonInstance | null;
          matches: PersonInstance[];
        };

        let queryCard = queryCardInstance as QueryCardInstance;

        let loader = loaderService.loader;
        let element = await renderCard(loader, queryCard, 'isolated');
        await settled();

        let favorite = queryCard.favorite;
        let matches = Array.from(queryCard.matches ?? []);

        assert.strictEqual(
          interceptedSearchRequests.length,
          0,
          'no _search requests were triggered while materializing query-backed relationships',
        );
        assert.strictEqual(
          favorite?.name,
          'Target',
          'linksTo query field was hydrated from server response',
        );
        assert.deepEqual(
          matches.map((match) => match.name),
          ['Target'],
          'linksToMany query field was hydrated from server response',
        );
        assert
          .dom(element)
          .hasTextContaining(
            'Target',
            'rendered card displays data without re-fetching',
          );
      } finally {
        network.virtualNetwork.unmount(handler);
      }
    });
  },
);
