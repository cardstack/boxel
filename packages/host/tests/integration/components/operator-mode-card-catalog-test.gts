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

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { percySnapshot, testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | operator-mode | card catalog', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};

  module('recents section', function () {
    test(`displays recently accessed card`, async function (assert) {
      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
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

      await waitFor(`[data-test-grid-item-index="0"]`);
      await waitFor(`[data-test-grid-item-index="1"]`);
      assert.dom(`[data-test-search-result]`).exists({ count: 2 });
      assert
        .dom(
          `[data-test-grid-item-index="0"] [data-test-search-result="${testRealmURL}Person/burcu"]`,
        )
        .exists();
      assert
        .dom(
          `[data-test-grid-item-index="1"] [data-test-search-result="${testRealmURL}Person/fadhlan"]`,
        )
        .exists();
    });

    test(`displays recently accessed card, maximum 10 cards`, async function (assert) {
      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
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

      assert
        .dom(`[data-test-search-result]`)
        .exists(
          { count: 10 },
          'recents capped at 10 total, search bar results are not capped',
        );
      assert
        .dom('[data-test-search-sheet] [data-test-grid-item-index="0"]')
        .containsText('11', 'search bar results are sorted by most recent');

      // expand search sheet
      await fillIn('[data-test-search-field]', ' ');

      const recents = '[data-test-search-result-section="0"]';
      assert
        .dom(`${recents} [data-test-search-sheet-section-header]`)
        .containsText('Recents');
      assert
        .dom(`${recents} [data-test-card-catalog-item]`)
        .exists(
          { count: 5 },
          'when expanded, recents results are capped at 5 with show more button',
        );
      assert.dom(`${recents} [data-test-search-sheet-show-more]`).exists();
    });

    test(`is present when search sheet is open (expanded mode)`, async function (assert) {
      // creates a recent item
      let recentCardsService = getService('recent-cards-service');
      [`${testRealmURL}Pet/mango`, `${testRealmURL}Pet/jackie`].map((url) =>
        recentCardsService.add(url),
      );

      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-open-search-field]`);
      // In compact (prompt) mode, section headers are not rendered; type a query to expand to results mode
      await fillIn(`[data-test-search-field]`, 'ma');
      assert.dom(`[data-test-search-sheet-section-header]`).exists();
      assert.dom('.search-sheet-content').containsText('Recent');
    });

    test(`filters cards by search key`, async function (assert) {
      let recentCardsService = getService('recent-cards-service');
      [`${testRealmURL}Pet/mango`, `${testRealmURL}Person/fadhlan`].map((url) =>
        recentCardsService.add(url),
      );

      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-open-search-field]`);

      // Search for "man" — only Mango should appear in recents
      await fillIn(`[data-test-search-field]`, 'man');
      await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`);
      assert
        .dom(`[data-test-grid-item-index]`)
        .exists({ count: 1 }, 'only 1 recent card matches "man"');
      assert
        .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
        .exists('Mango appears in filtered recents');

      // Search for "fadh" — only Fadhlan should appear in recents
      await fillIn(`[data-test-search-field]`, 'fadh');
      await waitFor(
        `[data-test-search-result="${testRealmURL}Person/fadhlan"]`,
      );
      assert
        .dom(`[data-test-grid-item-index]`)
        .exists({ count: 1 }, 'only 1 recent card matches "fadh"');
      assert
        .dom(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`)
        .exists('Fadhlan appears in filtered recents');

      // Search for something that matches no recents
      await fillIn(`[data-test-search-field]`, 'zzzzz');

      assert
        .dom(`[data-test-grid-item-index]`)
        .doesNotExist('no recent cards match "zzzzz"');
    });

    test(`filters cards by realm`, async function (assert) {
      let recentCardsService = getService('recent-cards-service');
      [
        `${baseRealm.url}index`,
        `${testRealmURL}Pet/mango`,
        `${baseRealm.url}cards/skill`,
        `${testRealmURL}Person/fadhlan`,
      ].map((url) => recentCardsService.add(url));

      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-open-search-field]`);
      await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`);
      await waitFor(`[data-test-search-result="${baseRealm.url}cards/skill"]`);
      assert.dom('[data-test-search-result]').exists({ count: 4 });

      await click('[data-test-realm-picker]');
      await click(`[data-test-boxel-picker-option-row="${baseRealm.url}"]`);
      assert.dom('[data-test-search-result]').exists({ count: 2 });
      assert
        .dom(`[data-test-search-result="${baseRealm.url}cards/skill"]`)
        .exists();
      assert.dom(`[data-test-search-result="${baseRealm.url}index"]`).exists();

      await click(`[data-test-boxel-picker-option-row="${testRealmURL}"]`);
      assert.dom('[data-test-search-result]').exists({ count: 4 });

      // expand search sheet
      await fillIn(`[data-test-search-field]`, ' ');

      // unselect Base Realm (only test realm selected)
      await click(
        '[data-test-realm-picker] [data-test-boxel-picker-remove-button]:nth-of-type(1)',
      );
      assert.dom('[data-test-search-result]').exists({ count: 2 });
      assert
        .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
        .exists();
      assert
        .dom(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`)
        .exists();
    });

    test(`hides cards from unselected realms`, async function (assert) {
      let recentCardsService = getService('recent-cards-service');
      recentCardsService.add(`${testRealmURL}Pet/mango`);

      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-open-search-field]`);
      await fillIn(`[data-test-search-field]`, ' ');
      await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      // Select only the base realm — testRealmURL cards should be hidden
      await click('[data-test-realm-picker] [data-test-boxel-picker-trigger]');
      await click(`[data-test-boxel-picker-option-row="${baseRealm.url}"]`);

      assert
        .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
        .doesNotExist('Pet/mango is hidden when its realm is not selected');
    });

    test(`filters cards by type for "Find Instances" search`, async function (assert) {
      let recentCardsService = getService('recent-cards-service');
      recentCardsService.add(`${testRealmURL}Pet/mango`);
      recentCardsService.add(`${testRealmURL}BoomPet/paper`); // BoomPet extends Pet
      recentCardsService.add(`${testRealmURL}Person/fadhlan`);

      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-open-search-field]`);

      // Simulate searchForInstances for Person — carddef: prefix + absolute module/name key
      await fillIn(
        `[data-test-search-field]`,
        `carddef:${testRealmURL}pet/Pet`,
      );
      await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}Pet/mango"]`)
        .exists('Pet appears when searching for Pet instances');
      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}BoomPet/paper"]`)
        .exists('BoomPet appears when searching for Pet instances');
      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}Person/fadhlan"]`)
        .doesNotExist('non-Pet recent cards are filtered out');
    });

    test(`filters cards by type for card-picker`, async function (assert) {
      let recentCardsService = getService('recent-cards-service');
      recentCardsService.add(`${testRealmURL}Pet/mango`);
      recentCardsService.add(`${testRealmURL}Spec/pet-card`);
      recentCardsService.add(`${testRealmURL}BoomPet/paper`); // BoomPet extends Pet
      recentCardsService.add(`${testRealmURL}Person/fadhlan`);

      ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);
      await click(`[data-test-create-new-card-button]`); // cards-grid add button
      await waitFor('[data-test-card-catalog-modal]');
      await settled();

      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}Spec/pet-card"]`)
        .exists('Spec recent card appears');
      assert
        .dom(`[data-test-recent-card-result]`)
        .exists({ count: 1 }, 'non-Spec recent cards are filtered out');

      ctx.setCardInOperatorModeState(`${testRealmURL}Person/hassan`, 'edit');
      await waitFor(`[data-test-stack-card="${testRealmURL}Person/hassan"]`);
      // Person/hassan has no pet set, so the linksTo add button is available
      await waitFor(`[data-test-add-new="pet"]`);
      await click(`[data-test-add-new="pet"]`);
      await waitFor('[data-test-card-catalog-modal]');
      await settled();

      assert
        .dom('[data-test-search-label]')
        .hasText('5 results across 3 realms'); // 5 in test realm
      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}Pet/mango"]`)
        .exists('Pet recent card appears in the linksTo picker');
      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}BoomPet/paper"]`)
        .exists('BoomPet recent card appears');
      assert
        .dom(`[data-test-recent-card-result]`)
        .exists({ count: 2 }, 'non-Pet recent cards are filtered out');

      await click(`[data-test-add-new="friends"]`); // linksToMany add button
      await waitFor('[data-test-card-catalog-modal]');
      await settled();

      assert
        .dom('[data-test-search-label]')
        .hasText('5 results across 3 realms'); // 5 in test realm
      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}Pet/mango"]`)
        .exists('Pet recent card appears in the linksTo picker');
      assert
        .dom(`[data-test-recent-card-result="${testRealmURL}BoomPet/paper"]`)
        .exists('BoomPet recent card appears');
      assert
        .dom(`[data-test-recent-card-result]`)
        .exists({ count: 2 }, 'non-Pet recent cards are filtered out');
    });

    test('type picker works in card catalog modal with baseFilter', async function (assert) {
      let recentCardsService = getService('recent-cards-service');
      recentCardsService.add(`${testRealmURL}Pet/mango`);
      recentCardsService.add(`${testRealmURL}Person/fadhlan`);

      ctx.setCardInOperatorModeState(`${testRealmURL}Person/hassan`, 'edit');
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}Person/hassan"]`);

      // Open linksTo card picker for Pet field
      await waitFor(`[data-test-add-new="pet"]`);
      await click(`[data-test-add-new="pet"]`);
      await waitFor('[data-test-card-catalog-modal]');
      await settled();

      // Type picker should exist in the modal
      assert
        .dom('[data-test-type-picker]')
        .exists('type picker is present in card catalog modal');

      // Open type picker
      await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
      await waitFor('[data-test-boxel-picker-option-row]');

      assert
        .dom('[data-test-boxel-picker-search] input')
        .hasAttribute(
          'placeholder',
          'Search for a type',
          'type picker has correct search placeholder',
        );

      // "Any Type" should be present with count
      assert
        .dom('[data-test-boxel-picker-option-row="select-all"]')
        .exists('"Any Type" option is present in modal');
      assert
        .dom('[data-test-boxel-picker-option-row="select-all"]')
        .containsText('Any Type (', 'select-all shows type count in modal');

      // Options should be constrained by baseFilter (Pet types only)
      // Person should NOT appear as a type option since baseFilter constrains to Pet
      assert
        .dom('[data-test-boxel-picker-option-row="Person"]')
        .doesNotExist(
          'Person type is not available when baseFilter constrains to Pet',
        );
    });
  });

  test(`displays searching results`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    assert.dom(`[data-test-stack-card-header]`).containsText(ctx.realmName);

    await click(`[data-test-open-search-field]`);
    typeIn(`[data-test-search-field]`, 'ma');
    await waitUntil(() =>
      (
        document.querySelector('[data-test-search-label]') as HTMLElement
      )?.innerText.includes('Searching…'),
    );
    assert.dom(`[data-test-search-label]`).containsText('Searching…');
    await settled();

    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
    // New design: realm name is in a section header; multiple realms can appear (Base + test realm)
    assert.dom(`.search-sheet-content`).containsText('Operator Mode Workspace');
    assert
      .dom(`[data-test-search-result="${testRealmURL}Author/mark"]`)
      .exists();

    await click(`[data-test-search-sheet-cancel-button]`);
    await click(`[data-test-open-search-field]`);
    await typeIn(`[data-test-search-field]`, 'Mark J');
    await waitUntil(() =>
      (
        document.querySelector('[data-test-search-label]') as HTMLElement
      )?.innerText.includes('1 result'),
    );
    assert
      .dom(`[data-test-search-label]`)
      .containsText('1 result', 'new design summary text');

    await click(`[data-test-search-sheet-cancel-button]`);
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-label]`).doesNotExist();
    assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();

    await focus(`[data-test-search-field]`);
    typeIn(`[data-test-search-field]`, 'No Cards');
    await waitUntil(() =>
      (
        document.querySelector('[data-test-search-label]') as HTMLElement
      )?.innerText.includes('0 results'),
    );
    assert
      .dom(`[data-test-search-label]`)
      .containsText('0 results', 'new design summary for no results');
    assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();
  });

  test(`can specify a card by URL in the card chooser`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor(`[data-test-card-catalog-item]`);
    await fillIn(
      `[data-test-search-field]`,
      `@cardstack/base/types/card`,
    );

    await waitFor('[data-test-card-catalog-item]', {
      count: 1,
    });

    assert
      .dom(`[data-test-realm="Base Workspace"] [data-test-results-count]`)
      .hasText('1 result');

    assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });
    await click('[data-test-card-catalog-item]');

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
        <template><OperatorMode @onClose={{noop}} /></template>
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

    await click(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
    );
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
        <template><OperatorMode @onClose={{noop}} /></template>
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
    assert
      .dom(`[data-test-card-catalog-item="${testRealmURL}Author/1"]`)
      .exists();
  });

  test(`displays no cards available message if search result does not exist`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await fillIn(`[data-test-search-field]`, `friend`);
    await waitFor('[data-test-card-catalog-item]', { count: 0 });
    assert
      .dom(`[data-test-search-content-empty]`)
      .hasText('No cards available');
  });

  test(`can filter by realm after searching in card catalog`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
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
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item="${testRealmURL}Spec/pet-room"]`,
      )
      .exists();

    assert
      .dom(
        `[data-test-realm="Base Workspace"] [data-test-card-catalog-item="${baseRealm.url}types/card"]`,
      )
      .exists();

    // Open realm picker and select only Operator Mode Workspace
    await click('[data-test-realm-picker] [data-test-boxel-picker-trigger]');
    await click(`[data-test-boxel-picker-option-row="${testRealmURL}"]`);

    assert.dom(`[data-test-realm]`).exists({ count: 1 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert
      .dom(`[data-test-card-catalog-item="${testRealmURL}Spec/pet-room"]`)
      .exists();

    // Switch to All Realms by clicking All Realms option
    await click('[data-test-boxel-picker-option-row="select-all"]');

    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').exists();
    assert
      .dom(`[data-test-card-catalog-item="${testRealmURL}Spec/pet-room"]`)
      .exists();
  });

  test(`can open new card editor in the stack after searching in card catalog`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
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

    await click(`[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"]`);
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
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);

    await typeIn(`[data-test-search-field]`, `pet`);
    assert.dom(`[data-test-search-field]`).hasValue('pet');
    await waitFor('[data-test-card-catalog-item]', { count: 2 });
    await click(`[data-test-card-catalog-item="${testRealmURL}Spec/pet-room"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/pet-room"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog-modal]', { count: 0 });

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
        <template><OperatorMode @onClose={{noop}} /></template>
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

    await click(`[data-test-card-catalog-item="${testRealmURL}Author/1"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/1"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog-modal]', { count: 0 });

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
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await click('[data-test-open-search-field]');
    await fillIn('[data-test-search-field]', `${testRealmURL}Pet/man`);
    await waitFor(`[data-test-search-label]`);

    // New design: summary shows "0 results"; empty state body shows "No card found at ..."
    assert.dom('[data-test-search-label]').containsText('0 results');
    assert
      .dom('[data-test-search-sheet-empty]')
      .containsText(`No card found at ${testRealmURL}Pet/man`);
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();

    await fillIn('[data-test-search-field]', `${testRealmURL}Pet/mango`);
    await waitFor('[data-test-search-sheet-search-result]');

    assert
      .dom('[data-test-search-label]')
      .containsText('1 result from 1 realm');
    assert.dom('[data-test-search-sheet-search-result]').exists({ count: 1 });

    await fillIn('[data-test-search-field]', `${testRealmURL}Pet/man`);

    assert.dom('[data-test-search-label]').containsText('0 results');
    assert
      .dom('[data-test-search-sheet-empty]')
      .containsText(`No card found at ${testRealmURL}Pet/man`);
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();

    await fillIn('[data-test-search-field]', `${testRealmURL}Pet/mango`);
    await waitFor('[data-test-search-sheet-search-result]');

    await click('[data-test-search-sheet-search-result]');

    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/mango"]`);
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field-component-card]`,
      )
      .containsText('Mango', 'the card is rendered in the stack');
  });

  test(`search results are grouped by realm with section headers`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    await fillIn(`[data-test-search-field]`, 'ma');
    assert.dom(`[data-test-search-sheet-section-header]`).exists();
    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
    assert
      .dom(`[data-test-search-result="${testRealmURL}Author/mark"]`)
      .exists();
    assert.dom(`.search-sheet-content`).containsText('Operator Mode Workspace');
  });

  test(`Show more button reveals more cards when search has many results`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    // Use a query that returns multiple results in one realm (ma -> Pet/mango, Author/mark, etc.)
    await fillIn(`[data-test-search-field]`, 'ma');
    await waitFor('[data-test-search-sheet-search-result]');
    const initialCount = document.querySelectorAll(
      '[data-test-search-sheet-search-result]',
    ).length;
    assert.ok(initialCount >= 1, 'at least one query result shown');
    const showMoreButton = document.querySelector(
      '[data-test-search-sheet-show-more]',
    );
    if (showMoreButton) {
      await click('[data-test-search-sheet-show-more]');
      const afterCount = document.querySelectorAll(
        '[data-test-search-sheet-search-result]',
      ).length;
      assert.ok(
        afterCount > initialCount,
        'Show more reveals additional cards',
      );
    } else {
      assert.ok(true, 'Show more not shown when results fit in initial limit');
    }
  });

  test(`empty state shows when URL has no card`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/nonexistent',
    );
    await waitFor(`[data-test-search-label]`);
    assert.dom('[data-test-search-sheet-empty]').exists();
    assert
      .dom('[data-test-search-sheet-empty]')
      .containsText('No card found at');
  });

  test(`SearchResultHeader is hidden in compact (prompt) mode`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();
    assert
      .dom('[data-test-search-result-header]')
      .doesNotExist('header is not shown in compact prompt mode');
  });

  test(`compact mode shows no full header and recents remain clickable`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);
    await click(`[data-test-open-search-field]`);
    assert.dom('[data-test-search-result-header]').doesNotExist();
    await waitFor('[data-test-search-result]', { timeout: 3000 });
    await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .exists('clicking a recent in compact mode adds card to stack');
  });

  test(`Show only focuses a section and collapses others`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    await fillIn(`[data-test-search-field]`, 'ma');
    await waitFor('[data-test-search-sheet-show-only]');
    await percySnapshot(assert);
    await click('[data-test-search-sheet-show-only]');
    const collapsedBlocks = document.querySelectorAll(
      '.search-result-block--collapsed',
    );
    assert.ok(
      collapsedBlocks.length >= 1,
      'at least one section is collapsed when Show only is checked',
    );
  });

  test(`Show only reorders focused section to top and scrolls back on uncheck`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    await fillIn(`[data-test-search-field]`, 'ma');
    await waitFor('[data-test-search-sheet-show-only]');

    let sections = document.querySelectorAll('[data-section-sid]');
    assert.ok(sections.length >= 1, 'at least one section is rendered');

    let showOnlyCheckbox = document.querySelector(
      '[data-test-search-sheet-show-only]',
    ) as HTMLInputElement;
    let focusedSection = showOnlyCheckbox.closest(
      '[data-section-sid]',
    ) as HTMLElement;
    assert.ok(
      focusedSection,
      'found the section containing the show-only checkbox',
    );
    const focusedSectionSid = focusedSection.getAttribute('data-section-sid');
    assert.ok(focusedSectionSid, 'focused section has a section sid');

    let scrollContainer = document.querySelector(
      '.search-sheet-content',
    ) as HTMLElement;

    // Force a non-zero scrollTop so the post-click scrollTop === 0 assertion
    // validates an actual scroll change rather than passing vacuously.
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    assert.ok(
      scrollContainer.scrollTop > 0,
      `scrollTop is non-zero before checking Show only (scrollTop: ${scrollContainer.scrollTop})`,
    );

    // Check "show only" — focused section should move to top
    await click('[data-test-search-sheet-show-only]');
    // The modifier defers scrollTop = 0 via requestAnimationFrame, so wait
    // one frame for the scroll adjustment to complete.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    let firstSection = scrollContainer.querySelector(
      '[data-section-sid]',
    ) as HTMLElement;
    assert.strictEqual(
      firstSection?.getAttribute('data-section-sid'),
      focusedSectionSid,
      'focused section is the first section in the container after checking Show only',
    );
    assert.strictEqual(
      scrollContainer.scrollTop,
      0,
      'scroll container is scrolled to top after checking Show only',
    );

    // Uncheck "show only" — the previously focused section should be visible
    await click('[data-test-search-sheet-show-only]');
    // The modifier defers scrollIntoView via requestAnimationFrame, so wait
    // one frame for the scroll adjustment to complete before reading rects.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    let restoredSection = scrollContainer.querySelector(
      `[data-section-sid="${focusedSectionSid}"]`,
    ) as HTMLElement;
    assert.ok(
      restoredSection,
      'previously focused section is still in the DOM',
    );

    let containerRect = scrollContainer.getBoundingClientRect();
    let sectionRect = restoredSection.getBoundingClientRect();
    assert.ok(
      sectionRect.top >= containerRect.top - 1,
      `previously focused section top is at or below container top after unchecking Show only (sectionTop: ${sectionRect.top}, containerTop: ${containerRect.top})`,
    );
    assert.ok(
      sectionRect.top < containerRect.bottom,
      `previously focused section top is above container bottom after unchecking Show only (sectionTop: ${sectionRect.top}, containerBottom: ${containerRect.bottom})`,
    );
  });

  test(`view toggle updates layout (grid vs strip)`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-open-search-field]`);
    await fillIn(`[data-test-search-field]`, 'ma');
    await waitFor('[data-test-search-result-section]');

    assert.dom('[data-test-search-result-header]').exists();
    assert
      .dom(
        '[data-test-search-result-section="0"] [data-test-search-cards-result]',
      )
      .hasClass('grid-view');
    await click(
      '[data-test-search-result-header] [data-test-boxel-radio-option-id="strip"]',
    );
    assert
      .dom(
        '[data-test-search-result-section="0"] [data-test-search-cards-result]',
      )
      .hasClass('strip-view');
  });

  test(`can select one or more cards on cards-grid and unselect`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
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
        <template><OperatorMode @onClose={{noop}} /></template>
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
        <template><OperatorMode @onClose={{noop}} /></template>
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
        <template><OperatorMode @onClose={{noop}} /></template>
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
      '[data-test-card-catalog-item="@cardstack/base/cards/skill"]',
    );
    await click('[data-test-card-catalog-go-button]');

    await fillIn('[data-test-field="cardTitle"] input', 'New Skill');
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

  test('selection-dropdown-trigger is visible in multi-select mode and hidden in single-select mode', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/hassan`, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/hassan"]`);

    // Open single-select linksTo chooser for 'pet' field
    await waitFor(`[data-test-add-new="pet"]`);
    await click(`[data-test-add-new="pet"]`);
    await waitFor('[data-test-card-catalog-modal]');

    assert
      .dom('[data-test-selection-dropdown-trigger]')
      .doesNotExist('selection dropdown is hidden in single-select mode');

    // Close and open multi-select linksToMany chooser for 'friends' field
    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog-modal]', { count: 0 });

    await click(`[data-test-add-new="friends"]`);
    await waitFor('[data-test-card-catalog-modal]');

    assert
      .dom('[data-test-selection-dropdown-trigger]')
      .exists('selection dropdown is visible in multi-select mode');
  });
});
