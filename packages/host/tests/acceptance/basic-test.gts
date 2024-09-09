import { find, visit, currentURL } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import { module, skip } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupServerSentEvents,
  setupAcceptanceTestRealm,
  lookupLoaderService,
} from '../helpers';

module('Acceptance | basic tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);

  hooks.beforeEach(async function () {
    let loaderService = lookupLoaderService();
    let loader = loaderService.loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >(`${baseRealm.url}card-api`);
    let { default: StringField } = await loader.import<
      typeof import('https://cardstack.com/base/string')
    >(`${baseRealm.url}string`);
    let { CatalogEntry } = await loader.import<
      typeof import('https://cardstack.com/base/catalog-entry')
    >(`${baseRealm.url}catalog-entry`);

    class Index extends CardDef {
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-index-card>
            Hello, world!
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-person>
            <p>First name: <@fields.firstName /></p>
            <p>Last name: <@fields.lastName /></p>
            <p>Title: <@fields.title /></p>
          </div>
          <style scoped>
            div {
              color: green;
              content: '';
            }
          </style>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      contents: {
        'index.gts': { Index },
        'person.gts': { Person },
        'person-entry.json': new CatalogEntry({
          title: 'Person',
          description: 'Catalog entry',
          isField: false,
          ref: {
            module: `./person`,
            name: 'Person',
          },
        }),
        'index.json': new Index(),
        'Person/1.json': new Person({
          firstName: 'Hassan',
          lastName: 'Abdel-Rahman',
        }),
      },
    });
  });

  // this doesn't work for now, should we be able to visit a card when not logged in?
  // if so, maybe a query parameter with the full URL for a card
  skip('visiting realm root', async function (assert) {
    await visit('/test/');

    assert.strictEqual(currentURL(), '/test/');
    assert.dom('[data-test-index-card]').containsText('Hello, world');
  });

  skip('glimmer-scoped-css smoke test', async function (assert) {
    await visit('/');

    const cardContainerElement = find('[data-test-boxel-card-container]');

    assert.ok(cardContainerElement);

    if (!cardContainerElement) {
      throw new Error('[data-test-boxel-card-container] element not found');
    }

    const buttonElementScopedCssAttribute = Array.from(
      cardContainerElement.attributes,
    )
      .map((attribute) => attribute.localName)
      .find((attributeName) => attributeName.startsWith('data-scopedcss'));

    if (!buttonElementScopedCssAttribute) {
      throw new Error(
        'Scoped CSS attribute not found on [data-test-boxel-card-container]',
      );
    }

    assert.dom('[data-test-boxel-card-container] + style').doesNotExist();
  });
});
