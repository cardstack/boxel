import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import type { Icon } from '@cardstack/boxel-ui/icons';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';

import { setupRenderingTest } from '#tests/helpers';

const OverrideIcon: Icon = <template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
    <text data-test-override-icon>hey</text>
  </svg>
</template>;

module('Integration | Component | InputGroup', function (hooks) {
  setupRenderingTest(hooks);

  test('renders override icon arguments', async function (assert) {
    class StateObject {
      @tracked state = 'valid';
      @tracked validIcon: Icon | undefined;
      @tracked invalidIcon: Icon | undefined;
    }

    let stateObject = new StateObject();

    await render(
      <template>
        <BoxelInputGroup
          @placeholder="InputGroup"
          @value="hello"
          @state={{stateObject.state}}
          @validIcon={{stateObject.validIcon}}
          @invalidIcon={{stateObject.invalidIcon}}
        />
      </template>,
    );

    assert.dom('[data-test-override-icon]').doesNotExist();

    stateObject.validIcon = OverrideIcon;
    await settled();

    assert.dom('[data-test-override-icon]').exists();

    stateObject.validIcon = undefined;
    await settled();

    assert.dom('[data-test-override-icon]').doesNotExist();

    stateObject.invalidIcon = OverrideIcon;
    stateObject.state = 'invalid';
    await settled();

    assert.dom('[data-test-override-icon]').exists();
  });

  test('forwards the @name arg to the inner input element', async function (assert) {
    await render(
      <template><BoxelInputGroup @name="username" @value="" /></template>,
    );

    assert.dom('input').hasAttribute('name', 'username');
  });
});
