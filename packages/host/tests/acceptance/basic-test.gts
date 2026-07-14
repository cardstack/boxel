import { click, find, settled, visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

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
      typeof import('@cardstack/base/card-api')
    >('@cardstack/base/card-api');
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');
    let { Spec } = await loader.import<typeof import('@cardstack/base/spec')>(
      '@cardstack/base/spec',
    );

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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-person>
            <p>First name: <@fields.firstName /></p>
            <p>Last name: <@fields.lastName /></p>
            <p>Title: <@fields.cardTitle /></p>
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
          cardTitle: 'Person',
          cardDescription: 'Spec',
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
    await click('[data-test-workspace-button="Unnamed Workspace"]');

    assert
      .dom('[data-test-operator-mode-stack="0"] [data-test-index-card]')
      .containsText('Hello, world');
  });

  test('recovers to the app when postLoginCompleted is cleared after boot', async function (assert) {
    await visit('/');
    assert
      .dom('[data-test-workspace-chooser]')
      .exists('app booted and rendered before the reset');

    // Reproduce the post-boot login-reset race deterministically. The persisted
    // auth is left intact (a genuine logout clears it), but postLoginCompleted
    // gets cleared — exactly what a resetState() racing a re-navigation does.
    // The <Auth/> gate is reactive, so the app swaps to the login form at once.
    let matrixService = getService('matrix-service');
    matrixService.resetState();
    await settled();
    assert
      .dom('[data-test-login-form]')
      .exists('clearing postLoginCompleted strands the app on the login form');

    // Re-run the index route model (as any re-navigation would). The one-shot
    // start() guard already latched on boot, so without the recovery path the
    // route would render <Auth/> forever; with it, the session re-establishes.
    await getService('router').refresh();
    await settled();

    assert
      .dom('[data-test-login-form]')
      .doesNotExist(
        'the index route recovers the session instead of stranding',
      );
    assert
      .dom('[data-test-workspace-chooser]')
      .exists('recovered back to the booted app');
  });

  test('submode switcher exposes an app version tooltip', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor('[data-test-submode-switcher]');

    let trigger = find(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    assert.ok(trigger, 'submode-switcher trigger renders');
    let title = trigger?.getAttribute('title') ?? '';
    assert.notStrictEqual(
      title,
      'Version undefined',
      'app version is populated (not the broken Vite default)',
    );
    assert.ok(
      /^Version \S+/.test(title),
      `app version tooltip has the expected shape, got: ${title}`,
    );
  });

  test('glimmer-scoped-css smoke test', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');

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
