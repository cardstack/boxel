import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  typeIn,
  focus,
  settled,
  triggerEvent,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import {
  baseRealm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | operator-mode | card catalog', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};
  test(`displays recently accessed card`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(ctx.realmName);

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
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(ctx.realmName);

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
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    assert.dom(`[data-test-stack-card-header]`).containsText(ctx.realmName);

    await click(`[data-test-open-search-field]`);
    typeIn(`[data-test-search-field]`, 'ma');
    await waitUntil(() =>
      (
        document.querySelector('[data-test-search-label]') as HTMLElement
      )?.innerText.includes('Searching for “ma”'),
    );
    assert.dom(`[data-test-search-label]`).containsText('Searching for “ma”');
    await settled();

    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
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

  test(`can specify a card by URL in the card chooser`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor(`[data-test-card-catalog-item]`);
    await fillIn(
      `[data-test-search-field]`,
      `https://cardstack.com/base/types/card`,
    );

    await waitFor('[data-test-card-catalog-item]', {
      count: 1,
    });

    assert
      .dom(`[data-test-realm="Base Workspace"] [data-test-results-count]`)
      .hasText('1 result');

    assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });
    await click('[data-test-select]');

    await waitFor('[data-test-card-catalog-go-button][disabled]', {
      count: 0,
    });
    await click('[data-test-card-catalog-go-button]');
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-field="cardInfo-name"]`,
    );
    assert
      .dom(`[data-test-stack-card-index="1"] [data-test-field="cardInfo-name"]`)
      .exists();
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-field="cardInfo-summary"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-field="cardInfo-notes"]`,
      )
      .exists();
  });

  test(`can search by card title in card chooser`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      )
      .exists();

    await fillIn(`[data-test-search-field]`, `pet`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await fillIn(`[data-test-search-field]`, `publishing packet`);
    await waitUntil(
      () =>
        !document.querySelector(
          `[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"]`,
        ),
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 1 });

    await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');
    assert.dom('[data-test-stack-card-index="1"]').exists();
    assert
      .dom(
        '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
      )
      .hasText('Publishing Packet - Untitled');
  });

  test(`can search by card title when opening card chooser from a field editor`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`).exists();
    await click(
      `[data-test-stack-card="${testRealmURL}BlogPost/2"] [data-test-edit-button]`,
    );
    await waitFor(`[data-test-field="authorBio"]`);
    await click('[data-test-add-new="authorBio"]');

    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .hasText('Choose an Author card');
    assert.dom('[data-test-results-count]').hasText('3 results');

    await fillIn(`[data-test-search-field]`, `alien`);
    await waitFor('[data-test-card-catalog-item]');
    assert.dom(`[data-test-select="${testRealmURL}Author/1"]`).exists();
  });

  test(`displays no cards available message if search result does not exist`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await fillIn(`[data-test-search-field]`, `friend`);
    await waitFor('[data-test-card-catalog-item]', { count: 0 });
    assert.dom(`[data-test-card-catalog]`).hasText('No cards available');
  });

  test(`can filter by realm after searching in card catalog`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(`[data-test-realm="Base Workspace"] [data-test-card-catalog-item]`)
      .exists();

    await fillIn(`[data-test-search-field]`, `general`);

    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"]`,
      { count: 0 },
    );

    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item]`,
      )
      .exists({ count: 1 });

    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item]`,
      )
      .exists({ count: 1 });

    assert
      .dom(
        '[data-test-realm="Operator Mode Workspace"] [data-test-results-count]',
      )
      .hasText('1 result');

    assert
      .dom('[data-test-realm="Base Workspace"] [data-test-results-count]')
      .hasText('1 result');

    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-select="${testRealmURL}Spec/pet-room"]`,
      )
      .exists();

    assert
      .dom(
        `[data-test-realm="Base Workspace"] [data-test-select="${baseRealm.url}types/card"]`,
      )
      .exists();

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Base Workspace"]');

    assert.dom(`[data-test-realm]`).exists({ count: 1 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert.dom(`[data-test-select="${testRealmURL}Spec/pet-room"]`).exists();

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Operator Mode Workspace"]');
    assert.dom('[data-test-realm="Operator Mode Workspace"]').doesNotExist();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert.dom(`[data-test-card-catalog-item]`).doesNotExist();
    assert.dom('[data-test-card-catalog]').hasText('No cards available');

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Operator Mode Workspace"]');
    assert.dom(`[data-test-realm]`).exists({ count: 1 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert.dom(`[data-test-select="${testRealmURL}Spec/pet-room"]`).exists();
  });

  test(`can open new card editor in the stack after searching in card catalog`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await typeIn(`[data-test-search-field]`, `pet`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await click(`[data-test-select="${testRealmURL}Spec/pet-card"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom(
        '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
      )
      .hasText('Pet');
  });

  test(`cancel button closes the spec card picker`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);

    await typeIn(`[data-test-search-field]`, `pet`);
    assert.dom(`[data-test-search-field]`).hasValue('pet');
    await waitFor('[data-test-card-catalog-item]', { count: 2 });
    await click(`[data-test-select="${testRealmURL}Spec/pet-room"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/pet-room"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog]', { count: 0 });

    assert.dom('[data-test-operator-mode-stack="0"]').exists();
    assert
      .dom('[data-test-operator-mode-stack="1"]')
      .doesNotExist('no cards are added');

    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(`[data-test-search-field]`)
      .hasNoValue('Card picker state is reset');
    assert.dom('[data-test-card-catalog-item-selected]').doesNotExist();
  });

  test(`cancel button closes the field picker`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    await click(`[data-test-field="authorBio"] [data-test-add-new]`);

    await waitFor('[data-test-card-catalog-modal]');
    await waitFor('[data-test-card-catalog-item]', { count: 3 });

    await typeIn(`[data-test-search-field]`, `bob`);
    assert.dom(`[data-test-search-field]`).hasValue('bob');

    await waitFor('[data-test-card-catalog-item]', { count: 1 });

    await click(`[data-test-select="${testRealmURL}Author/1"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/1"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog]', { count: 0 });

    assert
      .dom(`[data-test-field="authorBio"] [data-test-add-new]`)
      .exists('no card is chosen');

    await click(`[data-test-field="authorBio"] [data-test-add-new]`);
    assert
      .dom(`[data-test-search-field]`)
      .hasNoValue('Field picker state is reset');
    assert.dom('[data-test-card-catalog-item-selected]').doesNotExist();
  });

  test(`can add a card to the stack by URL from search sheet`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await click('[data-test-open-search-field]');
    await fillIn('[data-test-search-field]', 'http://localhost:4202/test/man');
    await waitFor(`[data-test-search-label]`);

    assert
      .dom('[data-test-search-label]')
      .containsText('No card found at http://localhost:4202/test/man');
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();

    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/mango',
    );
    await waitFor('[data-test-search-sheet-search-result]');

    assert
      .dom('[data-test-search-label]')
      .containsText('Card found at http://localhost:4202/test/mango');
    assert.dom('[data-test-search-sheet-search-result]').exists({ count: 1 });

    await fillIn('[data-test-search-field]', 'http://localhost:4202/test/man');

    assert
      .dom('[data-test-search-label]')
      .containsText('No card found at http://localhost:4202/test/man');
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();

    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/mango',
    );
    await waitFor('[data-test-search-sheet-search-result]');

    await click('[data-test-search-sheet-search-result]');

    await waitFor(`[data-test-stack-card="http://localhost:4202/test/mango"]`);
    assert
      .dom(
        `[data-test-stack-card="http://localhost:4202/test/mango"] [data-test-field-component-card]`,
      )
      .containsText('Mango', 'the card is rendered in the stack');
  });

  test(`can select one or more cards on cards-grid and unselect`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    assert.dom(`[data-test-cards-grid-cards]`).exists();

    await waitFor(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`,
    );
    assert.dom('[data-test-overlay-selected]').doesNotExist();

    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/fadhlan"]`);
    assert
      .dom(`[data-test-overlay-selected="${testRealmURL}Person/fadhlan"]`)
      .exists();
    assert.dom('[data-test-overlay-selected]').exists({ count: 1 });

    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/jackie"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/jackie"]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Author/1"] .field-component-card`,
    );
    await click(
      `[data-test-cards-grid-item="${testRealmURL}BlogPost/2"] .field-component-card`,
    );
    assert.dom('[data-test-overlay-selected]').exists({ count: 4 });

    await click(
      `[data-test-cards-grid-item="${testRealmURL}Pet/jackie"] .field-component-card`,
    );
    assert.dom('[data-test-overlay-selected]').exists({ count: 3 });

    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await click(
      `[data-test-cards-grid-item="${testRealmURL}BlogPost/2"] .field-component-card`,
    );
    await click(`[data-test-overlay-select="${testRealmURL}Author/1"]`);
    assert.dom('[data-test-overlay-selected]').doesNotExist();

    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`, { count: 1 });
  });

  test('CardDef filter is not displayed in filter list', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Person/1"]`)
      .exists();
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}CardDef/1"]`)
      .exists();
    assert.dom(`[data-test-boxel-filter-list-button="Person"]`).exists();
    assert.dom(`[data-test-boxel-filter-list-button="CardDef"]`).doesNotExist();
  });

  test('card type filter remains for instance errors with last known good state', async function (assert) {
    await ctx.testRealm.write(
      'ExplodingCard/1.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Stable Example',
            status: 'boom',
          },
          meta: {
            adoptsFrom: {
              module: '../exploding-card.gts',
              name: 'ExplodingCard',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(
      `[data-test-cards-grid-item="${testRealmURL}ExplodingCard/1"][data-test-instance-error]`,
    );
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}ExplodingCard/1"][data-test-instance-error]`,
      )
      .exists();

    await waitFor('[data-test-boxel-filter-list-button="Exploding Card"]');
    assert
      .dom('[data-test-boxel-filter-list-button="Exploding Card"]')
      .exists();

    await click('[data-test-boxel-filter-list-button="Exploding Card"]');
    await waitFor(
      `[data-test-cards-grid-item="${testRealmURL}ExplodingCard/1"][data-test-instance-error]`,
    );
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}ExplodingCard/1"][data-test-instance-error] [data-test-card-title]`,
      )
      .containsText('Stable Example');
  });

  test('updates filter list when there is indexing event', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Person/1"]`)
      .exists();
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}CardDef/1"]`)
      .exists();

    assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 13 });
    assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).doesNotExist();

    await click('[data-test-create-new-card-button]');
    await waitFor(`[data-test-card-catalog-item]`);
    await fillIn(`[data-test-search-field]`, `Skill`);
    await click(
      '[data-test-card-catalog-item="https://cardstack.com/base/cards/skill"]',
    );
    await click('[data-test-card-catalog-go-button]');

    await fillIn('[data-test-field="title"] input', 'New Skill');
    await click('[data-test-close-button]');

    assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 14 });
    assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).exists();

    await click('[data-test-boxel-filter-list-button="Skill"]');
    await triggerEvent(
      `[data-test-cards-grid-item] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-card] [data-test-overlay-more-options]`);
    await click('[data-test-boxel-menu-item-text="Delete"]');

    await click('[data-test-confirm-delete-button]');

    assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 13 });
    assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).doesNotExist();
  });
});
