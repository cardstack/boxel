// Pretui — Select unit tests: how the trigger is named.
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Select } from './select';
import { Dialog } from './dialog';
import { EditInPlace } from './edit-in-place';

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

  test('inside a modal Dialog the list renders in place and an option can be chosen', async function (assert) {
    let chosen: string | undefined;
    let onChange = (value: string) => (chosen = value);
    await render(
      <template>
        <Dialog @open={{true}} @label='Pick a tea'>
          <Select @options={{OPTIONS}} @onValueChange={{onChange}} />
        </Dialog>
      </template>,
    );
    await click(trigger());
    let listbox = document.querySelector("[role='listbox']") as HTMLElement;
    assert.ok(wrapper().contains(listbox), 'the list renders in place, not in the inert wormhole');
    let oolong = Array.from(listbox.querySelectorAll('[data-test-pretui-select-option]')).find((o) => o.textContent?.trim() === 'Oolong') as HTMLElement;
    await click(oolong);
    assert.strictEqual(chosen, 'oolong', 'the option takes the click');
  });

  test('in a scrolled Dialog the list opens at its trigger', async function (assert) {
    await render(
      <template>
        <Dialog @open={{true}} @label='Pick a tea'>
          <div data-test-spacer></div>
          <Select @options={{OPTIONS}} />
        </Dialog>
      </template>,
    );
    (document.querySelector('[data-test-spacer]') as HTMLElement).style.height = '150vh';
    let dialog = document.querySelector('[data-test-pretui-dialog]') as HTMLElement;
    dialog.scrollTop = dialog.scrollHeight;
    await click(trigger());
    let list = (document.querySelector("[role='listbox']") as HTMLElement).getBoundingClientRect();
    let at = trigger().getBoundingClientRect();
    // the list flips above when there is no room below; either way it
    // touches the trigger rather than sitting a scroll distance away
    let below = Math.abs(list.top - at.bottom);
    let above = Math.abs(at.top - list.bottom);
    assert.true(dialog.scrollTop > 0, 'the dialog is scrolled');
    assert.true(Math.min(below, above) < 16, `the list sits against its trigger (below ${below}px, above ${above}px)`);
  });

  test('inside a blur-commit EditInPlace the search box keeps the edit open', async function (assert) {
    let committed: string | undefined;
    let onCommit = (next: string) => {
      committed = next;
    };
    await render(
      <template>
        <EditInPlace @label='Tea' @value='green' @defaultEditing={{true}} @onCommit={{onCommit}}>
          <:editor as |editor|>
            <Select
              @options={{OPTIONS}}
              @value={{editor.value}}
              @controlId={{editor.controlId}}
              @onValueChange={{editor.setValue}}
              @searchEnabled={{true}}
            />
          </:editor>
        </EditInPlace>
      </template>,
    );
    await click(trigger());
    let input = document.querySelector('[data-test-pretui-select-search-input]') as HTMLInputElement;
    await waitUntil(() => document.activeElement === input);
    assert.strictEqual(committed, undefined, 'focusing the search box does not commit');
    await fillIn(input, 'oo');
    await triggerKeyEvent(input, 'keydown', 'Enter');
    await triggerKeyEvent(trigger(), 'keydown', 'Enter');
    assert.strictEqual(committed, 'oolong', 'the filtered option is chosen, then Enter commits it');
  });

  test('pressing an option in place does not move focus off the trigger', async function (assert) {
    let committed: string | undefined;
    let onCommit = (next: string) => {
      committed = next;
    };
    await render(
      <template>
        <EditInPlace @label='Tea' @value='green' @defaultEditing={{true}} @onCommit={{onCommit}}>
          <:editor as |editor|>
            <Select
              @options={{OPTIONS}}
              @value={{editor.value}}
              @controlId={{editor.controlId}}
              @onValueChange={{editor.setValue}}
            />
          </:editor>
        </EditInPlace>
      </template>,
    );
    await click(trigger());
    let oolong = Array.from(document.querySelectorAll("[role='listbox'] [data-test-pretui-select-option]")).find((o) => o.textContent?.trim() === 'Oolong') as HTMLElement;
    let press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    oolong.dispatchEvent(press);
    assert.true(press.defaultPrevented, 'the press keeps focus where it was');
    assert.strictEqual(committed, undefined, 'the press does not commit the edit');
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
