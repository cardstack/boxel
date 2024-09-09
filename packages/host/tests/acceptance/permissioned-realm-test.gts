import { visit, currentURL, triggerEvent, waitFor } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';

import {
  setupLocalIndexing,
  setupServerSentEvents,
  setupAcceptanceTestRealm,
  testRealmURL,
  lookupLoaderService,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';

module('Acceptance | permissioned realm tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:staging',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    let loader = lookupLoaderService().loader;
    let { field, contains, linksTo, CardDef, Component } = await loader.import<
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

    class Company extends CardDef {}

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      @field company = linksTo(Company);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-person>
            <p>First name: <@fields.firstName /></p>
            <p>Last name: <@fields.lastName /></p>
            <p>Title: <@fields.title /></p>
            <p>Company: <@fields.company.title /></p>
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
        'Person/2.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'John',
              lastName: 'Doe',
            },
            relationships: {
              company: {
                links: {
                  self: 'http://test-realm2/test/Company/1',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://test-realm/test/person',
                name: 'Person',
              },
            },
          },
        },
      },
      permissions: { users: ['read', 'write'] },
      realmURL: testRealmURL,
    });

    await setupAcceptanceTestRealm({
      contents: {
        'Company/1.json': new Company({
          title: 'Acme Inc.',
        }),
      },
      realmURL: `http://test-realm2/test/`,
      unknownToUser: true,
    });
  });

  test('visiting realm root', async function (assert) {
    await visit('/test/');

    // Redirecting to operator mode if realm is not publicly readable
    assert.operatorModeParametersMatch(currentURL(), {
      stacks: [
        [
          {
            id: `${testRealmURL}`,
            format: 'isolated',
          },
        ],
      ],
      submode: Submodes.Interact,
    });

    await waitFor('[data-test-stack-card]');
    assert.dom(`[data-test-stack-card="${testRealmURL}"]`).exists();
    assert.dom('[data-test-index-card]').containsText('Hello, world');

    // Cannot go to guest mode
    await triggerEvent(document.body, 'keydown', {
      code: 'Key.',
      key: '.',
      ctrlKey: true,
    });
    assert.dom('[data-test-stack-card="http://test-realm/test/"]').exists();
  });

  test('accessing a card with a linksTo for a lesser-known realm', async function (assert) {
    await visit('/test/Person/2');
    assert
      .dom('[data-test-stack-card="http://test-realm/test/Person/2"]')
      .exists();
    assert.dom('[data-test-stack-card]').containsText('Company: Acme Inc.');
  });
});
