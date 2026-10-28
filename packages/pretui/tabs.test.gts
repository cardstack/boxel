// Pretui — proof for Tabs (components/tabs.gts): selection from a plain DOM
// click, the APG keyboard pattern, and the tab-to-panel wiring.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, focus, settled, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Tabs } from './components/tabs';
import type { SegmentOption } from './components/segmented-control';

const OPTIONS: SegmentOption[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'activity', label: 'Activity' },
  { value: 'settings', label: 'Settings' },
];

function tab(value: string): HTMLElement {
  return document.querySelector(
    `[data-test-pretui-tab='${value}']`,
  ) as HTMLElement;
}
function selected(): string | null {
  return (
    document
      .querySelector("[data-test-pretui-tab][aria-selected='true']")
      ?.getAttribute('data-test-pretui-tab') ?? null
  );
}
function panelText(): string {
  return (
    document
      .querySelector('[data-test-pretui-tabpanel]')
      ?.textContent?.trim() ?? ''
  );
}

module('Pretui | Tabs', function (hooks) {
  setupCardTest(hooks);

  test('a plain DOM click selects a tab, with no pointer events before it', async function (assert) {
    await render(
      <template>
        <Tabs @options={{OPTIONS}} as |value|>{{value}}</Tabs>
      </template>,
    );
    assert.strictEqual(selected(), 'overview');

    tab('activity').click();
    await settled();

    assert.strictEqual(selected(), 'activity');
    assert.strictEqual(panelText(), 'activity');
  });

  test('the list is one tab stop, on the active tab', async function (assert) {
    await render(
      <template>
        <Tabs @options={{OPTIONS}} @defaultValue='activity' />
      </template>,
    );
    assert.dom(tab('activity')).hasAttribute('tabindex', '0');
    assert.dom(tab('overview')).hasAttribute('tabindex', '-1');
    assert.dom(tab('settings')).hasAttribute('tabindex', '-1');
  });

  test('a value that matches no option leaves the first tab as the stop', async function (assert) {
    await render(
      <template><Tabs @options={{OPTIONS}} @value='missing' /></template>,
    );
    assert.strictEqual(selected(), null);
    assert.dom(tab('overview')).hasAttribute('tabindex', '0');
  });

  test('arrow keys, Home and End move focus and select, wrapping at the ends', async function (assert) {
    let changes: string[] = [];
    let onChange = (value: string) => changes.push(value);
    await render(
      <template>
        <Tabs @options={{OPTIONS}} @onValueChange={{onChange}} />
      </template>,
    );

    await focus(tab('overview'));
    await triggerKeyEvent(tab('overview'), 'keydown', 'ArrowLeft');
    assert.strictEqual(
      selected(),
      'settings',
      'Left from the first wraps to the last',
    );
    assert.strictEqual(document.activeElement, tab('settings'));

    await triggerKeyEvent(tab('settings'), 'keydown', 'ArrowRight');
    assert.strictEqual(
      selected(),
      'overview',
      'Right from the last wraps to the first',
    );
    assert.strictEqual(document.activeElement, tab('overview'));

    await triggerKeyEvent(tab('overview'), 'keydown', 'End');
    assert.strictEqual(selected(), 'settings');
    await triggerKeyEvent(tab('settings'), 'keydown', 'Home');
    assert.strictEqual(selected(), 'overview');

    assert.deepEqual(changes, ['settings', 'overview', 'settings', 'overview']);
  });

  test('the tab stop follows the selection', async function (assert) {
    await render(<template><Tabs @options={{OPTIONS}} /></template>);
    await focus(tab('overview'));
    await triggerKeyEvent(tab('overview'), 'keydown', 'ArrowRight');
    assert.dom(tab('activity')).hasAttribute('tabindex', '0');
    assert.dom(tab('overview')).hasAttribute('tabindex', '-1');
  });

  test('a key with a modifier is left to the browser', async function (assert) {
    await render(<template><Tabs @options={{OPTIONS}} /></template>);
    await focus(tab('activity'));
    for (let modifier of ['altKey', 'metaKey', 'ctrlKey', 'shiftKey']) {
      let event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      });
      tab('activity').dispatchEvent(event);
      await settled();
      assert.false(event.defaultPrevented, `${modifier} is not prevented`);
    }
    assert.strictEqual(selected(), 'overview', 'the selection is unchanged');
    assert.strictEqual(document.activeElement, tab('activity'));
  });

  test('right-to-left reverses the arrow keys', async function (assert) {
    await render(
      <template>
        <div dir='rtl'><Tabs @options={{OPTIONS}} /></div>
      </template>,
    );
    await focus(tab('overview'));
    await triggerKeyEvent(tab('overview'), 'keydown', 'ArrowLeft');
    assert.strictEqual(selected(), 'activity');
    await triggerKeyEvent(tab('activity'), 'keydown', 'ArrowRight');
    assert.strictEqual(selected(), 'overview');
  });

  test('when a controlled parent refuses the change, focus stays on the selected tab', async function (assert) {
    let asked: string[] = [];
    let refuse = (value: string) => asked.push(value);
    await render(
      <template>
        <Tabs
          @options={{OPTIONS}}
          @value='overview'
          @onValueChange={{refuse}}
        />
      </template>,
    );
    await focus(tab('overview'));
    await triggerKeyEvent(tab('overview'), 'keydown', 'ArrowRight');
    assert.deepEqual(asked, ['activity'], 'the parent was asked');
    assert.strictEqual(selected(), 'overview');
    assert.strictEqual(document.activeElement, tab('overview'));
  });

  test('each tab controls the panel, and the panel is labelled by the active tab', async function (assert) {
    await render(
      <template>
        <Tabs
          @options={{OPTIONS}}
          @defaultValue='settings'
          as |value|
        >{{value}}</Tabs>
      </template>,
    );
    let panel = document.querySelector(
      '[data-test-pretui-tabpanel]',
    ) as HTMLElement;
    assert.ok(panel.id, 'the panel has an id');
    for (let { value } of OPTIONS) {
      assert.dom(tab(value)).hasAttribute('aria-controls', panel.id);
    }
    assert.dom(panel).hasAttribute('aria-labelledby', tab('settings').id);
    assert.dom(panel).hasAttribute('tabindex', '0');
  });

  test('with no block there is no panel for a tab to control', async function (assert) {
    await render(<template><Tabs @options={{OPTIONS}} /></template>);
    assert.dom('[data-test-pretui-tabpanel]').doesNotExist();
    assert.dom(tab('overview')).doesNotHaveAttribute('aria-controls');
  });
});
