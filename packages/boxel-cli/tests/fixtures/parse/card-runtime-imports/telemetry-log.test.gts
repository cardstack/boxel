import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';

// `@ember/test-helpers` is shimmed for card test code but ships
// separately from ember-source, so it only resolves when boxel-cli
// declares it.
module('telemetry log', function () {
  test('renders a heading', async function (assert) {
    await render(
      <template>
        <h2 class='source'>disk</h2>
      </template>,
    );
    assert.dom('.source').hasText('disk');
  });
});
