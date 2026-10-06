// Pretui — render and unit proof for Toggle and Autocomplete. Run with
// `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// Nothing here asserts a computed style: `boxel test` stamps the scoped-CSS
// attribute and delivers no stylesheet, so every colour, size and layout
// assertion would read as an initial value. Structure, ARIA, keyboard and
// emitted callbacks are what this file proves.
import { module, test } from 'qunit';
import {
  blur,
  click,
  fillIn,
  focus,
  render,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { fn } from '@ember/helper';
import { rovingTabindex } from './focus';
import { tracked } from '@glimmer/tracking';
import { Autocomplete, commitTarget, filterItems, matchSpan, nextEnabled, stepIndex, valueAt } from './components/autocomplete';
import { Toggle } from './components/toggle';
import type { AutocompleteItem } from './components/autocomplete';
import { DEMOS_TOGGLE } from './components/toggle.usage';
import { DEMOS_AUTOCOMPLETE } from './components/autocomplete.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_TOGGLE, ...DEMOS_AUTOCOMPLETE };
const ENTRY_USAGE_PAGES = ['Toggle', 'Autocomplete'];

// Every query is scoped under #ember-testing. An unscoped
// document.querySelector('button') can hit QUnit's own chrome and has hung
// the whole suite before.
function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function one(selector: string): HTMLElement {
  return root().querySelector(selector) as HTMLElement;
}
function all(selector: string): HTMLElement[] {
  return Array.from(root().querySelectorAll<HTMLElement>(selector));
}
const AC = '[data-test-pretui-autocomplete]';
const FIELD = '[data-test-pretui-autocomplete-input]';
const OPTION = '[data-test-pretui-autocomplete-option]';
const TOGGLE = '[data-test-pretui-toggle]';

const ITEMS: AutocompleteItem[] = [
  { value: 'Berlin', meta: 'DE' },
  { value: 'Belgrade', meta: 'RS' },
  { value: 'Barcelona', meta: 'ES' },
  { value: 'Kyoto', meta: 'JP', disabled: true },
];

class Box {
  @tracked pressed = false;
  @tracked value = '';
  @tracked open: boolean | undefined = undefined;
  changes: unknown[] = [];
  commits: unknown[] = [];
  opens: boolean[] = [];
  searches: string[] = [];

  setPressed = (next: boolean) => {
    this.pressed = next;
    this.changes.push(next);
  };
  setValue = (next: string) => {
    this.value = next;
    this.changes.push(next);
  };
  onCommit = (next: string, item?: AutocompleteItem) => {
    this.commits.push([next, item ? item.value : undefined]);
  };
  onOpenChange = (next: boolean) => this.opens.push(next);
  onSearch = (query: string) => this.searches.push(query);
}

module('controls-entry | pure helpers', function () {
  test('commitTarget is the whole Enter decision', function (assert) {
    // deliberate (default): a suggestion wins ONLY when the keyboard put the
    // highlight there.
    assert.strictEqual(commitTarget('deliberate', 'none'), 'text');
    assert.strictEqual(commitTarget('deliberate', 'auto'), 'text');
    assert.strictEqual(commitTarget('deliberate', 'pointer'), 'text');
    assert.strictEqual(commitTarget('deliberate', 'user'), 'highlight');
    // highlight: strict listbox behaviour, and nothing at all with no row.
    assert.strictEqual(commitTarget('highlight', 'none'), 'none');
    assert.strictEqual(commitTarget('highlight', 'auto'), 'highlight');
    assert.strictEqual(commitTarget('highlight', 'user'), 'highlight');
    // text: a suggestion can never win.
    assert.strictEqual(commitTarget('text', 'user'), 'text');
    assert.strictEqual(commitTarget('text', 'none'), 'text');
  });

  test('filterItems honours the three modes', function (assert) {
    assert.deepEqual(
      filterItems(ITEMS, 'be', 'contains').map((i) => i.value),
      ['Berlin', 'Belgrade'],
    );
    assert.deepEqual(
      filterItems(ITEMS, 'bar', 'starts-with').map((i) => i.value),
      ['Barcelona'],
    );
    assert.strictEqual(filterItems(ITEMS, 'zzz', 'none').length, 4);
    assert.strictEqual(filterItems(ITEMS, '', 'contains').length, 4);
    // case-insensitive, and whitespace-trimmed
    assert.strictEqual(filterItems(ITEMS, '  BER ', 'contains').length, 1);
  });

  test('matchSpan splits around the first match and never loses text', function (assert) {
    let parts = matchSpan('Belgrade', 'gra');
    assert.strictEqual(parts.before, 'Bel');
    assert.strictEqual(parts.hit, 'gra');
    assert.strictEqual(parts.after, 'de');
    assert.strictEqual(parts.before + parts.hit + parts.after, 'Belgrade');
    let none = matchSpan('Belgrade', 'zzz');
    assert.strictEqual(none.before, 'Belgrade');
    assert.strictEqual(none.hit, '');
    let empty = matchSpan('Belgrade', '');
    assert.strictEqual(empty.before, 'Belgrade');
  });

  test('stepIndex wraps and treats -1 as nothing highlighted', function (assert) {
    assert.strictEqual(stepIndex(-1, 3, 1), 0);
    assert.strictEqual(stepIndex(-1, 3, -1), 2);
    assert.strictEqual(stepIndex(2, 3, 1), 0);
    assert.strictEqual(stepIndex(0, 3, -1), 2);
    assert.strictEqual(stepIndex(0, 0, 1), -1);
  });

  test('valueAt is identity — the revision exists only to dirty a reference', function (assert) {
    assert.strictEqual(valueAt('Berlin', 0), 'Berlin');
    assert.strictEqual(valueAt('Berlin', 41), 'Berlin');
  });

  test('nextEnabled steps over disabled rows and gives up cleanly', function (assert) {
    assert.strictEqual(nextEnabled([false, true, false], -1, 1), 0);
    assert.strictEqual(nextEnabled([false, true, false], 0, 1), 2);
    assert.strictEqual(nextEnabled([false, true, false], 2, 1), 0);
    assert.strictEqual(nextEnabled([true, true], 0, 1), -1);
    assert.strictEqual(nextEnabled([], 0, 1), -1);
  });
});

module('controls-entry | Toggle', function (hooks) {
  setupCardTest(hooks);

  test('uncontrolled: aria-pressed and data-state track activation', async function (assert) {
    let box = new Box();
    await render(<template>
      <Toggle @defaultPressed={{false}} @onPressedChange={{box.setPressed}}>
        Pin
      </Toggle>
    </template>);
    let button = one(TOGGLE);
    assert.ok(button, 'the toggle rendered');
    assert.strictEqual(button.tagName, 'BUTTON');
    assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(button.getAttribute('data-state'), 'off');
    await click(button);
    assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(button.getAttribute('data-state'), 'on');
    assert.deepEqual(box.changes, [true], 'the callback fired with the NEXT state');
  });

  test('controlled: the component never moves on its own', async function (assert) {
    let box = new Box();
    await render(<template>
      <Toggle @pressed={{box.pressed}}>Pin</Toggle>
    </template>);
    let button = one(TOGGLE);
    await click(button);
    assert.strictEqual(
      button.getAttribute('aria-pressed'),
      'false',
      'no callback wired and @pressed unchanged, so the state held',
    );
  });

  test('ariaState=checked swaps the attribute for a radiogroup member', async function (assert) {
    await render(<template>
      <Toggle @pressed={{true}} @ariaState='checked'>Left</Toggle>
    </template>);
    let button = one(TOGGLE);
    assert.strictEqual(button.getAttribute('aria-checked'), 'true');
    assert.strictEqual(
      button.getAttribute('aria-pressed'),
      null,
      'aria-pressed is absent, so a radio is not also a pressed button',
    );
  });

  test('ariaState=none leaves the state to a parent', async function (assert) {
    await render(<template>
      <Toggle @pressed={{true}} @ariaState='none'>Left</Toggle>
    </template>);
    let button = one(TOGGLE);
    assert.strictEqual(button.getAttribute('aria-pressed'), null);
    assert.strictEqual(button.getAttribute('aria-checked'), null);
    assert.strictEqual(button.getAttribute('data-pressed'), 'true');
  });

  test('disabled stays focusable — aria-disabled, never the attribute', async function (assert) {
    let box = new Box();
    await render(<template>
      <Toggle @disabled={{true}} @onPressedChange={{box.setPressed}}>
        Pin
      </Toggle>
    </template>);
    let button = one(TOGGLE) as HTMLButtonElement;
    assert.strictEqual(button.getAttribute('aria-disabled'), 'true');
    assert.false(button.disabled, 'the native attribute is never used');
    await click(button);
    assert.deepEqual(box.changes, [], 'the activation was ignored');
  });

  test('busy is pending, not disabled: aria-busy and focus retained', async function (assert) {
    let box = new Box();
    await render(<template>
      <Toggle @busy={{true}} @onPressedChange={{box.setPressed}}>Pin</Toggle>
    </template>);
    let button = one(TOGGLE) as HTMLButtonElement;
    assert.strictEqual(button.getAttribute('aria-busy'), 'true');
    assert.strictEqual(button.getAttribute('data-state'), 'busy');
    assert.false(button.disabled, 'still focusable while pending');
    await focus(button);
    assert.strictEqual(document.activeElement, button);
    await click(button);
    assert.deepEqual(box.changes, [], 'a pending toggle does not activate');
  });

  test('iconOnly names the button from @label', async function (assert) {
    await render(<template>
      <Toggle @iconOnly={{true}} @label='Pin this row'>P</Toggle>
    </template>);
    let button = one(TOGGLE);
    assert.strictEqual(button.getAttribute('aria-label'), 'Pin this row');
    assert.strictEqual(button.getAttribute('title'), 'Pin this row');
  });

  test('the treatment is reflected as data attributes', async function (assert) {
    await render(<template>
      <Toggle @tone='destructive' @size='lg' @pressed={{true}}>X</Toggle>
    </template>);
    let button = one(TOGGLE);
    assert.strictEqual(
      button.getAttribute('data-tone'),
      'danger',
      'the React spelling resolved to the house tone',
    );
    assert.strictEqual(button.getAttribute('data-size'), 'l');
    assert.strictEqual(
      button.getAttribute('data-appearance'),
      'accent',
      'pressed wears the pressed recipe, not a tint',
    );
  });
});

module('controls-entry | Autocomplete', function (hooks) {
  setupCardTest(hooks);


  test('the combobox ARIA contract is complete and closed at rest', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} @label='City' />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    assert.strictEqual(input.getAttribute('role'), 'combobox');
    assert.strictEqual(input.getAttribute('aria-autocomplete'), 'list');
    assert.strictEqual(input.getAttribute('aria-expanded'), 'false');
    assert.ok(input.getAttribute('aria-controls'), 'it points at its listbox');
    assert.strictEqual(input.getAttribute('aria-activedescendant'), null);
    let label = one('label') as HTMLLabelElement;
    assert.strictEqual(
      label.getAttribute('for'),
      input.id,
      'a real label, not an aria-label — which realm lint would reject beside an id',
    );
    assert.strictEqual(label.textContent?.trim(), 'City');
  });

  test('typing filters, opens the layer and reports the query', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @onChange={{box.setValue}}
        @onOpenChange={{box.onOpenChange}}
        @onSearch={{box.onSearch}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'be');
    assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
      all(OPTION).map((o) => o.getAttribute('aria-selected')),
      ['false', 'false'],
      'two matches, nothing highlighted yet',
    );
    assert.deepEqual(box.opens, [true]);
    assert.deepEqual(box.searches, ['be'], 'no debounce means no timer');
    let list = one('[data-test-pretui-autocomplete-list]');
    assert.strictEqual(list.getAttribute('role'), 'listbox');
    assert.ok(list.getAttribute('aria-label'), 'the listbox is named');
  });

  test('ArrowDown moves aria-activedescendant and skips disabled rows', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, '');
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    let rows = all(OPTION);
    assert.strictEqual(rows.length, 4);
    assert.strictEqual(input.getAttribute('aria-activedescendant'), rows[0].id);
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    assert.strictEqual(input.getAttribute('aria-activedescendant'), rows[2].id);
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    assert.strictEqual(
      input.getAttribute('aria-activedescendant'),
      rows[0].id,
      'Kyoto is disabled, so the arrow wrapped past it',
    );
  });

  test('Enter commits the TYPED TEXT when the reader never touched the arrows', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @autoHighlight={{true}}
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'be');
    assert.ok(
      input.getAttribute('aria-activedescendant'),
      'autoHighlight pre-highlighted a row',
    );
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.deepEqual(
      box.commits,
      [['be', undefined]],
      'the pre-highlighted row did NOT win Enter — this is the MUI bug, fixed',
    );
  });

  test('Enter commits the SUGGESTION when the reader arrowed to it', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @onChange={{box.setValue}}
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'be');
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.deepEqual(box.commits, [['Belgrade', 'Belgrade']]);
    assert.strictEqual(
      input.getAttribute('aria-expanded'),
      'false',
      'committing closes the layer',
    );
  });

  test("enterCommits='highlight' refuses free text", async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @enterCommits='highlight'
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'be');
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.deepEqual(box.commits, [], 'nothing highlighted, so nothing committed');
  });

  test('clicking a suggestion commits it and returns focus to the field', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @onChange={{box.setValue}}
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'bar');
    await click(all(OPTION)[0]);
    assert.deepEqual(box.commits, [['Barcelona', 'Barcelona']]);
    assert.strictEqual(input.value, 'Barcelona');
    assert.strictEqual(
      document.activeElement,
      input,
      'focus came back, so a run of edits stays on the keyboard',
    );
  });

  test('a disabled suggestion cannot be clicked', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete @items={{ITEMS}} @onCommit={{box.onCommit}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'kyo');
    let rows = all(OPTION);
    assert.strictEqual(rows[0].getAttribute('aria-disabled'), 'true');
    await click(rows[0]);
    assert.deepEqual(box.commits, []);
  });

  test('blur COMMITS the typed text rather than reverting it', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @onChange={{box.setValue}}
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'somewhere else');
    await blur(input);
    assert.deepEqual(
      box.commits,
      [['somewhere else', undefined]],
      'MUI throws this away under clearOnBlur; here it is what the reader meant',
    );
    assert.strictEqual(input.getAttribute('aria-expanded'), 'false');
  });

  test('Escape closes the layer, then restores the last committed value', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @onChange={{box.setValue}}
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'ber');
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.strictEqual(input.value, 'Berlin');
    await fillIn(input, 'Berlin and more');
    await triggerKeyEvent(input, 'keydown', 'Escape');
    assert.strictEqual(
      input.getAttribute('aria-expanded'),
      'false',
      'the first Escape closes the layer',
    );
    await triggerKeyEvent(input, 'keydown', 'Escape');
    assert.strictEqual(
      input.value,
      'Berlin',
      'the second Escape restores the last committed value',
    );
  });

  test('Home and End are left to the caret', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'b');
    await triggerKeyEvent(input, 'keydown', 'Home');
    assert.strictEqual(
      input.getAttribute('aria-activedescendant'),
      null,
      'Home did not hijack the listbox — the value is prose and Home is the caret',
    );
    await triggerKeyEvent(input, 'keydown', 'End');
    assert.strictEqual(input.getAttribute('aria-activedescendant'), null);
  });

  test('the empty state is deliberate and the live region says so', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'zzzz');
    assert.strictEqual(all(OPTION).length, 0);
    let status = one('[data-test-pretui-autocomplete-status]');
    assert.strictEqual(status.getAttribute('role'), 'status');
    assert.strictEqual(status.textContent?.trim(), 'No matches');
    let list = one('[data-test-pretui-autocomplete-list]');
    assert.ok(list, 'the layer stays rendered so aria-controls still resolves');
  });

  test('the live region counts the suggestions', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'be');
    let status = one('[data-test-pretui-autocomplete-status]');
    assert.strictEqual(status.textContent?.trim(), '2 suggestions');
    await fillIn(input, 'bar');
    assert.strictEqual(status.textContent?.trim(), '1 suggestion');
  });

  test('minChars holds the layer shut without desynchronising @onOpenChange', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @minChars={{3}}
        @onOpenChange={{box.onOpenChange}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'be');
    assert.strictEqual(input.getAttribute('aria-expanded'), 'false');
    await fillIn(input, 'ber');
    assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(box.opens, [true], 'onOpenChange fired exactly once');
  });

  test('maxVisible caps the rendered rows', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} @maxVisible={{2}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, '');
    await triggerKeyEvent(input, 'keydown', 'ArrowDown');
    assert.strictEqual(all(OPTION).length, 2);
  });

  test('@filter=none leaves the caller-supplied list alone', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} @filter='none' />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'zzzz');
    assert.strictEqual(
      all(OPTION).length,
      4,
      'an async caller re-filtering its own answer would hide rows it meant to show',
    );
  });

  test('options carry a computed name and no presentational children', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'ber');
    let option = all(OPTION)[0];
    assert.strictEqual(option.getAttribute('role'), 'option');
    assert.strictEqual(option.getAttribute('aria-label'), 'Berlin');
    assert.strictEqual(
      option.children.length,
      0,
      'the option is a bare overlay; every glyph lives in the aria-hidden face',
    );
    let face = one('.pretui-ac-face');
    assert.strictEqual(face.getAttribute('aria-hidden'), 'true');
  });

  test('the clear button is named, and clearing commits the empty value', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete
        @items={{ITEMS}}
        @clearable={{true}}
        @label='City'
        @onChange={{box.setValue}}
        @onCommit={{box.onCommit}}
      />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'ber');
    let clear = one('[data-test-pretui-autocomplete-clear]');
    assert.strictEqual(clear.getAttribute('aria-label'), 'Clear City');
    await click(clear);
    assert.strictEqual(input.value, '');
    assert.deepEqual(box.commits, [['', undefined]]);
  });

  test('disabled and readonly keep the layer shut and stay focusable', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} @isDisabled={{true}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    assert.strictEqual(input.getAttribute('aria-disabled'), 'true');
    assert.false(input.disabled, 'aria-disabled, never the native attribute');
    await focus(input);
    assert.strictEqual(input.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(
      one(AC).getAttribute('data-disabled'),
      'true',
      'the alias isDisabled resolved',
    );
  });

  test('the treatment is reflected as data attributes', async function (assert) {
    await render(<template>
      <Autocomplete @items={{ITEMS}} @tone='brand' @size='md' />
    </template>);
    let element = one(AC);
    assert.strictEqual(element.getAttribute('data-tone'), 'primary');
    assert.strictEqual(element.getAttribute('data-size'), 'm');
    assert.strictEqual(element.getAttribute('data-appearance'), 'filled-outlined');
  });

  test('@options is accepted as an alias for @items', async function (assert) {
    await render(<template>
      <Autocomplete @options={{ITEMS}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'bar');
    assert.strictEqual(all(OPTION).length, 1);
  });

  test('a controlled @value is never moved by the component', async function (assert) {
    let box = new Box();
    await render(<template>
      <Autocomplete @items={{ITEMS}} @value={{box.value}} />
    </template>);
    let input = one(FIELD) as HTMLInputElement;
    await fillIn(input, 'ber');
    assert.strictEqual(
      input.value,
      '',
      'no onChange wired and @value unchanged, so the field held',
    );
  });
});

