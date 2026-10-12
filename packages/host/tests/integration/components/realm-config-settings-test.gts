import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const noop = () => {};

// The realm's settings, as an operation reads them with `realmConfig(…)`.
// They are a free-form JSON map, so the editor is a key/value table rather
// than a field per setting: which settings a realm carries is the owner's to
// decide and is not known to the card type.
module('Integration | realm-config | settings', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  async function renderRealmConfig(
    config: Record<string, unknown> | undefined,
    format: 'isolated' | 'edit',
    attributes: Record<string, unknown> = {},
  ) {
    let loader = getService('loader-service').loader;
    let cardsGrid: typeof import('@cardstack/base/cards-grid') =
      await loader.import('@cardstack/base/cards-grid');
    let { CardsGrid } = cardsGrid;

    let { adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'index.json': new CardsGrid(),
        'realm.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: { name: 'Settings Workspace' },
              ...(config ? { config } : {}),
              ...attributes,
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/realm-config',
                name: 'RealmConfig',
              },
            },
          },
        },
      },
    });

    getService('operator-mode-state-service').restore({
      stacks: [[{ id: `${testRealmURL}realm`, format }]],
    });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}realm"]`);
    return { adapter };
  }

  test('the stored settings read as a table', async function (assert) {
    await renderRealmConfig(
      { approver: '@mae:localhost', escalateAfterDays: 3 },
      'isolated',
    );

    assert
      .dom('[data-test-realm-setting="approver"] [data-test-setting-text]')
      .hasText('@mae:localhost', 'a string setting reads as itself');
    // A number reads as the JSON it is rather than as a quoted string, which
    // is the difference a program comparing it can see.
    assert
      .dom(
        '[data-test-realm-setting="escalateAfterDays"] [data-test-setting-text]',
      )
      .hasText('3', 'a number setting reads as a number');
  });

  test('a realm with no settings says so rather than showing an empty table', async function (assert) {
    await renderRealmConfig(undefined, 'isolated');

    assert.dom('[data-test-realm-settings]').doesNotExist('no table is drawn');
    assert.dom('[data-test-realm-settings-empty]').exists('and it says why');
  });

  test('each setting is one editable row', async function (assert) {
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit');

    assert
      .dom('[data-test-setting-key="0"]')
      .hasValue('approver', 'the name is editable');
    assert
      .dom('[data-test-setting-value="0"]')
      .hasValue('@mae:localhost', 'and so is the value');
    // The type note names only what the text does not already say, so a plain
    // id carries none.
    assert
      .dom('[data-test-setting-type="0"]')
      .doesNotExist('a string needs no note about what it is stored as');
  });

  test('a value that is not text says what it will be stored as', async function (assert) {
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit');

    await fillIn('[data-test-setting-value="0"]', '3');

    assert
      .dom('[data-test-setting-type="0"]')
      .hasText(
        'stored as number',
        'the author can see the text became a number',
      );
  });

  test('a row with no name is not a setting yet, and says so', async function (assert) {
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit');

    await click('[data-test-add-setting]');

    assert
      .dom('[data-test-setting-key="1"]')
      .exists('the new row is there to be named');
    assert
      .dom('[data-test-unnamed-settings]')
      .exists('and the table says it is not stored until it is');
  });

  test('two rows with one name report which one the realm reads', async function (assert) {
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit');

    await click('[data-test-add-setting]');
    await fillIn('[data-test-setting-key="1"]', 'approver');

    assert
      .dom('[data-test-duplicate-settings]')
      .hasTextContaining(
        'approver',
        'the repeated name is named, since only the last row is read',
      );
  });

  test('a setting named after a prototype member survives an edit', async function (assert) {
    // Rebuilding the map through a plain object would answer this name by
    // invoking the prototype setter rather than creating an entry, so the row
    // would disappear the moment any other row was touched — and an object
    // value would become the rebuilt map's prototype.
    //
    // Driven by typing the name rather than by seeding the realm with one.
    // Whether a stored `__proto__` setting survives the realm's own round trip
    // to this editor is a separate question this test does not assert; what is
    // pinned here is that the editor's own rebuild does not drop it.
    await renderRealmConfig({ approver: '@ada:localhost' }, 'edit');

    await click('[data-test-add-setting]');
    await fillIn('[data-test-setting-key="1"]', '__proto__');
    await fillIn('[data-test-setting-value="1"]', '@mae:localhost');

    // The edit that would have dropped it: a change to some unrelated row,
    // which rebuilds the whole map.
    await fillIn('[data-test-setting-value="0"]', '@bea:localhost');

    assert
      .dom('[data-test-setting-key="1"]')
      .hasValue('__proto__', 'the row is still there');
    assert
      .dom('[data-test-setting-value="1"]')
      .hasValue('@mae:localhost', 'and still holds its value');
    assert
      .dom('[data-test-unnamed-settings]')
      .doesNotExist('and it counts as named');
  });

  test('a number the file cannot hold is kept as the text that was typed', async function (assert) {
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit');

    // `JSON.parse('1e400')` is `Infinity`, which `JSON.stringify` writes as
    // `null` — so calling this a number would name a type the stored setting
    // does not have.
    await fillIn('[data-test-setting-value="0"]', '1e400');

    assert
      .dom('[data-test-setting-type="0"]')
      .doesNotExist('it is text, and the row does not claim otherwise');
  });

  test('a setting name is kept exactly as the realm stores it', async function (assert) {
    // JSON holds these as keys distinct from `approver`, and a program looks
    // one up by the characters it was given — so an edit to some other row
    // must not tidy them.
    await renderRealmConfig(
      { ' approver ': '@mae:localhost', approver: '@ada:localhost' },
      'edit',
    );

    await fillIn('[data-test-setting-value="1"]', '@bea:localhost');

    assert
      .dom('[data-test-setting-key="0"]')
      .hasValue(' approver ', 'the padded name is untouched');
    assert
      .dom('[data-test-setting-value="0"]')
      .hasValue('@mae:localhost', 'and still holds its own value');
    assert
      .dom('[data-test-duplicate-settings]')
      .doesNotExist('a padded name is not the same name as the trimmed one');
  });

  test('a setting can be removed', async function (assert) {
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit');

    await click('[data-test-remove-setting="0"]');

    assert.dom('[data-test-setting-key="0"]').doesNotExist('the row is gone');
    assert
      .dom('[data-test-realm-settings-empty]')
      .exists('and the table reads as a realm with no settings');
  });

  test('a renamed setting replaces the old name in the stored file', async function (assert) {
    let { adapter } = await renderRealmConfig(
      { approver: '@mae:localhost', escalateAfterDays: 3 },
      'edit',
    );

    await fillIn('[data-test-setting-key="0"]', 'approvers');
    await click('[data-test-remove-setting="1"]');

    let stored = async () => {
      let file = await adapter.openFile('realm.json');
      return JSON.parse(file!.content as string).data.attributes.config;
    };
    await waitUntil(async () => 'approvers' in ((await stored()) ?? {}));
    assert.deepEqual(
      await stored(),
      { approvers: '@mae:localhost' },
      'the file holds the new name and not the old one, nor the removed setting',
    );
  });

  test('a setting name is written once the author finishes it', async function (assert) {
    let { adapter } = await renderRealmConfig(
      { approver: '@mae:localhost' },
      'edit',
    );
    let stored = async () => {
      let file = await adapter.openFile('realm.json');
      return JSON.parse(file!.content as string).data.attributes.config;
    };

    // Mid-name: the input has the partial text, and has not been left.
    let key = document.querySelector(
      '[data-test-setting-key="0"]',
    ) as HTMLInputElement;
    key.value = 'appr';
    await triggerEvent(key, 'input');

    assert
      .dom('[data-test-setting-key="0"]')
      .hasValue('appr', 'the row shows what is being typed');
    assert.deepEqual(
      await stored(),
      { approver: '@mae:localhost' },
      'a partial name is not written as a setting',
    );

    await triggerEvent(key, 'change');
    await waitUntil(async () => 'appr' in ((await stored()) ?? {}));
    assert.deepEqual(
      await stored(),
      { appr: '@mae:localhost' },
      'the finished name is written in place of the old one',
    );
  });

  test('a name still being typed is written when the editor goes away', async function (assert) {
    let { adapter } = await renderRealmConfig(
      { approver: '@mae:localhost' },
      'edit',
    );
    let stored = async () => {
      let file = await adapter.openFile('realm.json');
      return JSON.parse(file!.content as string).data.attributes.config;
    };

    // Typed but never left, so no change event ever fires for it.
    let key = document.querySelector(
      '[data-test-setting-key="0"]',
    ) as HTMLInputElement;
    key.value = 'approvers';
    await triggerEvent(key, 'input');

    await click(
      `[data-test-stack-card="${testRealmURL}realm"] [data-test-edit-button]`,
    );
    assert
      .dom('[data-test-realm-settings-edit]')
      .doesNotExist('the editor is gone');

    await waitUntil(async () => 'approvers' in ((await stored()) ?? {}));
    assert.deepEqual(
      await stored(),
      { approvers: '@mae:localhost' },
      'the name the author was typing is the one the file holds',
    );
  });

  // The realm's policy pointer sits beside the settings as the id of the card
  // that holds the policy. It is chosen from the card chooser, and shows the
  // id it stores beside a control to remove it.
  test('the policy pointer shows the id it stores, and can be removed', async function (assert) {
    let card = 'https://realms.example.test/org/policies/education';
    await renderRealmConfig({ approver: '@mae:localhost' }, 'edit', {
      policy: card,
    });

    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-pointer]')
      .hasText(card, 'the pointer shows the id it stores');
    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-remove]')
      .exists('and can be removed, so that another can be chosen');
  });
});
