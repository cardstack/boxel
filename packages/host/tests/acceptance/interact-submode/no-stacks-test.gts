import { click, fillIn } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  setupRealmCacheTeardown,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupInteractSubmodeTests } from '../../helpers/interact-submode-setup';

module('Acceptance | interact submode | no stacks tests', function (hooks) {
  setupInteractSubmodeTests(hooks, {
    setRealm() {},
  });

  module('0 stacks', function (hooks) {
    // The helper's realm-building beforeEach runs for these tests too, and
    // caches under this module's name, which the outer prefix cannot match.
    setupRealmCacheTeardown(hooks);

    test('Clicking card in search panel opens card on a new stack', async function (assert) {
      await visitOperatorMode({});

      assert.dom('[data-test-operator-mode-stack]').doesNotExist();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await fillIn('[data-test-search-field]', 'Mango');

      assert.dom('[data-test-search-sheet]').hasClass('results'); // Search open

      // Click on search result
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      // Search closed

      // The card appears on a new stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Mango');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
      assert.dom('[data-test-open-search-field]').hasValue('');
    });

    test('Can search for an index card by URL (without "index" in path)', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');

      await fillIn('[data-test-search-field]', testRealmURL);

      assert
        .dom('[data-test-search-label]')
        .includesText('1 result from 1 realm');
      assert
        .dom(
          '[data-test-search-result="http://test-realm/test/index"], [data-test-card="http://test-realm/test/index"]',
        )
        .exists({ count: 1 });
    });

    test('Can open a recent card in empty stack', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', `${testRealmURL}person-entry`);

      await click('[data-test-card="http://test-realm/test/person-entry"]');

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .containsText('http://test-realm/test/person');

      // Close the card, find it in recent cards, and reopen it
      await click(
        `[data-test-stack-card="${testRealmURL}person-entry"] [data-test-close-button]`,
      );

      await click('[data-test-open-search-field]');
      // The search persists across close/reopen, so reopening restores the
      // results view (with the URL search) rather than a blank prompt.
      assert.dom('[data-test-search-sheet]').hasClass('results');

      await click(`[data-test-card="${testRealmURL}person-entry"]`);

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .exists();
    });
  });
});
