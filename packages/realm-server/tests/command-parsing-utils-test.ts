import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import commandParsingTests from '@cardstack/runtime-common/tests/command-parsing-utils-test';

module(basename(__filename), function () {
  module('command parsing utils', function () {
    test('parseBoxelHostCommandSpecifier parses scoped command specifier', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('parseBoxelHostCommandSpecifier rejects unscoped command specifier', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('parseBoxelHostCommandSpecifier rejects specifier without export name', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('parseBoxelHostCommandSpecifier rejects query/hash forms', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('requires explicit export for cardstack/boxel-host command specifier', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('parses cardstack/boxel-host command specifier with explicit export', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('parses absolute /commands URL into realm code ref', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('parses absolute /commands URL without export into default export', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('rejects nested /commands paths', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('rejects traversal-like command segments', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('rejects extra path segments beyond command and export', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });

    test('returns undefined for unknown command formats', async function (assert) {
      await runSharedTest(commandParsingTests, assert, {});
    });
  });
});
