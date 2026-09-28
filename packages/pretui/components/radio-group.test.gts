// Pretui — RadioGroup unit tests. Imports from its own module rather than the
// './controls' barrel: the per-component test is the unit contract.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { RadioGroup } from './radio-group';
import type { RadioOption } from './radio-group';

const OPTIONS: RadioOption[] = [
  { value: 'green', label: 'Green' },
  { value: 'oolong', label: 'Oolong' },
  { value: 'puer', label: 'Pu-erh' },
];

function radios(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll('[data-test-pretui-radio-group] input[type="radio"]'),
  ) as HTMLInputElement[];
}
function checkedValue(): string | undefined {
  return radios().find((r) => r.checked)?.value;
}

module('Pretui | components/radio-group', function (hooks) {
  setupCardTest(hooks);

  test('is a radiogroup of native radios sharing one generated name', async function (assert) {
    await render(<template><RadioGroup @options={{OPTIONS}} /></template>);
    let group = document.querySelector('[data-test-pretui-radio-group]') as HTMLElement;
    assert.strictEqual(group.getAttribute('role'), 'radiogroup');
    let names = new Set(radios().map((r) => r.name));
    assert.strictEqual(names.size, 1, 'one name, so the browser gives the whole group one tab stop');
    assert.true([...names][0]?.length > 0, 'and it is generated, not left blank');
    assert.deepEqual(radios().map((r) => r.value), ['green', 'oolong', 'puer']);
    assert.strictEqual(checkedValue(), undefined, 'nothing preselected without a value');
  });

  test('two groups on one page do not share a name', async function (assert) {
    await render(
      <template>
        <RadioGroup @options={{OPTIONS}} />
        <RadioGroup @options={{OPTIONS}} />
      </template>,
    );
    let names = new Set(radios().map((r) => r.name));
    assert.strictEqual(names.size, 2, 'picking in one group must not clear the other');
  });

  test('runs uncontrolled from @defaultValue and reports each pick', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(
      <template><RadioGroup @options={{OPTIONS}} @defaultValue='oolong' @onValueChange={{record}} /></template>,
    );
    assert.strictEqual(checkedValue(), 'oolong');

    await click(radios()[2] as HTMLElement);
    assert.strictEqual(checkedValue(), 'puer', 'it moves itself');
    assert.deepEqual(seen, ['puer']);
  });

  test('a controlled group reports the request (the DOM drift is pinned below)', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(
      <template><RadioGroup @options={{OPTIONS}} @value='green' @onValueChange={{record}} /></template>,
    );
    await click(radios()[1] as HTMLElement);
    assert.deepEqual(seen, ['oolong'], 'the owner is told what was asked for');
  });

  test('KNOWN GAP: a controlled group that is not moved by its owner shows the wrong radio', async function (assert) {
    // `checked={{this.isOn option}}` is a property binding, and in controlled
    // mode `this.value` does not change on a click — so nothing re-renders and
    // the browser keeps the selection the user just made, which is no longer
    // the value the owner holds. A controlled RadioGroup whose owner declines
    // the change ends up visibly disagreeing with it. Pinned so the day this
    // is fixed the expectation fails and gets flipped, rather than the
    // behaviour changing unnoticed.
    const ignore = () => {};
    await render(
      <template><RadioGroup @options={{OPTIONS}} @value='green' @onValueChange={{ignore}} /></template>,
    );
    await click(radios()[1] as HTMLElement);
    assert.strictEqual(checkedValue(), 'oolong', 'the DOM drifted away from @value');
  });

  test('notifies through the @onChange alias as well', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><RadioGroup @options={{OPTIONS}} @onChange={{record}} /></template>);
    await click(radios()[0] as HTMLElement);
    assert.deepEqual(seen, ['green']);
  });

  test('fires each listener once when both notify names are wired', async function (assert) {
    let seen: string[] = [];
    const a = (v: string) => seen.push(`a:${v}`);
    const b = (v: string) => seen.push(`b:${v}`);
    await render(
      <template><RadioGroup @options={{OPTIONS}} @onValueChange={{a}} @onChange={{b}} /></template>,
    );
    await click(radios()[0] as HTMLElement);
    assert.deepEqual(seen, ['a:green', 'b:green'], 'both, in order, neither doubled');
  });

  test('takes its collection from the @items alias', async function (assert) {
    await render(<template><RadioGroup @items={{OPTIONS}} /></template>);
    assert.strictEqual(radios().length, 3);
  });

  test('renders nothing rather than throwing when no collection is given', async function (assert) {
    await render(<template><RadioGroup /></template>);
    assert.ok(document.querySelector('[data-test-pretui-radio-group]'), 'the group still exists');
    assert.strictEqual(radios().length, 0);
  });

  test('disables the whole group, and a single option on its own', async function (assert) {
    const MIXED: RadioOption[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
    ];
    await render(<template><RadioGroup @options={{MIXED}} /></template>);
    assert.deepEqual(radios().map((r) => r.disabled), [false, true]);

    await render(<template><RadioGroup @options={{MIXED}} @disabled={{true}} /></template>);
    assert.deepEqual(radios().map((r) => r.disabled), [true, true], 'the group wins over the option');
  });

  test('accepts the @isDisabled alias', async function (assert) {
    await render(<template><RadioGroup @options={{OPTIONS}} @isDisabled={{true}} /></template>);
    assert.deepEqual(radios().map((r) => r.disabled), [true, true, true]);
  });

  test('labels each radio so the text is a click target', async function (assert) {
    await render(<template><RadioGroup @options={{OPTIONS}} /></template>);
    let labels = Array.from(document.querySelectorAll('.pretui-choice')) as HTMLElement[];
    assert.deepEqual(labels.map((l) => l.textContent?.trim()), ['Green', 'Oolong', 'Pu-erh']);
    assert.strictEqual(labels[0]?.tagName, 'LABEL', 'wrapping, so no for/id pairing to get wrong');
  });
});
