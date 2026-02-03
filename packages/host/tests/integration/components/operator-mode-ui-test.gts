import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  typeIn,
  triggerEvent,
  triggerKeyEvent,
  blur,
  settled,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { percySnapshot, testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | operator-mode | ui', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};

  test('displays realm name in tooltip when hovering realm icon', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-boxel-card-header-title]', { timeout: 10000 });
    await waitFor(
      `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
      { timeout: 10000 },
    );
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
    assert
      .dom(
        `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
      )
      .exists();
    await triggerEvent(`[data-test-card-header-realm-icon]`, 'mouseenter');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText('In Operator Mode Workspace');
    await triggerEvent(`[data-test-card-header-realm-icon]`, 'mouseleave');
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
  });

  test(`it has an option to copy the card url`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-more-options-button]');
    await click('[data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Copy Card URL"]');
    assert.dom('[data-test-boxel-menu-item]').doesNotExist();
  });

  test(`click on "links to" the embedded card will open it on the stack`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await click('[data-test-author]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert.dom('[data-test-stack-card-index]').exists({ count: 2 });
    assert
      .dom(
        '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
      )
      .includesText('Author');
  });

  test(`toggles mode switcher`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click('[data-test-submode-switcher] > [data-test-boxel-button]');

    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    assert.dom('[data-test-submode-arrow-direction="down"]').exists();

    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Interact');
    assert.dom('[data-test-submode-arrow-direction="down"]').exists();
  });

  test(`card url bar shows realm info of valid URL`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert.dom('[data-test-card-url-bar]').exists();
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await blur('[data-test-card-url-bar-input]');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
  });

  test(`card url bar shows error message when URL is invalid`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-submode-switcher]');
    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    assert.dom('[data-test-card-url-bar]').exists();
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('This resource does not exist');

    await percySnapshot(assert);

    await fillIn('[data-test-card-url-bar-input]', `Wrong URL`);
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('Not a valid URL');
  });

  test('user can dismiss url bar error message', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').exists();

    await click('[data-test-dismiss-url-error-button]');
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard_2`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').exists();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
  });

  test(`card url bar URL reacts to external changes of code path when user is not editing`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await waitFor('[data-test-boxel-menu-item-text]');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await ctx.operatorModeStateService.updateCodePath(
      new URL(`${testRealmURL}person.gts`),
    );

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);
  });

  test(`card url bar URL does not react to external changes when user is editing`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    let someRandomText = 'I am still typing a url';
    await typeIn('[data-test-card-url-bar-input]', someRandomText);

    await ctx.operatorModeStateService.updateCodePath(
      new URL(`${testRealmURL}person.gts`),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json${someRandomText}`);

    blur('[data-test-card-url-bar-input]');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json${someRandomText}`);
  });

  test(`can open and close search sheet`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await click(`[data-test-search-sheet] .search-sheet-content`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await typeIn(`[data-test-search-field]`, 'A');
    await click(`[data-test-search-sheet] .search-sheet-content .section`);
    assert.dom(`[data-test-search-sheet="search-results"]`).exists();

    await click(`[data-test-search-sheet] .search-sheet-content .section`);
    assert.dom(`[data-test-search-sheet="search-results"]`).exists();

    await click(`[data-test-operator-mode-stack]`);
    assert.dom(`[data-test-search-sheet="closed"]`).exists();
  });

  test('search sheet shows realm picker when expanded and filters by selected realm', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();
    assert.dom('[data-test-search-sheet-search-bar]').exists();
    assert.dom('[data-test-realm-picker]').exists();

    // Type a search term to trigger search results; search receives realms from the picker
    await typeIn('[data-test-search-field]', 'Person');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await waitFor('[data-test-search-realms]', { timeout: 3000 });

    // Assert the search is using a realms list that includes the test realm (filter is connected)
    const realmsAttr = document
      .querySelector('[data-test-search-realms]')
      ?.getAttribute('data-test-search-realms');
    assert.ok(
      realmsAttr,
      'search should receive realms (data-test-search-realms)',
    );
    const realmsList = realmsAttr?.split(',').map((r) => r.trim()) ?? [];
    assert.ok(
      realmsList.some((r) => r.includes('test-realm') && r.includes('/test')),
      'realms list should include the test realm',
    );

    // When only one realm is available, "All Realms" and selecting that realm both yield one realm
    const alreadySingleRealm = realmsList.length === 1;
    if (!alreadySingleRealm) {
      // Multiple realms: open picker and select only the test realm to verify filter updates
      const trigger =
        document.querySelector(
          '[data-test-realm-picker] .ember-power-select-trigger',
        ) ?? document.querySelector('[data-test-realm-picker]');
      assert.ok(trigger, 'realm picker trigger should exist');
      await click(trigger as HTMLElement);
      await waitFor('.ember-power-select-option', { timeout: 3000 });
      const options = document.querySelectorAll('.ember-power-select-option');
      const allRealmsOption = Array.from(options).find((el) =>
        el.textContent?.includes('All Realms'),
      );
      if (allRealmsOption?.getAttribute('aria-selected') === 'true') {
        await click(allRealmsOption as HTMLElement);
      }
      const testRealmOption = Array.from(options).find((el) =>
        el.textContent?.includes(ctx.realmName),
      );
      assert.ok(
        testRealmOption,
        `option for "${ctx.realmName}" should exist`,
      );
      await click(testRealmOption as HTMLElement);
      await settled();
      await waitUntil(
        () => {
          const attr = document
            .querySelector('[data-test-search-realms]')
            ?.getAttribute('data-test-search-realms');
          if (!attr) return false;
          const list = attr.split(',').map((r) => r.trim());
          return list.length === 1 && list[0].includes('test-realm');
        },
        { timeout: 5000 },
      );
    }

    const finalAttr = document
      .querySelector('[data-test-search-realms]')
      ?.getAttribute('data-test-search-realms');
    const finalRealms = finalAttr?.split(',').map((r) => r.trim()) ?? [];
    assert.ok(
      finalRealms.length >= 1,
      'search should be scoped to at least one realm',
    );
    assert.ok(
      finalRealms.some(
        (r) => r.includes('test-realm') && r.includes('/test'),
      ),
      'realms should include the test realm (filter is applied)',
    );
  });

  test('displays card in interact mode when clicking `Open in Interact Mode` menu in preview panel', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click(
      `[data-test-stack-card="${testRealmURL}BlogPost/1"] [data-test-edit-button]`,
    );

    await click(
      `[data-test-links-to-editor="authorBio"] [data-test-author="Alien"]`,
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}Author/1"]`);

    assert.dom(`[data-test-stack-card]`).exists({ count: 3 });
    assert.dom(`[data-test-stack-card="${testRealmURL}grid"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Author/1"]`).exists();

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await blur('[data-test-card-url-bar-input]');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    await click(`[data-test-more-options-button]`);
    await click(`[data-test-boxel-menu-item-text="Open in Interact Mode"]`);

    await waitFor(`[data-test-stack-card]`);
    assert.dom(`[data-test-stack-card]`).exists({ count: 2 });
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Pet/mango"]`).exists();
  });

  test('edit card and finish editing should not animate', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click(
      `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-edit-button]`,
    );
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotHaveClass('opening-animation');

    await click('[data-test-edit-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotHaveClass('opening-animation');
  });

  test('close card should not trigger opening animation again', async function (assert) {
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
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);

    await waitFor(`[data-test-stack-card-index="0"]`);
    assert
      .dom(`[data-test-stack-card-index="0"]`)
      .doesNotHaveClass('opening-animation');
  });

  test('stack item with custom header color does not lose the color when opening other cards in the stack', async function (assert) {
    const cardId = `${testRealmURL}PublishingPacket/story`;
    const customStyle = {
      backgroundColor: 'rgb(102, 56, 255)',
      color: 'rgb(255, 255, 255)',
    };
    ctx.setCardInOperatorModeState(cardId);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    assert.dom(`[data-test-stack-card="${cardId}"]`).exists();
    assert
      .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
      .hasStyle(customStyle);

    await click(`[data-test-card="${testRealmURL}BlogPost/1"]`);
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`).exists();
    assert
      .dom(
        `[data-stack-card="${testRealmURL}BlogPost/1"] [data-test-card-header]`,
      )
      .hasStyle({
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(0, 0, 0)',
      });
    assert
      .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
      .hasStyle(customStyle);

    await click(
      `[data-stack-card="${testRealmURL}BlogPost/1"] [data-test-close-button]`,
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`, {
      count: 0,
    });
    assert
      .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
      .hasStyle(customStyle);
  });
});
