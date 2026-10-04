// Pretui — Select unit tests: how the trigger is named.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Select } from './select';

const OPTIONS = [
  { value: 'green', label: 'Green' },
  { value: 'oolong', label: 'Oolong' },
];

function trigger(): HTMLElement {
  return document.querySelector('.pretui-selecttrigger') as HTMLElement;
}

module('Pretui | components/select', function (hooks) {
  setupCardTest(hooks);

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
