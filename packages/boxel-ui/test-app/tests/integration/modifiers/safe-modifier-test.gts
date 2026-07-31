import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { safeModifier } from '@cardstack/boxel-ui/modifiers';

import { setupRenderingTest } from 'test-app/tests/helpers';

module('Integration | Modifier | safe-modifier', function (hooks) {
  setupRenderingTest(hooks);

  test('observe-size returns frozen data instead of the element', async function (assert) {
    let received: unknown;
    let receiveSize = (size: unknown) => (received = size);

    await render(
      <template>
        <div
          class='observed-box'
          {{safeModifier 'observe-size' receiveSize}}
        ></div>
        <style scoped>
          .observed-box {
            width: 120px;
            height: 40px;
          }
        </style>
      </template>,
    );

    let size = received as { height: number; width: number };
    assert.true(size.height > 0, 'reports a finite rendered height');
    assert.true(size.width > 0, 'reports a finite rendered width');
    assert.deepEqual(Object.keys(size).sort(), ['height', 'width']);
    assert.true(Object.isFrozen(received));
    assert.notOk(received instanceof Element, 'the DOM element never crosses');
  });

  test('focus is an allowlisted host operation', async function (assert) {
    await render(
      <template>
        <button type='button' {{safeModifier 'focus'}}>Focus target</button>
      </template>,
    );

    assert.dom('button').isFocused();
  });
});