// The usage pages must MOUNT — a demo page that throws takes the whole
// gallery down, and `boxel parse` does not compile a template the way the
// realm does.
/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS registries
   are Record<string, unknown> by contract; mounting one requires the cast. */
type AnyComponent = any;

module('controls-entry | Autocomplete controlled', function (hooks) {
  setupCardTest(hooks);

  test('a controlled field shows @value until the owner takes the keystroke', async function (assert) {
    let typed: string[] = [];
    let onValueChange = (v: string) => typed.push(v);
    await render(<template><Autocomplete @items={{ITEMS}} @label='City' @value='Berlin' @onValueChange={{onValueChange}} /></template>);
    let field = document.querySelector('[data-test-pretui-autocomplete-input]') as HTMLInputElement;
    await fillIn(field, 'Bel');
    assert.deepEqual(typed, ['Bel'], 'the owner is told');
    assert.strictEqual(field.value, 'Berlin', 'and the field did not drift');
  });
});

module('controls-entry | usage pages', function (hooks) {
  setupCardTest(hooks);
  for (let name of ENTRY_USAGE_PAGES) {
    test(name + ' mounts', async function (assert) {
      let Demo = PAGES[name] as AnyComponent;
      assert.ok(Demo, name + ' is present in the registry');
      await render(<template><Demo /></template>);
      assert.ok(one('.FreestyleUsage'), name + ' rendered a FreestyleUsage shell');
    });
  }
});

