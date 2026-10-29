import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import AskUserPicker from '@cardstack/host/components/matrix/ask-user-picker';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | AskUserPicker', function (hooks) {
  setupRenderingTest(hooks);

  test('a recommendation with a blank confidence reads as the default', async function (assert) {
    let options = [
      { label: 'Teal', confidence: '' },
      { label: 'Coral', confidence: ' ' },
    ];
    let onAnswer = () => undefined;
    await render(
      <template>
        <AskUserPicker
          @question='Which accent?'
          @kind='recommend'
          @options={{options}}
          @onAnswer={{onAnswer}}
        />
      </template>,
    );
    assert.dom('[data-test-ask-user]').exists();
    assert.dom('[data-test-ask-user]').containsText('High confidence');
  });
});
