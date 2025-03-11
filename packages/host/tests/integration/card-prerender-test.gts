import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import {
  testRealmURL,
  setupCardLogs,
  cleanWhiteSpace,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  lookupLoaderService,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;

module('Integration | card-prerender', function (hooks) {
  let realm: Realm;

  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    loader = lookupLoaderService().loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function (this: RenderingTestContext) {
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h3><@fields.firstName /></h3>
        </template>
      };
    }

    ({ realm } = await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'Pet/mango.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Pet/mango`,
            attributes: {
              title: 'test card: pet mango',
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'Pet/vangogh.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Pet/vangogh`,
            attributes: {
              title: 'test card: pet vangogh',
              firstName: 'Van Gogh',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringCard);
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <h1><@fields.firstName/></h1>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>

                <style scoped>
                  .border {
                    border: 1px solid red;
                  }
                </style>
              </template>
            }
          }
        `,
        'fancy-person.gts': `
          import { Person } from './person';
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class FancyPerson extends Person {
            static displayName = 'Fancy Person';
            @field favoriteColor = contains(StringCard);

            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card FancyPerson: <@fields.firstName/>

                <style scoped>
                  .fancy-border {
                    border: 1px solid pink;
                  }
                </style>
              </template>
            }
          }
        `,
        'jane.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'test card: person jane',
              firstName: 'Jane',
              favoriteColor: 'blue',
            },
            meta: {
              adoptsFrom: {
                module: './fancy-person',
                name: 'FancyPerson',
              },
            },
          },
        },
        'jimmy.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'test card: person jimmy',
              firstName: 'Jimmy',
              favoriteColor: 'black',
            },
            meta: {
              adoptsFrom: {
                module: './fancy-person',
                name: 'FancyPerson',
              },
            },
          },
        },
      },
    }));
  });

  test("can generate the card's pre-rendered HTML", async function (assert) {
    {
      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealmURL}Pet/mango`),
      );
      if (entry?.type === 'instance') {
        assert.strictEqual(
          cleanWhiteSpace(stripScopedCSSAttributes(entry!.isolatedHtml!)),
          cleanWhiteSpace(`<h3> Mango </h3>`),
          'the pre-rendered HTML is correct',
        );
      } else {
        assert.ok(false, 'expected index entry not to be an error');
      }
    }
    {
      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealmURL}Pet/vangogh`),
      );
      if (entry?.type === 'instance') {
        assert.strictEqual(
          cleanWhiteSpace(stripScopedCSSAttributes(entry!.isolatedHtml!)),
          cleanWhiteSpace(`<h3> Van Gogh </h3>`),
          'the pre-rendered HTML is correct',
        );
      } else {
        assert.ok(false, 'expected index entry not to be an error');
      }
    }
  });

  test('indexer returns correct prerendered cards with their html + css when there is "on" filter specified', async function (assert) {
    let results = await realm.realmIndexQueryEngine.searchPrerendered(
      {
        filter: {
          on: {
            module: `${testRealmURL}fancy-person`,
            name: 'FancyPerson',
          },
          eq: {
            firstName: 'Jimmy',
          },
        },
      },
      {
        htmlFormat: 'embedded',
      },
    );

    assert.strictEqual(
      results.meta.page.total,
      1,
      'the search results contain the correct number of items',
    );

    assert.strictEqual(
      results.prerenderedCards.length,
      1,
      'only one prerendered card is returned with the specified filter',
    );

    assert.strictEqual(
      results.prerenderedCards[0].url,
      'http://test-realm/test/jimmy.json',
      'the prerendered card has the correct url',
    );

    assert.ok(
      results.prerenderedCards[0].html!.includes('Embedded Card FancyPerson'),
      'the embedded card html looks correct',
    );
  });

  test('indexer returns correct prerendered cards with their html + css when there is no "on" filter specified', async function (assert) {
    let results = await realm.realmIndexQueryEngine.searchPrerendered(
      {},
      {
        htmlFormat: 'fitted',
      },
    );

    assert.strictEqual(
      results.meta.page.total,
      4,
      'the search results contain the correct number of items',
    );

    // Since there is no "on" filter, the prerendered html must be from a CardDef template

    [
      ['test card: pet mango', 'Pet'],
      ['test card: pet vangogh', 'Pet'],
      ['test card: person jane', 'Fancy Person'],
      ['test card: person jimmy', 'Fancy Person'],
    ].forEach(([title, type], index) => {
      assert.strictEqual(
        cleanWhiteSpace(
          stripScopedCSSAttributes(results.prerenderedCards[index].html!),
        ),
        cleanWhiteSpace(`
          <div class="fitted-template">
            <div class="thumbnail-section">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                class="lucide lucide-captions card-type-icon"
                viewBox="0 0 24 24"
                data-test-card-type-icon><rect width="18" height="14" x="3" y="5" rx="2" ry="2"></rect><path d="M7 15h4m4 0h2M7 11h2m4 0h4"></path></svg>
            </div>
            <div class="info-section">
              <h3 class="card-title" data-test-card-title>${title}</h3>
              <h4 class="card-display-name" data-test-card-display-name> ${type} </h4>
            </div>
            <div class="card-description" data-test-card-description></div>
          </div>
      `),
      );
    });
  });
});
