import { visit } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | Freestyle', function (hooks) {
  setupApplicationTest(hooks);

  test('smoke check', async function (assert) {
    await visit('/_freestyle');
    assert
      .dom('h2.FreestyleUsage-name')
      .containsText('AiAssistant::ApplyButton');
  });
});
