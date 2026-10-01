// Pretui — AiInstructions unit tests. Imports from ../agentic-shelf; when AiInstructions moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AiInstructions } from './ai-instructions';
import type { AiInstruction } from './ai-instructions';

const RULES: AiInstruction[] = [
  { id: 'r1', text: 'Answer in British English.' },
  { id: 'r2', text: 'Never change prices without asking.', enabled: false, note: 'from the workspace skill' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-ai-instructions]') as HTMLElement;
}
function rows(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-instr-row')) as HTMLElement[];
}
/** The hook is forwarded onto the <input> itself. */
function field(): HTMLInputElement {
  let el = root().querySelector('[data-test-pretui-ai-instructions-field]') as HTMLElement;
  if (el.tagName !== 'INPUT') throw new Error(`field hook is on a ${el.tagName}, not the input`);
  return el as HTMLInputElement;
}
/** The hook lands on the Switch's own control. */
function switchAt(i: number): HTMLElement {
  let sw = rows()[i]?.querySelector('[data-test-pretui-ai-instructions-switch]') as HTMLElement;
  if (sw.tagName !== 'BUTTON') throw new Error(`switch is a ${sw.tagName}, not a BUTTON`);
  return sw;
}
function addBtn(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-ai-instructions-add]') as HTMLButtonElement;
}

module('Pretui | components/ai-instructions', function (hooks) {
  setupCardTest(hooks);

  test('lists each instruction with a named switch, counts them, and says how many are in force', async function (assert) {
    await render(<template><AiInstructions @instructions={{RULES}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Instructions');
    assert.strictEqual(root().querySelector('.pretui-instr-count')?.textContent?.trim(), '2 instructions');
    assert.strictEqual(root().querySelector('[role="status"]')?.textContent?.trim(), '1 of 2 instructions in force', 'switching one off is audible, not only visible');
    assert.deepEqual(rows().map((r) => r.dataset['off']), [undefined, 'true']);
    assert.strictEqual(rows()[1]?.querySelector('.pretui-instr-off')?.textContent?.trim(), 'off', 'state is never colour alone');
    assert.strictEqual(rows()[1]?.querySelector('.pretui-instr-note')?.textContent?.trim(), 'from the workspace skill');
    assert.strictEqual(rows()[0]?.querySelector('[data-test-pretui-ai-instructions-switch]')?.getAttribute('aria-label'), 'In force: Answer in British English.');
    assert.strictEqual(root().querySelector('[data-test-pretui-ai-instructions-remove]'), null, 'no remove without a handler');
    assert.strictEqual(root().querySelector('form'), null, 'no add form without a handler');
  });

  test('toggling and removing report the instruction, not an index', async function (assert) {
    let toggled: [string, boolean][] = [];
    let removed: string[] = [];
    const onToggle = (i: AiInstruction, enabled: boolean) => toggled.push([i.id, enabled]);
    const onRemove = (i: AiInstruction) => removed.push(i.id);
    await render(<template><AiInstructions @instructions={{RULES}} @onToggle={{onToggle}} @onRemove={{onRemove}} /></template>);
    await click(switchAt(1));
    assert.deepEqual(toggled, [['r2', true]], 'asks to switch the off one on');
    let rm = rows()[0]?.querySelector('[data-test-pretui-ai-instructions-remove]') as HTMLButtonElement;
    assert.strictEqual(rm.getAttribute('aria-label'), 'Remove instruction: Answer in British English.');
    await click(rm);
    assert.deepEqual(removed, ['r1']);
  });

  test('adds a trimmed instruction on submit and clears the field; blank drafts cannot be added', async function (assert) {
    let added: string[] = [];
    const onAdd = (t: string) => added.push(t);
    await render(<template><AiInstructions @instructions={{RULES}} @onAdd={{onAdd}} /></template>);
    assert.true(addBtn().disabled);
    await fillIn(field(), '   ');
    assert.true(addBtn().disabled, 'whitespace is not an instruction');
    await fillIn(field(), '  Cite the lot id.  ');
    assert.false(addBtn().disabled);
    await click(addBtn());
    assert.deepEqual(added, ['Cite the lot id.']);
    assert.strictEqual(field().value, '');
  });

  test('a limit shows an "n of max" counter and closes the add field when reached', async function (assert) {
    const noop = () => {};
    await render(<template><AiInstructions @instructions={{RULES}} @max={{2}} @onAdd={{noop}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-instr-count')?.textContent?.trim(), '2 of 2');
    assert.true(field().disabled);
    assert.true(root().textContent?.includes('Limit reached'));
  });

  test('an empty shelf shows an EmptyState with the caller wording; the singular is used for one', async function (assert) {
    const NONE: AiInstruction[] = [];
    await render(<template><AiInstructions @instructions={{NONE}} @emptyMessage='Nothing standing yet.' @description='Sent with every message.' /></template>);
    assert.true(root().querySelector('[data-test-pretui-empty]')?.textContent?.includes('Nothing standing yet.'));
    assert.strictEqual(root().querySelector('[role="status"]')?.textContent?.trim(), 'No instructions');
    assert.strictEqual(root().querySelector('.pretui-instr-desc')?.textContent?.trim(), 'Sent with every message.');

    const ONE: AiInstruction[] = [RULES[0] as AiInstruction];
    await render(<template><AiInstructions @instructions={{ONE}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-instr-count')?.textContent?.trim(), '1 instruction');
  });
});
