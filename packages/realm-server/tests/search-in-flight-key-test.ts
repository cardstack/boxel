import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import searchInFlightKeyTests from '@cardstack/runtime-common/tests/search-in-flight-key-test';

module(basename(__filename), function () {
  module('searchInFlightKey', function () {
    test('same query + opts produce the same key', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('key is invariant under input property order', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('different filters produce different keys', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('different realm URLs produce different keys', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('different opts shapes produce different keys', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('undefined opts and empty-object opts produce different keys', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('different linkFields produce different keys', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });

    test('pagination differences produce different keys', async function (assert) {
      await runSharedTest(searchInFlightKeyTests, assert, {});
    });
  });
});
