// Pretui — AgentQuestion unit tests. Imports from ../agentic; when AgentQuestion moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AgentQuestion } from './agent-question';

const OPTIONS = ['Fujian', 'Yunnan'];

function q(): HTMLElement {
  return document.querySelector('[data-test-pretui-agent-question]') as HTMLElement;
}
function pills(): HTMLButtonElement[] {
  return Array.from(q().querySelectorAll('.pretui-qpill')) as HTMLButtonElement[];
}

module('Pretui | components/agent-question', function (hooks) {
  setupCardTest(hooks);

  test('asks with option pills and a free-text field', async function (assert) {
    await render(<template><AgentQuestion @question='Which region?' @options={{OPTIONS}} /></template>);
    assert.true(q().classList.contains('pretui-question'));
    assert.strictEqual(q().querySelector('.pretui-question-text')?.textContent?.trim(), 'Which region?');
    assert.deepEqual(pills().map((p) => p.textContent?.trim()), ['Fujian', 'Yunnan']);
    assert.strictEqual((q().querySelector('.pretui-qinput') as HTMLInputElement).placeholder, 'Or type an answer…');
  });

  test('a pill settles the question into a quiet answered line and reports the answer', async function (assert) {
    let seen: string[] = [];
    const record = (a: string) => seen.push(a);
    await render(<template><AgentQuestion @question='Which region?' @options={{OPTIONS}} @onAnswer={{record}} /></template>);
    await click(pills()[1] as HTMLElement);
    assert.deepEqual(seen, ['Yunnan']);
    assert.true(q().classList.contains('pretui-answered'), 'the ASK settles rather than staying loud');
    assert.true(q().textContent?.includes('Which region?'));
    assert.strictEqual(q().querySelector('b')?.textContent?.trim(), 'Yunnan');
    assert.strictEqual(q().querySelector('.pretui-qpill'), null);
  });

  test('Enter in the field settles with the typed answer; an empty Enter does nothing', async function (assert) {
    let seen: string[] = [];
    const record = (a: string) => seen.push(a);
    await render(<template><AgentQuestion @question='Which region?' @onAnswer={{record}} /></template>);
    let input = q().querySelector('.pretui-qinput') as HTMLInputElement;
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.deepEqual(seen, [], 'nothing typed, nothing answered');
    await fillIn(input, 'Guangdong');
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.deepEqual(seen, ['Guangdong']);
    assert.strictEqual(q().querySelector('b')?.textContent?.trim(), 'Guangdong');
  });

  test('renders already answered when told so', async function (assert) {
    await render(<template><AgentQuestion @question='Which region?' @answered='Fujian' /></template>);
    assert.true(q().classList.contains('pretui-answered'));
    assert.strictEqual(q().querySelector('b')?.textContent?.trim(), 'Fujian');
  });
});
