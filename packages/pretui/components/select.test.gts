// Pretui — Select unit tests: how the trigger is named.
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Select } from './select';
import Globe from '@cardstack/boxel-icons/globe';
import { Dialog } from './dialog';
import { EditInPlace } from './edit-in-place';

const OPTIONS = [
  { value: 'green', label: 'Green' },
  { value: 'oolong', label: 'Oolong' },
];
const FLAGGED = [
  { value: 'jp', label: 'Japan', glyph: '🇯🇵' },
  { value: 'pt', label: 'Portugal', glyph: '🇵🇹' },
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

  test("the open list carries Select's scope, so its scoped rules reach the list in the wormhole", async function (assert) {
    await render(<template><Select @options={{OPTIONS}} /></template>);
    await click(trigger());
    let list = document.querySelector('.pretui-select-dropdown') as HTMLElement;
    assert.ok(list, 'the list is open');
    let marker = list.querySelector('.pretui-selectlist-scope') as HTMLElement;
    let scope = [...marker.attributes]
      .map(({ name }) => name)
      .filter((name) => name.startsWith('data-scopedcss-'));
    assert.ok(scope.length > 0, 'the marker is scoped');
    for (let name of scope) {
      assert.true(list.hasAttribute(name), `the list carries ${name}`);
    }
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

  test('the search box tells password managers to leave it alone', async function (assert) {
    await render(<template><Select @options={{OPTIONS}} @searchEnabled={{true}} /></template>);
    await click(trigger());
    let input = '[data-test-pretui-select-search-input]';
    assert.dom(input).hasAttribute('data-1p-ignore', '');
    assert.dom(input).hasAttribute('data-lpignore', 'true');
    assert.dom(input).hasAttribute('data-form-type', 'other');
    assert.dom(input).hasAttribute('data-bwignore', '');
  });

  test("an option's glyph leads its label on the trigger and in the list, hidden from assistive technology", async function (assert) {
    await render(<template><Select @options={{FLAGGED}} @defaultValue='pt' /></template>);
    let face = trigger().querySelector('[data-test-pretui-select-option-glyph]') as HTMLElement;
    assert.dom(face).hasText('🇵🇹', "the trigger draws the chosen option's glyph");
    assert.dom(face).hasAttribute('aria-hidden', 'true');
    assert.strictEqual(face.nextElementSibling?.textContent?.trim(), 'Portugal', 'before its label');
    await click(trigger());
    let glyphs = Array.from(document.querySelectorAll("[role='listbox'] [data-test-pretui-select-option-glyph]"));
    assert.deepEqual(glyphs.map((g) => g.textContent?.trim()), ['🇯🇵', '🇵🇹'], 'each row draws its glyph');
    assert.true(glyphs.every((g) => g.getAttribute('aria-hidden') === 'true'), 'each one hidden from assistive technology');
  });

  test('the search and the trigger typeahead read the label, not the glyph', async function (assert) {
    let chosen: string | undefined;
    let choose = (value: string) => (chosen = value);
    await render(<template><Select @options={{FLAGGED}} @searchEnabled={{true}} @onValueChange={{choose}} /></template>);
    await triggerKeyEvent(trigger(), 'keydown', 'P');
    assert.strictEqual(chosen, 'pt', "typing a label's first letter on the closed trigger chooses that option");
    await click(trigger());
    let input = document.querySelector('[data-test-pretui-select-search-input]') as HTMLInputElement;
    await fillIn(input, 'jap');
    let shown = Array.from(document.querySelectorAll("[role='listbox'] [data-test-pretui-select-option]")).map((o) => o.textContent?.trim());
    assert.deepEqual(shown, ['Japan'], 'the search filters by label');
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

  test('in icon mode a label pointing at @controlId names the trigger, then the value', async function (assert) {
    await render(
      <template>
        <label for='tea-icon'>Tea</label>
        <Select @options={{OPTIONS}} @controlId='tea-icon' @display='icon' @icon={{Globe}} @defaultValue='green' />
      </template>,
    );
    let labelEl = document.querySelector('label[for="tea-icon"]') as HTMLElement;
    let [labelId, valueId] = (trigger().getAttribute('aria-labelledby') ?? '').split(' ');
    assert.strictEqual(labelId, labelEl.id, 'the label comes first');
    assert.strictEqual(document.getElementById(valueId!)?.textContent?.trim(), 'Green', 'then the hidden value');
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

  test("@display 'icon' names the trigger with the current value and keeps the list", async function (assert) {
    let chosen: string | undefined;
    let onChange = (value: string) => (chosen = value);
    await render(
      <template>
        <Select @options={{OPTIONS}} @label='Tea' @display='icon' @icon={{Globe}} @defaultValue='green' @onValueChange={{onChange}} />
      </template>,
    );
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Tea: Green');
    assert.strictEqual(trigger().getAttribute('title'), 'Tea: Green');
    assert.notOk(trigger().textContent?.includes('Green'), 'the face is the icon');
    assert.ok(trigger().querySelector('svg'));

    await click(trigger());
    let options = Array.from(document.querySelectorAll('[data-test-pretui-select-option]'));
    assert.deepEqual(options.map((o) => o.textContent?.trim()), ['Green', 'Oolong'], 'the list is unchanged');
    await click(options[1] as HTMLElement);
    assert.strictEqual(chosen, 'oolong');
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Tea: Oolong', 'the name follows the value');
  });

  test("@display 'icon' with @labelledBy reads the label, then the value", async function (assert) {
    await render(
      <template>
        <span id='tea-heading'>Tea</span>
        <Select @options={{OPTIONS}} @labelledBy='tea-heading' @display='icon' @icon={{Globe}} @defaultValue='green' />
      </template>,
    );
    let ids = (trigger().getAttribute('aria-labelledby') ?? '').split(' ');
    assert.strictEqual(ids[0], 'tea-heading', "the caller's label is kept");
    assert.strictEqual(document.getElementById(ids[1] ?? '')?.textContent, 'Green', 'then the current value');
  });
});
