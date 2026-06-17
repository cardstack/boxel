import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import queryMatchesFilterTests from '@cardstack/runtime-common/tests/query-matches-filter-test';

module(basename(import.meta.filename), function () {
  module('MatchesFilter', function () {
    test('isMatchesFilter returns true for a MatchesFilter', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('isMatchesFilter returns true for a MatchesFilter with on', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('isMatchesFilter accepts empty string', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('isMatchesFilter returns false for other filter types', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('isMatchesFilter does not confuse matches with other guards', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('assertQuery accepts a top-level MatchesFilter', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('assertQuery accepts MatchesFilter composed inside every', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('assertQuery accepts MatchesFilter composed inside any', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('assertQuery accepts MatchesFilter composed inside not', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('assertQuery accepts MatchesFilter nested with on/type', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });

    test('assertQuery rejects non-string matches value', async function (assert) {
      await runSharedTest(queryMatchesFilterTests, assert, {});
    });
  });
});
