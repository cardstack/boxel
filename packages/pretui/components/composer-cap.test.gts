// Pretui — ComposerCap unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ComposerCap } from './composer-cap';

module('Pretui | components/composer-cap', function (hooks) {
  setupCardTest(hooks);

  test('the status region holds the words, not the row with its buttons', async function (assert) {
    await render(<template>
      <ComposerCap as |cap|>
        <cap.Status @title='Generating results' @detail='3 calls'>
          <cap.Button @kind='primary' @glyph='stop'>Stop</cap.Button>
        </cap.Status>
      </ComposerCap>
    </template>);
    assert.dom('[data-test-pretui-cap-status]').doesNotHaveAttribute('role');
    assert.dom('[data-test-pretui-cap-status-text]').hasAttribute('role', 'status');
    assert.dom('[data-test-pretui-cap-status-text]').hasAttribute('aria-atomic', 'true');
    assert.dom('[data-test-pretui-cap-status-text]').includesText('Generating results');
    assert.dom('[data-test-pretui-cap-status-text] button').doesNotExist('Stop is not re-announced');
  });
});
