import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import sealedScopesTests from '@cardstack/runtime-common/tests/sealed-scopes-test';

module(basename(import.meta.filename), function () {
  module('a package resolves through its own map', function () {
    test('a pinned Version gets its sealed map as a scope', async function (assert) {
      await runSharedTest(sealedScopesTests, assert, {});
    });

    test('the walk is transitive and terminates', async function (assert) {
      await runSharedTest(sealedScopesTests, assert, {});
    });

    test('a range-spelled pin gets no scope', async function (assert) {
      await runSharedTest(sealedScopesTests, assert, {});
    });

    test('an unreachable sealed map costs only that Version', async function (assert) {
      await runSharedTest(sealedScopesTests, assert, {});
    });

    test('a realm may override one sealed entry', async function (assert) {
      await runSharedTest(sealedScopesTests, assert, {});
    });
  });
});