// A ToggleGroup member is exactly a Toggle carrying the group's role and
// roving tabindex through ...attributes.
module('controls-entry | Toggle under a ToggleGroup shape', function (hooks) {
  setupCardTest(hooks);

  test('a single-select member is a radio with no aria-pressed', async function (assert) {
    let box = new Box();
    let pick = (option: string, _index: number, _pressed?: boolean) => {
      box.changes.push(option);
    };
    await render(<template>
      <div role='radiogroup' aria-label='Align'>
        {{! Toggle sets aria-checked itself from @ariaState, which the rule can't see }}
        {{! template-lint-disable require-mandatory-role-attributes }}
        <Toggle
          @pressed={{true}}
          @ariaState='checked'
          @onPressedChange={{fn pick 'left' 0}}
          role='radio'
          data-tg-index='0'
          {{rovingTabindex true}}
        >Left</Toggle>
        <Toggle
          @pressed={{false}}
          @ariaState='checked'
          @onPressedChange={{fn pick 'right' 1}}
          role='radio'
          data-tg-index='1'
          {{rovingTabindex false}}
        >Right</Toggle>
      </div>
    </template>);
    let members = all('[data-tg-index]');
    assert.strictEqual(members.length, 2);
    assert.strictEqual(members[0].getAttribute('role'), 'radio');
    assert.strictEqual(members[0].getAttribute('aria-checked'), 'true');
    assert.strictEqual(members[0].getAttribute('aria-pressed'), null);
    assert.strictEqual(
      (members[0] as HTMLElement).tabIndex,
      0,
      'the group still owns the single tab stop',
    );
    assert.strictEqual((members[1] as HTMLElement).tabIndex, -1);
    await click(members[1]);
    assert.deepEqual(box.changes, ['right'], 'the group handler got its option');
  });

  test('a multi-select member is a pressed toolbar button', async function (assert) {
    await render(<template>
      <div role='toolbar' aria-label='Format'>
        <Toggle @pressed={{true}} data-tg-index='0'>B</Toggle>
      </div>
    </template>);
    let member = one('[data-tg-index]');
    assert.strictEqual(member.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(member.getAttribute('aria-checked'), null);
  });
});
