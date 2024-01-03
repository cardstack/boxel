import { visit } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import { module, test } from 'qunit';

module('Acceptance | Freestyle', function (hooks) {
  setupApplicationTest(hooks);

  test('smoke check', async function (assert) {
    await visit('/_freestyle');
    assert.dom('h2.FreestyleUsage-name').containsText('AiAssistant::Message');
  });
});
