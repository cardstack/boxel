import { click, find, visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | basic tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loaderService = getService('loader-service');
    let loader = loaderService.loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >(`${baseRealm.url}card-api`);
    let { default: StringField } = await loader.import<
      typeof import('https://cardstack.com/base/string')
    >(`${baseRealm.url}string`);
    let { Spec } = await loader.import<
      typeof import('https://cardstack.com/base/spec')
    >(`${baseRealm.url}spec`);

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
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.gts': { Index },
        'person.gts': { Person },
        'person-entry.json': new Spec({
          title: 'Person',
          description: 'Spec',
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

  test('visiting realm root', async function (assert) {
    await visit('/');

    assert.dom('[data-test-workspace-chooser]').exists();
    await click('[data-test-workspace="Unnamed Workspace"]');

    assert
      .dom('[data-test-operator-mode-stack="0"] [data-test-index-card]')
      .containsText('Hello, world');
  });

  test('glimmer-scoped-css smoke test', async function (assert) {
    await visit('/');
    await click('[data-test-workspace="Unnamed Workspace"]');

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
