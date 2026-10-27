// Pretui — AgentQuestion unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AgentQuestion, type AgentChoice } from './agent-question';

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

  test('a read-only question settles when the caller reports the answer later', async function (assert) {
    class State {
      @tracked answered: string | undefined;
    }
    let state = new State();
    await render(<template><AgentQuestion @question='Which region?' @readonly={{true}} @answered={{state.answered}} /></template>);
    assert.dom('[data-test-pretui-agent-question-readonly]').exists('waiting for a teammate');
    state.answered = 'Yunnan';
    await settled();
    assert.dom('[data-test-pretui-agent-question-readonly]').doesNotExist();
    assert.dom('[data-test-pretui-agent-question] b').hasText('Yunnan', 'the arrived answer shows');
  });

  test('a swatch that is not one CSS value is not written into the style attribute', async function (assert) {
    const CHOICES: AgentChoice[] = [
      { label: 'Teal', swatch: '#14b8a6' },
      { label: 'Trap', swatch: 'red; position: fixed; inset: 0' },
    ];
    await render(<template><AgentQuestion @question='Which colour?' @layout='swatches' @choices={{CHOICES}} /></template>);
    let teal = document.querySelector('[data-test-pretui-agent-choice="Teal"]') as HTMLElement;
    let trap = document.querySelector('[data-test-pretui-agent-choice="Trap"]') as HTMLElement;
    assert.strictEqual(teal.style.getPropertyValue('--swatch').trim(), '#14b8a6');
    assert.strictEqual(trap.style.getPropertyValue('--swatch'), '', 'the swatch is dropped');
    assert.strictEqual(trap.style.position, '', 'no declaration escapes the value');
  });

  test('a card choice shows its image as a decorative img, never as a style url', async function (assert) {
    const CHOICES: AgentChoice[] = [{ label: 'Lot', image: 'https://example.test/a.png") ; position: fixed' }];
    await render(<template><AgentQuestion @question='Which lot?' @choices={{CHOICES}} /></template>);
    assert.dom('[data-test-pretui-agent-choice="Lot"]').doesNotHaveAttribute('style');
    assert.dom('[data-test-pretui-agent-choice-image]').hasAttribute('alt', '');
    assert.dom('[data-test-pretui-agent-choice-image]').hasAttribute('src', 'https://example.test/a.png") ; position: fixed');
  });
});
