import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import collectGateDiagnosticsTests from '@cardstack/runtime-common/tests/collect-gate-diagnostics-test';

module(basename(import.meta.filename), function () {
  module('collectGateDiagnostics', function () {
    test('keeps a diagnostic in a checked file, with its elaboration', async function (assert) {
      await runSharedTest(collectGateDiagnosticsTests, assert, {});
    });

    test('drops a staged-source diagnostic into a warning that carries its elaboration', async function (assert) {
      await runSharedTest(collectGateDiagnosticsTests, assert, {});
    });

    test("drops the TS2353 'scoped' diagnostic but keeps another TS2353", async function (assert) {
      await runSharedTest(collectGateDiagnosticsTests, assert, {});
    });

    test('drops diagnostics outside the checked files without reading as a setup failure', async function (assert) {
      await runSharedTest(collectGateDiagnosticsTests, assert, {});
    });

    test("does not attach a dropped diagnostic's elaboration to the kept one before it", async function (assert) {
      await runSharedTest(collectGateDiagnosticsTests, assert, {});
    });

    test('reads a non-zero exit with no diagnostics as a silent setup failure', async function (assert) {
      await runSharedTest(collectGateDiagnosticsTests, assert, {});
    });
  });
});
