import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRoutingValidationTests from '@cardstack/runtime-common/tests/host-routing-validation-test';

module(basename(import.meta.filename), function () {
  module('validateRoutingPath', function () {
    test('validateRoutingPath: no warning for empty or whitespace paths', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: warns when path is missing the leading slash', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: accepts paths in the unreserved character set', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: warns when path contains disallowed characters', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: accepts well-formed percent-encoded sequences', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: warns on malformed percent-encoded sequences', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: advises when the path has a trailing slash', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('validateRoutingPath: trims surrounding whitespace before validating', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });
  });

  module('findDuplicateRoutingPaths', function () {
    test('findDuplicateRoutingPaths: returns empty when there are no rules', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('findDuplicateRoutingPaths: returns empty when no paths repeat', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('findDuplicateRoutingPaths: reports each duplicate path exactly once', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('findDuplicateRoutingPaths: ignores empty paths so unfilled rules do not flag', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('findDuplicateRoutingPaths: treats surrounding whitespace as equivalent', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });

    test('findDuplicateRoutingPaths: treats trailing-slash variants as the same route', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });
  });

  module('normalizeRoutingPath', function () {
    test('normalizeRoutingPath: strips trailing slashes and preserves the root', async function (assert) {
      await runSharedTest(hostRoutingValidationTests, assert, {});
    });
  });
});
