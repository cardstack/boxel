import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { render, settled } from '@ember/test-helpers';
import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

const OverrideIcon: TemplateOnlyComponent = <template>
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'>
    <text data-test-override-icon>hey</text>
  </svg>
</template>;

module('Integration | Component | InputGroup', function (hooks) {
  setupRenderingTest(hooks);

  test('renders override icon arguments', async function (assert) {
    class StateObject {
      @tracked state = 'valid';
      @tracked validIcon: TemplateOnlyComponent | undefined;
      @tracked invalidIcon: TemplateOnlyComponent | undefined;
    }

    let stateObject = new StateObject();

    await render(<template>
      <BoxelInputGroup
        @placeholder='InputGroup'
        @value='hello'
        @state={{stateObject.state}}
        @validIcon={{stateObject.validIcon}}
        @invalidIcon={{stateObject.invalidIcon}}
      />
    </template>);

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
});
