import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import iconNotFoundMessageTests from '@cardstack/runtime-common/tests/icon-not-found-message-test';

module(basename(__filename), function () {
  module('iconNotFoundMessage', function () {
    test('translates a 403 from the production icon CDN', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });

    test('translates a 404 from the local icons server', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });

    test('ignores statuses other than 403/404', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });

    test('ignores non-icon module URLs', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });

    test('ignores icon-path requests that are not .js modules', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });

    test('ignores an empty icon name', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });

    test('ignores an unparseable URL', async function (assert) {
      await runSharedTest(iconNotFoundMessageTests, assert, {});
    });
  });
});
