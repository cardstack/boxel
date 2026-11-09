// Pretui — Checkbox unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Checkbox } from './checkbox';
import { Field } from './field';

module('Pretui | components/checkbox', function (hooks) {
  setupCardTest(hooks);

  test('its block is the label, and a click on it ticks the box', async function (assert) {
    let seen: boolean[] = [];
    const record = (checked: boolean) => seen.push(checked);
    await render(
      <template>
        <Checkbox @onCheckedChange={{record}}>
          <strong data-test-text>Allow it</strong>
        </Checkbox>
      </template>,
    );
    assert.dom('[data-test-pretui-checkbox]').hasText('Allow it');
    await click('[data-test-text]');
    assert.deepEqual(seen, [true]);
    assert.dom('[data-test-pretui-checkbox] input').isChecked();
  });

  test('@controlId lets a Field label it', async function (assert) {
    await render(
      <template>
        <Field @label='Visitors' as |controlId|>
          <Checkbox @controlId={{controlId}} @label='Allow them' />
        </Field>
      </template>,
    );
    let input = document.querySelector('[data-test-pretui-checkbox] input') as HTMLInputElement;
    assert.deepEqual(
      Array.from(input.labels ?? []).map((l) => l.textContent?.trim()),
      ['Visitors', 'Allow them'],
      "named by the Field's label and its own",
    );
  });
});
