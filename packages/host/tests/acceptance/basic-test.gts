import { find, visit, currentURL } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { Realm } from '@cardstack/runtime-common/realm';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupServerSentEvents,
  sourceFetchReturnUrlHandle,
} from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');

module('Acceptance | basic tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

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
          <style>
            div {
              color: green;
              content: '';
            }
          </style>
        </template>
      };
    }

    adapter = new TestRealmAdapter({
      'person-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `./person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
      'index.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: './index',
              name: 'Index',
            },
          },
        },
      },
      'Person/1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
    });

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
      overridingHandlers: [
        async (req: Request) => {
          return sourceFetchReturnUrlHandle(req, realm.maybeHandle.bind(realm));
        },
      ],
      shimModules: {
        'index.gts': { Index },
        'person.gts': { Person },
      },
    });
    await realm.ready;
  });

  test('visiting realm root', async function (assert) {
    await visit('/test/');

    assert.strictEqual(currentURL(), '/test/');
    assert.dom('[data-test-index-card]').containsText('Hello, world');
  });

  test('glimmer-scoped-css smoke test', async function (assert) {
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
