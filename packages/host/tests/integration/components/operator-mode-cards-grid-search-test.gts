import {
  click,
  focus,
  settled,
  typeIn,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import setupOperatorModeTest from '../../helpers/operator-mode-test-setup';
import { renderComponent } from '../../helpers/render-component';

module(
  'Integration | operator-mode | cards grid search and recents',
  function (hooks) {
    let { noop, realmName, setCardInOperatorModeState } =
      setupOperatorModeTest(hooks);

    test('can close cards by clicking the header of a card deeper in the stack', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await waitFor(`[data-test-cards-grid-item]`);
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
      );
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert.dom(`[data-test-stack-card-index="1"]`).exists();

      await waitFor('[data-test-person]');

      await waitFor('[data-test-cards-grid-item]');
      await click('[data-test-cards-grid-item] .field-component-card');
      await waitFor(`[data-test-stack-card-index="2"]`);
      assert.dom(`[data-test-stack-card-index="2"]`).exists();
      await click('[data-test-stack-card-index="0"] [data-test-card-header]');

      await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
      await waitFor('[data-test-stack-card-index="1"]', { count: 0 });

      assert.dom(`[data-test-stack-card-index="2"]`).doesNotExist();
      assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
      assert.dom(`[data-test-stack-card-index="0"]`).exists();
    });

    test(`displays realm name as cards grid card title and card's display name as other card titles`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
      );
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert.dom(`[data-test-stack-card-index="1"]`).exists();
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-card-header-title]`,
        )
        .containsText('Person');

      assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
      assert.dom(`[data-test-create-new-card-button]`).isNotVisible();
    });

    test(`displays recently accessed card`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
      );
      await waitFor(`[data-test-stack-card-index="1"]`);

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-card-header-title]`,
        )
        .containsText('Person');

      assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
      assert.dom(`[data-test-create-new-card-button]`).isNotVisible();

      await click(`[data-test-open-search-field]`);
      assert
        .dom(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`)
        .exists();
      await click(`[data-test-search-sheet-cancel-button]`);
      await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);

      await waitUntil(
        () => !document.querySelector('[data-test-stack-card-index="1"]'),
      );

      await waitFor(`[data-test-cards-grid-item]`);
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
      );
      await waitFor(`[data-test-stack-card-index="1"]`);

      await click(`[data-test-open-search-field]`);

      await waitFor(`[data-test-search-result-index="0"]`);
      await waitFor(`[data-test-search-result-index="1"]`);
      assert.dom(`[data-test-search-result]`).exists({ count: 2 });
      assert
        .dom(
          `[data-test-search-result-index="0"][data-test-search-result="${testRealmURL}Person/burcu"]`,
        )
        .exists();
      assert
        .dom(
          `[data-test-search-result-index="1"][data-test-search-result="${testRealmURL}Person/fadhlan"]`,
        )
        .exists();
    });

    test(`displays recently accessed card, maximum 10 cards`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);
      for (let i = 1; i <= 11; i++) {
        await click(
          `[data-test-cards-grid-item="${testRealmURL}Person/${i}"] .field-component-card`,
        );
        await waitFor(
          `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"]`,
        );
        await click(
          `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"] [data-test-close-button]`,
        );
        await waitFor(
          `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"]`,
          { count: 0 },
        );
      }

      await click(`[data-test-open-search-field]`);
      await waitFor(`[data-test-search-result]`);
      assert.dom(`[data-test-search-result]`).exists({ count: 10 });
    });

    test(`displays searching results`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );

      assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

      await click(`[data-test-open-search-field]`);
      typeIn(`[data-test-search-field]`, 'ma');
      await waitUntil(() =>
        (
          document.querySelector('[data-test-search-label]') as HTMLElement
        )?.innerText.includes('Searching for “ma”'),
      );
      assert.dom(`[data-test-search-label]`).containsText('Searching for “ma”');
      await settled();

      assert
        .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
        .exists();
      assert
        .dom(
          `[data-test-search-result="${testRealmURL}Pet/mango"] + [data-test-realm-name]`,
        )
        .containsText('Operator Mode Workspace');
      assert
        .dom(`[data-test-search-result="${testRealmURL}Author/mark"]`)
        .exists();

      await click(`[data-test-search-sheet-cancel-button]`);
      await click(`[data-test-open-search-field]`);
      await typeIn(`[data-test-search-field]`, 'Mark J');

      assert
        .dom(`[data-test-search-label]`)
        .containsText('1 Result for “Mark J”');

      await click(`[data-test-search-sheet-cancel-button]`);
      await click(`[data-test-open-search-field]`);
      assert.dom(`[data-test-search-label]`).doesNotExist();
      assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();

      await focus(`[data-test-search-field]`);
      typeIn(`[data-test-search-field]`, 'No Cards');
      await waitUntil(() =>
        (
          document.querySelector('[data-test-search-label]') as HTMLElement
        )?.innerText.includes('Searching for “No Cards”'),
      );
      assert
        .dom(`[data-test-search-label]`)
        .containsText('Searching for “No Cards”');

      await settled();

      assert
        .dom(`[data-test-search-label]`)
        .containsText('0 Results for “No Cards”');
      assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();
    });
  },
);
