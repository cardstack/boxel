// Pretui — NumberInput unit tests. Imports from ./extras; when NumberInput moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { NumberInput } from './number-input';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function field(wrapper: string): HTMLInputElement {
  return q(`${wrapper} input`) as HTMLInputElement;
}

module('Pretui | components/number-input', function (hooks) {
  setupCardTest(hooks);

  test('NumberInput is a native number field with the numeric knobs on the control', async function (assert) {
    await render(
      <template><NumberInput @value={{5}} @min={{0}} @max={{10}} @step={{0.5}} @controlId='qty' /></template>,
    );
    let input = field('[data-test-pretui-number-input]');
    assert.strictEqual(input.type, 'number', 'spinners and the numeric keyboard come from the native type');
    assert.strictEqual(input.id, 'qty');
    assert.strictEqual(input.min, '0');
    assert.strictEqual(input.max, '10');
    assert.strictEqual(input.step, '0.5');
  });

  test('NumberInput says nothing about range when there is nothing to say', async function (assert) {
    await render(<template><NumberInput @value={{5}} /></template>);
    assert.strictEqual(
      q('[data-test-pretui-number-input]').dataset['rangeState'],
      'none',
      'no bounds means unjudged, which is not the same as valid',
    );

    await render(<template><NumberInput @min={{0}} @max={{10}} /></template>);
    assert.strictEqual(
      q('[data-test-pretui-number-input]').dataset['rangeState'],
      'none',
      'an empty field is unjudged too',
    );
  });

  test('NumberInput marks a value inside and outside its bounds', async function (assert) {
    await render(
      <template>
        <NumberInput @value={{5}} @min={{0}} @max={{10}} />
        <NumberInput @value={{99}} @min={{0}} @max={{10}} />
      </template>,
    );
    assert.deepEqual(
      all('[data-test-pretui-number-input]').map((el) => el.dataset['rangeState']),
      ['valid', 'invalid'],
    );
  });

  test('NumberInput explains an out-of-range value instead of only dressing it red', async function (assert) {
    await render(<template><NumberInput @value={{99}} @min={{0}} @max={{10}} /></template>);
    assert.true(
      q('[data-test-pretui-number-input]').textContent?.includes('Enter a number between 0 and 10.'),
      'a bounded range names both ends',
    );

    await render(<template><NumberInput @value={{-1}} @min={{0}} /></template>);
    assert.true(q('[data-test-pretui-number-input]').textContent?.includes('Enter 0 or more.'));

    await render(<template><NumberInput @value={{99}} @max={{10}} /></template>);
    assert.true(q('[data-test-pretui-number-input]').textContent?.includes('Enter 10 or less.'));
  });

  test('NumberInput lets the caller reword the range message and override it entirely', async function (assert) {
    const wording = (min?: number, max?: number) => `Lots run ${min}–${max}.`;
    await render(
      <template><NumberInput @value={{99}} @min={{1}} @max={{12}} @rangeMessage={{wording}} /></template>,
    );
    assert.true(q('[data-test-pretui-number-input]').textContent?.includes('Lots run 1–12.'));

    await render(
      <template><NumberInput @value={{99}} @min={{1}} @max={{12}} @errorMessage='Ask the cupping panel.' /></template>,
    );
    assert.true(
      q('[data-test-pretui-number-input]').textContent?.includes('Ask the cupping panel.'),
      'a caller message wins over the derived one',
    );
  });

  test('NumberInput reports each keystroke as a number, and an empty field as null', async function (assert) {
    let seen: (number | null)[] = [];
    const onInput = (v: number | null) => seen.push(v);
    await render(<template><NumberInput @onInput={{onInput}} /></template>);
    let input = field('[data-test-pretui-number-input]');

    await fillIn(input, '7');
    assert.deepEqual(seen.at(-1), 7, 'a number, not the string "7"');

    await fillIn(input, '');
    assert.strictEqual(seen.at(-1), null, 'empty is null, never NaN');
  });

  test('NumberInput clamps and rounds on commit, not mid-keystroke', async function (assert) {
    let seen: (number | null)[] = [];
    const onInput = (v: number | null) => seen.push(v);
    await render(
      <template><NumberInput @min={{0}} @max={{10}} @precision={{1}} @onInput={{onInput}} /></template>,
    );
    let input = field('[data-test-pretui-number-input]');

    // `fillIn` fires input and then change, so the keystroke report and the
    // commit are both visible in one call — in that order.
    await fillIn(input, '99.456');
    assert.deepEqual(seen.at(-2), 99.456, 'the typed value is reported as typed, unclamped');
    assert.deepEqual(seen.at(-1), 10, 'and the commit clamps to the bound');
    assert.strictEqual(input.value, '10.0', 'the field shows the committed value at the stated precision');
  });

  test('NumberInput can report an out-of-range value rather than silently clamping it', async function (assert) {
    let seen: (number | null)[] = [];
    const onInput = (v: number | null) => seen.push(v);
    await render(
      <template><NumberInput @min={{0}} @max={{10}} @clamp={{false}} @onInput={{onInput}} /></template>,
    );
    await fillIn(field('[data-test-pretui-number-input]'), '99');
    assert.deepEqual(
      seen.at(-1),
      99,
      'a silent clamp tells the reader nothing about why their number changed',
    );
  });

  test('NumberInput rounds even with clamping off — precision is display, bounds are validity', async function (assert) {
    let seen: (number | null)[] = [];
    const onInput = (v: number | null) => seen.push(v);
    await render(<template><NumberInput @precision={{2}} @clamp={{false}} @onInput={{onInput}} /></template>);
    await fillIn(field('[data-test-pretui-number-input]'), '3.14159');
    assert.deepEqual(seen.at(-1), 3.14);
  });

  test('NumberInput wears the invalid dress on request regardless of range', async function (assert) {
    await render(<template><NumberInput @value={{5}} @min={{0}} @max={{10}} @isInvalid={{true}} /></template>);
    assert.strictEqual(
      q('[data-test-pretui-number-input]').dataset['rangeState'],
      'valid',
      'the range verdict is unchanged — the caller has a different reason',
    );
    assert.strictEqual(
      q('[data-test-pretui-number-input] input').getAttribute('aria-invalid'),
      'true',
      'and the caller flag still reaches the control through the resolved @state',
    );
  });
});
