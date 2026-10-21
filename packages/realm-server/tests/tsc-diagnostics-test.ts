import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import tscDiagnosticsTests from '@cardstack/runtime-common/tests/tsc-diagnostics-test';

module(basename(import.meta.filename), function () {
  module('parseTscDiagnostics', function () {
    test('reads captured ember-tsc output with its elaboration', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });

    test('reads a single-line diagnostic with no elaboration', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });

    test('gives each of two adjacent diagnostics only its own elaboration', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });

    test('stops at a non-indented line that is not a diagnostic', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });

    test('does not read an unlocated error as a diagnostic, and ends elaboration at it', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });

    test('keeps elaboration across blank lines', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });

    test('reads CRLF output without leaving a carriage return in the text', async function (assert) {
      await runSharedTest(tscDiagnosticsTests, assert, {});
    });
  });
});
