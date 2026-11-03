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

  test('defaults to outlined and rounded', async function (assert) {
    await render(<template><Chip @label='draft' /></template>);
    assert.strictEqual(chip().dataset['appearance'], 'outlined');
    assert.strictEqual(chip().dataset['shape'], 'rounded');
  });

  test('takes soft and pill', async function (assert) {
    await render(
      <template>
        <Chip @label='live' @tone='success' @appearance='soft' @shape='pill' />
      </template>,
    );
    assert.strictEqual(chip().dataset['appearance'], 'soft');
    assert.strictEqual(chip().dataset['shape'], 'pill');
    assert.strictEqual(chip().dataset['tone'], 'success');
  });

  test('StatusChip forwards appearance, shape and dot', async function (assert) {
    await render(
      <template>
        <StatusChip
          @value='offer'
          @appearance='soft'
          @shape='pill'
          @dot={{false}}
        />
      </template>,
    );
    assert
      .dom('[data-test-pretui-status-chip]')
      .hasAttribute('data-appearance', 'soft');
    assert
      .dom('[data-test-pretui-status-chip]')
      .hasAttribute('data-shape', 'pill');
    // the dot is the chip's only child element
    assert.strictEqual(chip().children.length, 0);
  });
});
