import { visit } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { setupSnapshotRealm } from '../helpers';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | Freestyle', function (hooks) {
  setupApplicationTest(hooks);
  let snapshot = setupSnapshotRealm(hooks, {
    acceptanceTest: true,
    async build() {
      return {};
    },
  });

  hooks.beforeEach(function () {
    snapshot.get();
  });

  test('smoke check', async function (assert) {
    await visit('/_freestyle');
    assert
      .dom('h2.FreestyleUsage-name')
      .containsText('AiAssistant::ApplyButton');
  });
});
