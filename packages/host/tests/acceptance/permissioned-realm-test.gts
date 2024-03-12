import { visit, currentURL, triggerEvent, waitFor } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import type LoaderService from '@cardstack/host/services/loader-service';

import {
  setupLocalIndexing,
  setupServerSentEvents,
  setupAcceptanceTestRealm,
  testRealmURL,
} from '../helpers';
import { setupMatrixServiceMock } from '../helpers/mock-matrix-service';

module('Acceptance | permissioned realm tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);
  setupMatrixServiceMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
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
          <style>
            div {
              color: green;
              content: '';
            }
          </style>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      loader,
      contents: {
        'index.gts': { Index },
        'person.gts': { Person },
        'person-entry.json': new CatalogEntry({
          title: 'Person',
          description: 'Catalog entry',
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
      permissions: { users: ['read', 'write'] },
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
});
