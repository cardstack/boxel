import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  settled,
  typeIn,
  triggerEvent,
  triggerKeyEvent,
  blur,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
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

  test(`click on "links to" the embedded file will open it on the stack`, async function (assert) {
    let linkedFileId = `${testRealmURL}FileLinkCard/notes.txt`;

    await ctx.testRealm.write(
      'file-link-card.gts',
      `
        import { CardDef, Component, field, contains, linksTo, StringField } from 'https://cardstack.com/base/card-api';
        import { FileDef } from 'https://cardstack.com/base/file-api';

        export class FileLinkCard extends CardDef {
          static displayName = 'File Link Card';
          @field title = contains(StringField);
          @field attachment = linksTo(FileDef);

          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h2 data-test-file-link-card-title><@fields.title /></h2>
              <div data-test-file-link-attachment>
                <@fields.attachment />
              </div>
            </template>
          };
        }
      `,
    );

    await ctx.testRealm.write(
      'FileLinkCard/notes.txt',
      'Hello from a file link',
    );
    await ctx.testRealm.write(
      'FileLinkCard/with-file.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Linked file example',
          },
          relationships: {
            attachment: {
              links: {
                self: './notes.txt',
              },
              data: {
                type: 'file-meta',
                id: './notes.txt',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../file-link-card',
              name: 'FileLinkCard',
            },
          },
        },
      }),
    );

    ctx.setCardInOperatorModeState(`${testRealmURL}FileLinkCard/with-file`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-file-link-attachment] [data-test-card]');
    await click('[data-test-file-link-attachment] [data-test-card]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert.dom('[data-test-stack-card-index]').exists({ count: 2 });
    assert
      .dom(`[data-test-stack-card="${linkedFileId}"]`)
      .exists('linked file opens as a second stack card');
    assert.strictEqual(
      ctx.operatorModeStateService.state?.stacks?.[0]?.[1]?.id,
      linkedFileId,
      'operator mode state targets the linked file',
    );
    assert.strictEqual(
      ctx.operatorModeStateService.state?.stacks?.[0]?.[1]?.type,
      'file',
      'stack item type is file',
    );
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
    await waitFor('[data-test-search-sheet="search-results"]', {
      timeout: 8000,
    });
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
    // Realm picker trigger should show shortLabel "All" for select-all
    assert
      .dom('[data-test-realm-picker] [data-test-boxel-picker-selected-item]')
      .hasText(
        'All',
        'realm picker shows shortLabel "All" when select-all is active',
      );

    // Type a search term to trigger search results
    await typeIn('[data-test-search-field]', 'Person');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await waitFor('[data-test-search-realms]', { timeout: 3000 });

    // Helper function to get current selected realms
    const getSelectedRealms = () => {
      const attr = document
        .querySelector('[data-test-search-realms]')
        ?.getAttribute('data-test-search-realms');
      return attr?.split(',').map((r) => r.trim()) ?? [];
    };

    // Verify initial realm filtering includes test realm
    let selectedRealms = getSelectedRealms();
    assert.ok(
      selectedRealms.some(
        (r) => r.includes('test-realm') && r.includes('/test'),
      ),
      'search should initially include the test realm',
    );

    // Select only the test realm in the picker to verify filter updates
    const trigger =
      document.querySelector(
        '[data-test-realm-picker] .ember-power-select-trigger',
      ) ?? document.querySelector('[data-test-realm-picker]');
    await click(trigger as HTMLElement);
    await waitFor('.ember-power-select-option', { timeout: 3000 });

    // Realm select-all option should show count
    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .containsText('Select All (', 'realm select-all shows count');

    const options = document.querySelectorAll('.ember-power-select-option');
    const testRealmOption = Array.from(options).find((el) =>
      el.textContent?.includes(ctx.realmName),
    );
    assert.ok(testRealmOption, `option for "${ctx.realmName}" should exist`);
    await click(testRealmOption as HTMLElement);

    // Verify the filter was applied
    await waitUntil(() => getSelectedRealms().includes(testRealmURL), {
      timeout: 5000,
    });
    selectedRealms = getSelectedRealms();
    assert.ok(
      selectedRealms.some(
        (r) => r.includes('test-realm') && r.includes('/test'),
      ),
      'search should be filtered to the test realm after selection',
    );
  });

  test('clicking outside search sheet resets search input and realm filter', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Helper to get selected realm URLs from data attribute
    const getSelectedRealms = () => {
      const attr = document
        .querySelector('[data-test-search-realms]')
        ?.getAttribute('data-test-search-realms');
      return attr?.split(',').map((r) => r.trim()) ?? [];
    };

    // Open search sheet and type a search term
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await typeIn('[data-test-search-field]', 'Person');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await waitFor('[data-test-search-realms]', { timeout: 3000 });

    // Record initial realm state (all realms selected by default)
    let initialRealms = getSelectedRealms();

    // Select a specific realm in the picker
    const trigger =
      document.querySelector(
        '[data-test-realm-picker] .ember-power-select-trigger',
      ) ?? document.querySelector('[data-test-realm-picker]');
    await click(trigger as HTMLElement);
    await waitFor('.ember-power-select-option', { timeout: 3000 });

    const options = document.querySelectorAll('.ember-power-select-option');
    const testRealmOption = Array.from(options).find((el) =>
      el.textContent?.includes(ctx.realmName),
    );
    assert.ok(testRealmOption, `option for "${ctx.realmName}" should exist`);
    await click(testRealmOption as HTMLElement);

    // Verify filter was applied (only selected realm)
    await waitUntil(() => getSelectedRealms().includes(testRealmURL), {
      timeout: 5000,
    });

    // Close by clicking outside
    await click(`[data-test-operator-mode-stack]`);
    assert.dom(`[data-test-search-sheet="closed"]`).exists();

    // Reopen search sheet
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    // Assert search input is cleared
    assert
      .dom('[data-test-search-field]')
      .hasValue('', 'search input is cleared after clicking outside');

    // Assert realm filter is reset to all realms
    await waitFor('[data-test-search-realms]', { timeout: 3000 });
    let reopenedRealms = getSelectedRealms();
    assert.deepEqual(
      reopenedRealms,
      initialRealms,
      'realm filter is reset to all realms after clicking outside',
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

  test('search sheet shows type picker in the search bar', async function (assert) {
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
    assert
      .dom('[data-test-type-picker]')
      .exists('type picker is shown in search bar');
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-trigger-label]')
      .hasText('Type', 'type picker label is "Type"');
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
      .hasText(
        'Any',
        'type picker shows shortLabel "Any" when select-all is active',
      );
  });

  test('type picker options reflect card types in search results', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Open search sheet and search for a term that matches 'Pet' cards
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'Mango');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    // Allow type options to propagate from search results to the picker
    await settled();

    // The type picker should now have "Pet" as an option (Pet/mango card matched)
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .exists('"Any" option is present');
    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .containsText('Any Type (', 'select-all option shows count');

    // Verify at least one non-select-all type option is shown
    const typeOptions = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
    );
    assert.ok(
      typeOptions.length > 0,
      'at least one card type option appears based on search results',
    );
  });

  test('clicking outside search sheet resets type filter selection', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Open search and get results to populate type options
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'Mango');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Select a type option in the picker
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    const typeOptions = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
    );

    if (typeOptions.length > 0) {
      await click(typeOptions[0] as HTMLElement);

      // Confirm a type is selected (selected items shown in trigger)
      assert
        .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
        .exists('a type is selected in the picker');
    }

    // Close search sheet by clicking outside
    await click(`[data-test-operator-mode-stack]`);
    assert.dom(`[data-test-search-sheet="closed"]`).exists();

    // Reopen search sheet
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    // Type filter should be reset — "Any" (select-all) is the only active selection.
    // The Picker auto-selects the select-all option when @selected is empty, but
    // select-all items never render a remove button, so its absence confirms no
    // specific type filter is active.
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-remove-button]')
      .doesNotExist(
        'specific type filter is cleared after closing the search sheet',
      );
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
      .hasText(
        'Any',
        'type picker shows shortLabel "Any" after reset to select-all',
      );
  });

  test('type options derived from realm types when no search term, sorted alphabetically', async function (assert) {
    let recentCardsService = getService('recent-cards-service');
    recentCardsService.add(`${testRealmURL}Pet/mango`);
    recentCardsService.add(`${testRealmURL}Person/fadhlan`);
    recentCardsService.add(`${testRealmURL}BlogPost/1`);

    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Open search sheet (no search term)
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();
    await settled();

    // Open type picker dropdown
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');
    // Wait for all pages to load via infinite scroll
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');

    // "Any Type" (select-all) should be present with count
    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .exists('"Any Type" option is present');
    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .containsText(
        'Any Type (13)',
        'select-all shows count of all realm types',
      );

    // Type options should include types from the realm
    assert
      .dom('[data-test-boxel-picker-option-label="Blog Post"]')
      .exists('Blog Post type option present from realm types');
    assert
      .dom('[data-test-boxel-picker-option-label="Person"]')
      .exists('Person type option present from realm types');
    assert
      .dom('[data-test-boxel-picker-option-label="Pet"]')
      .exists('Pet type option present from realm types');

    // Verify alphabetical order by label
    const optionRows = [
      ...document.querySelectorAll(
        '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
      ),
    ];
    const optionLabels = optionRows.map(
      (row) => row.getAttribute('data-test-boxel-picker-option-label') ?? '',
    );
    const sorted = [...optionLabels].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      optionLabels,
      sorted,
      'type options are sorted alphabetically',
    );
  });

  test('type options show all realm types even without recent cards', async function (assert) {
    // Do NOT add any recent cards — types still come from the realm
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Open search sheet (no search term, no recent cards)
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();
    await settled();

    // Open type picker dropdown
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');
    // Wait until the "Pet" type option is visible
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');

    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .exists('"Any Type" option is present');
    assert
      .dom('[data-test-boxel-picker-option-row="select-all"]')
      .containsText(
        'Any Type (13)',
        'select-all shows count of all realm types',
      );

    const nonSelectAllOptions = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
    );
    assert.strictEqual(
      nonSelectAllOptions.length,
      13,
      'all realm types are shown even without recent cards',
    );
  });

  test('selecting a specific type filters search results and recent cards', async function (assert) {
    let recentCardsService = getService('recent-cards-service');
    recentCardsService.add(`${testRealmURL}Pet/mango`);
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

    // Open search sheet and search for a broad term
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'Mango');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Open type picker and select 'Pet'
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');
    await click('[data-test-boxel-picker-option-label="Pet"]');

    // Verify selected chip shows 'Pet'
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
      .exists('Pet type is selected');

    // Search results should only show Pet cards
    assert
      .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
      .exists('Pet/mango is visible in search results');

    // Recent cards should only show Pet cards
    assert
      .dom(`[data-test-recent-card-result="${testRealmURL}Person/fadhlan"]`)
      .doesNotExist(
        'Person/fadhlan is hidden from recent cards when Pet type is selected',
      );
  });

  test('multi-type selection shows cards of all selected types, deselect-all reverts', async function (assert) {
    let recentCardsService = getService('recent-cards-service');
    recentCardsService.add(`${testRealmURL}Pet/mango`);
    recentCardsService.add(`${testRealmURL}Person/fadhlan`);
    recentCardsService.add(`${testRealmURL}BlogPost/1`);

    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Open search and search for broad term to get multiple types
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'a');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Open type picker and select 'Pet', then 'Person'
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');
    await click('[data-test-boxel-picker-option-label="Pet"]');
    await waitFor('[data-test-boxel-picker-option-row]');
    await click('[data-test-boxel-picker-option-label="Person"]');

    // Both Pet and Person recent cards should be visible
    assert
      .dom(`[data-test-recent-card-result="${testRealmURL}Pet/mango"]`)
      .exists('Pet/mango is visible with multi-type selection');
    assert
      .dom(`[data-test-recent-card-result="${testRealmURL}Person/fadhlan"]`)
      .exists('Person/fadhlan is visible with multi-type selection');
    // BlogPost should be hidden
    assert
      .dom(`[data-test-recent-card-result="${testRealmURL}BlogPost/1"]`)
      .doesNotExist(
        'BlogPost/1 is hidden when only Pet and Person types selected',
      );

    // Deselect all specific types by clicking remove buttons
    while (
      document.querySelector(
        '[data-test-type-picker] [data-test-boxel-picker-remove-button]',
      )
    ) {
      await click(
        '[data-test-type-picker] [data-test-boxel-picker-remove-button]',
      );
    }

    // Should revert to "Any Type" — all cards visible, no remove buttons
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-remove-button]')
      .doesNotExist('no specific type selections remain after deselecting all');
    assert
      .dom(`[data-test-recent-card-result="${testRealmURL}BlogPost/1"]`)
      .exists('BlogPost/1 is visible again after reverting to Any Type');
  });

  test('type selection persists when search term changes if type still available', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Search for 'Mango' to get Pet results
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'Mango');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Select 'Pet' type
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');
    await click('[data-test-boxel-picker-option-label="Pet"]');

    // Verify 'Pet' is selected
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
      .exists('Pet type is selected');

    // Change search to 'Ma' — still matches Mango (Pet)
    await fillIn('[data-test-search-field]', '');
    await typeIn('[data-test-search-field]', 'Ma');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Pet selection should persist since Pet type is still in options
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
      .exists('Pet type selection persists after search change');

    // Now change search to something that won't match Pet results
    await fillIn('[data-test-search-field]', '');
    await typeIn('[data-test-search-field]', 'Fadhlan');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Pet selection should persist — type options come from the realm,
    // not search results, so they don't change with search term
    assert
      .dom('[data-test-type-picker] [data-test-boxel-picker-selected-item]')
      .exists(
        'type selection persists since type options are realm-level, not search-dependent',
      );
  });

  test('type filter works with search term together', async function (assert) {
    let recentCardsService = getService('recent-cards-service');
    recentCardsService.add(`${testRealmURL}Pet/mango`);
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

    // Search for 'a' — broad term matching multiple card types
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'a');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Verify both realm picker and type picker are present
    assert.dom('[data-test-realm-picker]').exists('realm picker is accessible');
    assert.dom('[data-test-type-picker]').exists('type picker is accessible');

    // Select 'Pet' type
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');
    await click('[data-test-boxel-picker-option-label="Pet"]');

    // Only Pet cards should be visible in search results
    assert
      .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
      .exists('Pet/mango visible when Pet type selected with search term');

    // Person results should be hidden
    assert
      .dom(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`)
      .doesNotExist(
        'Person/fadhlan hidden in search results when Pet type selected',
      );
  });

  test('type options show icons in the picker', async function (assert) {
    let recentCardsService = getService('recent-cards-service');
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

    // Search for 'Mango' to get Pet results with icons from search
    await click(`[data-test-open-search-field]`);
    await typeIn('[data-test-search-field]', 'Mango');
    await click('[data-test-search-sheet] .search-sheet-content');
    await waitFor('[data-test-search-label]', { timeout: 8000 });
    await settled();

    // Open type picker
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Verify at least one option row has an icon element
    const iconElements = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"]) .picker-option-row__icon',
    );
    assert.ok(
      iconElements.length > 0,
      'at least one type option shows an icon',
    );
  });

  test('clearing type picker search restores all types and preserves selection', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    // Open search sheet
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();
    await settled();

    // Open type picker and wait for options to load
    await click('[data-test-type-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');
    await waitFor('[data-test-boxel-picker-option-label="Pet"]');

    // Count initial options
    let initialOptionCount = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
    ).length;
    assert.ok(
      initialOptionCount > 1,
      'multiple type options are shown initially',
    );

    // Search for a specific type in the type picker search
    await fillIn('[data-test-boxel-picker-search] input', 'Pet');

    // Filtered results should show fewer options
    let filteredOptionCount = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
    ).length;
    assert.ok(
      filteredOptionCount <= initialOptionCount,
      'search filters the type options',
    );

    // Select Pet
    await click('[data-test-boxel-picker-option-label="Pet"]');

    // Clear the type picker search
    await fillIn('[data-test-boxel-picker-search] input', '');

    // All types should be restored
    await waitFor('[data-test-boxel-picker-option-label="Person"]');
    let restoredOptionCount = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]:not([data-test-boxel-picker-option-row="select-all"])',
    ).length;
    assert.strictEqual(
      restoredOptionCount,
      initialOptionCount,
      'all type options are restored after clearing search',
    );

    // Pet should still be selected (checked)
    assert
      .dom(
        '[data-test-type-picker] [data-test-boxel-picker-selected-item="Pet"]',
      )
      .exists('Pet selection is preserved after clearing search');
  });
});
