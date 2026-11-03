// Pretui — Chip / StatusChip unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Chip } from './chip';
import { StatusChip } from './status-chip';

function chip(): HTMLElement {
  return document.querySelector('[data-test-pretui-chip]') as HTMLElement;
}

module('Pretui | components/chip', function (hooks) {
  setupCardTest(hooks);

  test('defaults to outlined', async function (assert) {
    await render(<template><Chip @label='draft' /></template>);
    assert.strictEqual(chip().dataset['appearance'], 'outlined');
  });

  test('takes soft', async function (assert) {
    await render(
      <template>
        <Chip @label='live' @tone='success' @appearance='soft' />
      </template>,
    );
    assert.strictEqual(chip().dataset['appearance'], 'soft');
    assert.strictEqual(chip().dataset['tone'], 'success');
  });

  test('plain keeps the dot even when @dot is false', async function (assert) {
    await render(
      <template>
        <Chip @label='screening' @appearance='plain' @dot={{false}} />
      </template>,
    );
    assert.strictEqual(chip().dataset['appearance'], 'plain');
    assert.dom('[data-test-pretui-chip-dot]').exists();
  });

  test('StatusChip forwards appearance and dot', async function (assert) {
    await render(
      <template>
        <StatusChip @value='offer' @appearance='soft' @dot={{false}} />
      </template>,
    );
    assert
      .dom('[data-test-pretui-status-chip]')
      .hasAttribute('data-appearance', 'soft');
    assert.dom('[data-test-pretui-chip-dot]').doesNotExist();
  });
});
