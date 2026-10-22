// Pretui — NativeSelect unit tests. The component is a closed face over a
// real <select>, so what it controls is the select's attributes, the
// placeholder option, the value in both modes and the change callbacks; the
// open list is the platform's and is not asserted.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness.
import { module, test } from 'qunit';
import { render, select, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { NativeSelect } from './native-select';

const GRADES = [
  { value: 'fop', label: 'FOP' },
  { value: 'pekoe', label: 'Pekoe' },
  { value: 'fannings', label: 'Fannings' },
];

class Sink {
  @tracked last: string | undefined;
  @tracked count = 0;
  take = (value: string) => {
    this.last = value;
    this.count++;
  };
}

class Owner {
  @tracked value = 'pekoe';
}

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-native-select]') as HTMLElement;
}
function control(): HTMLSelectElement {
  return document.querySelector('[data-test-pretui-native-select] select') as HTMLSelectElement;
}

module('Pretui | components/native-select', function (hooks) {
  setupCardTest(hooks);

  test('NativeSelect is a real <select> and ...attributes reach it', async function (assert) {
    await render(
      <template>
        <NativeSelect @options={{GRADES}} @label='Leaf grade' @controlId='grade' data-lot='7' />
      </template>,
    );
    let el = control();
    assert.strictEqual(el.tagName, 'SELECT');
    assert.strictEqual(el.getAttribute('data-lot'), '7', 'attributes land on the select, not the wrapper');
    assert.strictEqual(el.id, 'grade', '@controlId is the id a <label for> points at');
    assert.strictEqual(el.getAttribute('aria-label'), 'Leaf grade');
    assert.strictEqual(el.querySelectorAll('option').length, 3, 'one option per entry');
    assert.strictEqual(root().dataset['size'], 'm', 'the default size');
  });

  test('NativeSelect placeholder is a disabled option selected while empty, and data-empty follows the value', async function (assert) {
    await render(
      <template>
        <NativeSelect @options={{GRADES}} @placeholder='Choose a grade' />
      </template>,
    );
    let first = control().options[0] as HTMLOptionElement;
    assert.true(first.disabled, 'the placeholder cannot be re-chosen');
    assert.strictEqual(first.value, '', 'the placeholder has no value');
    assert.true(first.selected, 'it is the selected option while nothing is chosen');
    assert.strictEqual(root().dataset['empty'], 'true');

    await select(control(), 'fop');
    assert.strictEqual(root().dataset['empty'], 'false', 'a chosen value leaves the empty state');
    assert.strictEqual(control().value, 'fop');
  });

  test('NativeSelect without a placeholder shows its first option as the value, not as empty', async function (assert) {
    await render(<template><NativeSelect @options={{GRADES}} /></template>);
    assert.strictEqual(control().value, 'fop', 'the platform selects the first option');
    assert.strictEqual(root().dataset['empty'], 'false', 'and the component agrees it is a real choice');
  });

  test('NativeSelect uncontrolled: @defaultValue seeds, a change moves the select and both callbacks fire with the string', async function (assert) {
    let change = new Sink();
    let valueChange = new Sink();
    await render(
      <template>
        <NativeSelect
          @options={{GRADES}}
          @defaultValue='pekoe'
          @onChange={{change.take}}
          @onValueChange={{valueChange.take}}
        />
      </template>,
    );
    assert.strictEqual(control().value, 'pekoe', '@defaultValue seeds the selection');
    await select(control(), 'fannings');
    assert.strictEqual(control().value, 'fannings');
    assert.strictEqual(change.last, 'fannings', '@onChange receives the value as a string');
    assert.strictEqual(valueChange.last, 'fannings', '@onValueChange receives the same value');
  });

  test('NativeSelect controlled: @value wins and follows the owner', async function (assert) {
    let owner = new Owner();
    let sink = new Sink();
    await render(
      <template>
        <NativeSelect @options={{GRADES}} @value={{owner.value}} @onChange={{sink.take}} />
      </template>,
    );
    assert.strictEqual(control().value, 'pekoe');
    await select(control(), 'fop');
    assert.strictEqual(sink.last, 'fop', 'the owner is told');
    assert.strictEqual(control().value, 'pekoe', 'the select shows the owner value until the owner moves it');
    owner.value = 'fannings';
    await settled();
    assert.strictEqual(control().value, 'fannings', 'the owner decides the selection');
  });

  test('NativeSelect disabled, required, invalid and size reach the DOM', async function (assert) {
    await render(
      <template>
        <NativeSelect @options={{GRADES}} @disabled={{true}} @required={{true}} @invalid={{true}} @size='xs' />
      </template>,
    );
    assert.true(control().disabled);
    assert.true(control().required);
    assert.strictEqual(control().getAttribute('aria-invalid'), 'true');
    assert.strictEqual(root().dataset['invalid'], 'true');
    assert.strictEqual(root().dataset['size'], 'xs');
  });

  test('NativeSelect accepts the React Aria spellings', async function (assert) {
    await render(
      <template>
        <NativeSelect @items={{GRADES}} @isDisabled={{true}} @isRequired={{true}} @isInvalid={{true}} />
      </template>,
    );
    assert.strictEqual(control().querySelectorAll('option').length, 3, '@items is @options');
    assert.true(control().disabled, 'isDisabled → disabled');
    assert.true(control().required, 'isRequired → required');
    assert.strictEqual(control().getAttribute('aria-invalid'), 'true', 'isInvalid → aria-invalid');
  });

  test('NativeSelect yields into the select in place of @options', async function (assert) {
    await render(
      <template>
        <NativeSelect @options={{GRADES}} @placeholder='Pick'>
          <optgroup label='Whole leaf'>
            <option value='fop'>FOP</option>
          </optgroup>
          <option value='dust'>Dust</option>
        </NativeSelect>
      </template>,
    );
    let el = control();
    assert.strictEqual(el.querySelectorAll('optgroup').length, 1, 'an optgroup is allowed');
    assert.strictEqual(el.querySelectorAll('option').length, 3, 'placeholder plus the two written options; @options is ignored');
    assert.notOk(el.querySelector('option[value="pekoe"]'), 'nothing from @options rendered');
  });
});
