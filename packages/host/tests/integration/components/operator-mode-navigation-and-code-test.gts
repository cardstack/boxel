import {
  blur,
  click,
  fillIn,
  triggerEvent,
  triggerKeyEvent,
  typeIn,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { percySnapshot, testRealmURL } from '../../helpers';
import setupOperatorModeTest from '../../helpers/operator-mode-test-setup';
import { renderComponent } from '../../helpers/render-component';

module(
  'Integration | operator-mode | navigation and code mode',
  function (hooks) {
    let { noop, operatorModeStateService, setCardInOperatorModeState } =
      setupOperatorModeTest(hooks);

    test(`can select one or more cards on cards-grid and unselect`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
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

    test('displays realm name in tooltip when hovering realm icon', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );

      await waitFor('[data-test-card-header-realm-icon]');
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
      setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor('[data-test-more-options-button]');
      await click('[data-test-more-options-button]');
      await click('[data-test-boxel-menu-item-text="Copy Card URL"]');
      assert.dom('[data-test-boxel-menu-item]').doesNotExist();
    });

    test(`click on "links to" the embedded card will open it on the stack`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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

      await click(
        '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
      );
      await waitFor('[data-test-boxel-menu-item-text]');
      await click('[data-test-boxel-menu-item-text="Interact"]');
      await waitFor('[data-test-submode-switcher]');
      assert.dom('[data-test-submode-switcher]').hasText('Interact');
    });

    test(`card url bar shows realm info of valid URL`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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
    });

    test(`card url bar shows error message when URL is invalid`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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

      await click('[data-test-dismiss-url-error-button]');
      assert.dom('[data-test-card-url-bar-error]').doesNotExist();
    });

    test(`card url bar URL reacts to external changes of code path when user is not editing`, async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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

      await operatorModeStateService.updateCodePath(
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
      setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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

      await operatorModeStateService.updateCodePath(
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
      setCardInOperatorModeState(`${testRealmURL}grid`);
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

    test('displays card in interact mode when clicking `Open in Interact Mode` menu in preview panel', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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
  },
);
