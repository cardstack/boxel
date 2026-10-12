// Pretui — Select unit tests: how the trigger is named.
import { module, test } from 'qunit';
import { render, click, fillIn, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Select } from './select';

const OPTIONS = [
  { value: 'green', label: 'Green' },
  { value: 'oolong', label: 'Oolong' },
];

function wrapper(): HTMLElement {
  return document.querySelector('[data-test-pretui-select]') as HTMLElement;
}
function trigger(): HTMLElement {
  return wrapper().querySelector('[data-test-pretui-select-trigger]') as HTMLElement;
}

module('Pretui | components/select', function (hooks) {
  setupCardTest(hooks);

  test('the dropdown renders outside the Select, so no ancestor clips it', async function (assert) {
    await render(<template><Select @options={{OPTIONS}} /></template>);
    await click(trigger());
    let listbox = document.querySelector("[role='listbox']") as HTMLElement;
    assert.ok(listbox, 'the list is open');
    assert.notOk(wrapper().contains(listbox), 'in the wormhole, not in place');
    assert.strictEqual(listbox.querySelectorAll('[data-test-pretui-select-option]').length, OPTIONS.length);
  });

  test('@searchEnabled adds a search box that takes focus on open and filters by label', async function (assert) {
    await render(<template><Select @options={{OPTIONS}} @searchEnabled={{true}} /></template>);
    await click(trigger());
    let input = document.querySelector('[data-test-pretui-select-search-input]') as HTMLInputElement;
    assert.ok(input, 'the search box renders');
    await waitUntil(() => document.activeElement === input);
    assert.strictEqual(document.activeElement, input, 'focus moves into the search box');
    await fillIn(input, 'oo');
    let shown = Array.from(document.querySelectorAll("[role='listbox'] [data-test-pretui-select-option]")).map((o) => o.textContent?.trim());
    assert.deepEqual(shown, ['Oolong'], 'typing filters the options by label');
  });

  test('a label pointing at @controlId names the trigger, then the value', async function (assert) {
    await render(
      <template>
        <label for='tea-select'>Tea</label>
        <Select @options={{OPTIONS}} @controlId='tea-select' />
      </template>,
    );
    let labelEl = document.querySelector('label[for="tea-select"]') as HTMLElement;
    assert.ok(labelEl.id, 'the label gets an id');
    assert.strictEqual(
      trigger().getAttribute('aria-labelledby'),
      `${labelEl.id} ${trigger().id}`,
      'the name is the label, then the trigger, so the chosen value is still read',
    );
  });

  test('a label wrapping the Select names it too', async function (assert) {
    await render(
      <template>
        <label>Tea <Select @options={{OPTIONS}} /></label>
      </template>,
    );
    let wrapping = trigger().closest('label') as HTMLElement;
    assert.ok(wrapping?.id, 'the wrapping label gets an id');
    assert.strictEqual(trigger().getAttribute('aria-labelledby'), `${wrapping.id} ${trigger().id}`);
  });

  test('@label and @labelledBy name the trigger directly', async function (assert) {
    await render(<template><Select @options={{OPTIONS}} @label='Tea' /></template>);
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Tea');
    await render(
      <template>
        <span id='tea-heading'>Tea</span>
        <label for='tea-select'>Ignored</label>
        <Select @options={{OPTIONS}} @controlId='tea-select' @labelledBy='tea-heading' />
      </template>,
    );
    assert.strictEqual(trigger().getAttribute('aria-labelledby'), 'tea-heading', 'an explicit name wins over the label');
  });
});
