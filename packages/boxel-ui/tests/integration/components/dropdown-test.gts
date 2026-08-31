import {
  type BoxelDropdownAPI,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import {
  click,
  focus,
  render,
  settled,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

module('Integration | Component | dropdown', function (hooks) {
  setupRenderingTest(hooks);

  test('dropdown auto-close behavior: auto-close when enabled, stays open when disabled', async function (assert) {
    const menuOptions = [
      new MenuItem({ label: 'Option 1', action: () => {} }),
      new MenuItem({ label: 'Option 2', action: () => {} }),
      new MenuItem({ label: 'Option 3', action: () => {} }),
    ];

    // Scenario 1
    // Test with autoClose enabled
    await render(
      <template>
        <BoxelDropdown @autoClose={{true}}>
          <:trigger as |dd|>
            <button data-test-dropdown-trigger-1 {{dd}}>Open</button>
          </:trigger>
          <:content as |dd|>
            <div
              data-test-boxel-dropdown-content-1
              class='boxel-dropdown__content'
            >
              <BoxelMenu @closeMenu={{dd.close}} @items={{menuOptions}} />
            </div>
          </:content>
        </BoxelDropdown>
      </template>,
    );

    await click('[data-test-dropdown-trigger-1]');
    await waitFor('[data-test-boxel-dropdown-content-1]');

    // Test mouse leave - should close
    await triggerEvent('[data-test-boxel-dropdown-content-1]', 'mouseleave');

    await waitFor('[data-test-boxel-dropdown-content-1]', { count: 0 });
    assert
      .dom('[data-test-boxel-dropdown-content-1]')
      .doesNotExist('dropdown should close when mouse leaves the content');

    // Scenario 2
    // Test with autoClose disabled
    await render(
      <template>
        <BoxelDropdown @autoClose={{false}}>
          <:trigger as |dd|>
            <button data-test-dropdown-trigger-2 {{dd}}>Open</button>
          </:trigger>
          <:content as |dd|>
            <div
              data-test-boxel-dropdown-content-2
              class='boxel-dropdown__content'
            >
              <BoxelMenu @closeMenu={{dd.close}} @items={{menuOptions}} />
            </div>
          </:content>
        </BoxelDropdown>
      </template>,
    );

    await click('[data-test-dropdown-trigger-2]');
    await waitFor('[data-test-boxel-dropdown-content-2]');

    // Test mouse leave - should stay open when autoClose is false
    await triggerEvent('[data-test-boxel-dropdown-content-2]', 'mouseleave');

    assert
      .dom('[data-test-boxel-dropdown-content-2]')
      .exists('dropdown should stay open when autoClose is false');
  });

  test('closing returns focus to the trigger even when the dropdown did not open from a click', async function (assert) {
    // The focus trap returns focus on deactivate, and its default target is
    // whatever had focus when the trap activated — <body> here, since nothing
    // clicked the trigger. The trigger has to be named explicitly for keyboard
    // users to land back on it.
    await render(
      <template>
        <BoxelDropdown @initiallyOpened={{true}}>
          <:trigger as |dd|>
            <button data-test-dropdown-trigger {{dd}}>Open</button>
          </:trigger>
          <:content as |dd|>
            <button data-test-dropdown-close {{on 'click' dd.close}}>
              Close
            </button>
          </:content>
        </BoxelDropdown>
      </template>,
    );

    await waitFor('[data-test-boxel-dropdown-content]');
    await click('[data-test-dropdown-close]');
    await waitFor('[data-test-boxel-dropdown-content]', { count: 0 });

    let trigger = document.querySelector('[data-test-dropdown-trigger]');
    // focus-trap returns focus off the run loop, so settling isn't enough
    await waitUntil(() => document.activeElement === trigger);
    assert.strictEqual(
      document.activeElement,
      trigger,
      'focus lands back on the trigger',
    );
  });

  test('closing does not scroll the trigger back into view', async function (assert) {
    // This is what the whole close path exists for: a menu action starts a
    // smooth scroll, and any focus() that scrolls the trigger into view
    // cancels it. ember-basic-dropdown's own close() focuses the trigger with
    // a bare focus(), so the close has to skip that and let the focus trap
    // return focus with preventScroll instead.
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='height: 8rem; overflow-y: auto' data-test-scroller>
          <BoxelDropdown @initiallyOpened={{true}}>
            <:trigger as |dd|>
              <button data-test-dropdown-trigger {{dd}}>Open</button>
            </:trigger>
            <:content as |dd|>
              <button data-test-dropdown-close {{on 'click' dd.close}}>
                Close
              </button>
            </:content>
          </BoxelDropdown>
          <div style='height: 60rem'></div>
        </div>
      </template>,
    );

    await waitFor('[data-test-boxel-dropdown-content]');
    let scroller: HTMLElement = document.querySelector('[data-test-scroller]')!;
    // scroll the trigger out of view, so a scrolling focus() would show up
    scroller.scrollTop = scroller.scrollHeight;
    let scrolledTo = scroller.scrollTop;
    assert.true(scrolledTo > 0, 'the container scrolled away from the trigger');

    await click('[data-test-dropdown-close]');
    await waitFor('[data-test-boxel-dropdown-content]', { count: 0 });
    let trigger = document.querySelector('[data-test-dropdown-trigger]');
    // assert only once the trap's delayed return focus has actually run
    await waitUntil(() => document.activeElement === trigger);

    assert.strictEqual(
      scroller.scrollTop,
      scrolledTo,
      'returning focus to the trigger left the scroll position alone',
    );
  });

  test('closing after the trigger unmounts falls back to the previously focused element', async function (assert) {
    // Triggers can disappear while their dropdown is open — the operator-mode
    // overlay's is behind an {{#if}}. focus-trap throws when setReturnFocus
    // resolves to nothing, so the trigger lookup needs a fallback.
    class TriggerState {
      @tracked mounted = true;
    }
    let state = new TriggerState();
    let dropdownApi: BoxelDropdownAPI | undefined;
    let registerAPI = (api: BoxelDropdownAPI) => {
      dropdownApi = api;
    };

    await render(
      <template>
        <button data-test-outside>Outside</button>
        <BoxelDropdown @registerAPI={{registerAPI}}>
          <:trigger as |dd|>
            {{#if state.mounted}}
              <button data-test-dropdown-trigger {{dd}}>Open</button>
            {{/if}}
          </:trigger>
          <:content as |dd|>
            <button data-test-dropdown-close {{on 'click' dd.close}}>
              Close
            </button>
          </:content>
        </BoxelDropdown>
      </template>,
    );

    // opening from the API rather than a click leaves focus where it was, so
    // the element the trap falls back to is a known one
    await focus('[data-test-outside]');
    dropdownApi!.actions.open();
    await settled();
    await waitFor('[data-test-boxel-dropdown-content]');

    state.mounted = false;
    await settled();
    assert
      .dom('[data-test-dropdown-trigger]')
      .doesNotExist('the trigger unmounted while the dropdown was open');

    await click('[data-test-dropdown-close]');
    await waitFor('[data-test-boxel-dropdown-content]', { count: 0 });

    // without the fallback, focus-trap throws here instead of focusing this
    let outside = document.querySelector('[data-test-outside]');
    await waitUntil(() => document.activeElement === outside);
    assert.strictEqual(
      document.activeElement,
      outside,
      'focus returns to the element that had it before the trap activated',
    );
  });

  test('--boxel-dropdown-background-color wins over ember-basic-dropdown', async function (assert) {
    // ember-basic-dropdown paints .ember-basic-dropdown-content white. That
    // rule is less specific than the scoped .boxel-dropdown__content rule, so
    // it can only win by sitting in a higher cascade layer — which is what
    // happens when the layer order statement is lost during bundling.
    document.documentElement.style.setProperty(
      '--boxel-dropdown-background-color',
      'rgb(1, 2, 3)',
    );
    try {
      await render(
        <template>
          <BoxelDropdown>
            <:trigger as |dd|>
              <button data-test-dropdown-trigger {{dd}}>Open</button>
            </:trigger>
            <:content>
              <div>content</div>
            </:content>
          </BoxelDropdown>
        </template>,
      );

      await click('[data-test-dropdown-trigger]');
      await waitFor('[data-test-boxel-dropdown-content]');

      const content = document.querySelector(
        '[data-test-boxel-dropdown-content]',
      )!;
      assert.strictEqual(
        getComputedStyle(content).backgroundColor,
        'rgb(1, 2, 3)',
        'the documented custom property paints the dropdown',
      );
    } finally {
      document.documentElement.style.removeProperty(
        '--boxel-dropdown-background-color',
      );
    }
  });
});
