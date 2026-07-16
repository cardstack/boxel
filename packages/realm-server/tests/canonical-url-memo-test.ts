import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import canonicalUrlMemoTests from '@cardstack/runtime-common/tests/canonical-url-memo-test';

module(basename(import.meta.filename), function () {
  module('canonicalURL pass-scoped memo', function () {
    test('canonicalURL returns the same result with and without a memo', async function (assert) {
      await runSharedTest(canonicalUrlMemoTests, assert, {});
    });

    test('canonicalURL skips resolveURL on a memo hit', async function (assert) {
      await runSharedTest(canonicalUrlMemoTests, assert, {});
    });

    test('canonicalURL keys the memo on relativeTo', async function (assert) {
      await runSharedTest(canonicalUrlMemoTests, assert, {});
    });

    test('clearing the memo forces recomputation', async function (assert) {
      await runSharedTest(canonicalUrlMemoTests, assert, {});
    });
  });
});
