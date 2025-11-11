import { click, findAll, settled, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const QUERY_CARD_URL = `${testRealmURL}query-card`;

module(
  'Acceptance | Query Fields | host respects server-populated results',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'query-card.gts': `
            import { CardDef, Component, StringField, contains, field, linksTo, linksToMany } from 'https://cardstack.com/base/card-api';

            export class Person extends CardDef {
              @field name = contains(StringField);
            }

            export class QueryCard extends CardDef {
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
          `,
          'Person/target.json': {
            data: {
              attributes: {
                name: 'Target',
              },
              meta: {
                adoptsFrom: {
                  module: '../query-card',
                  name: 'Person',
                },
              },
            },
          },
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
      assert.expect(8);
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
  },
);
