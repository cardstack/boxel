import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import automationScheduleTests from '@cardstack/runtime-common/tests/automation-schedule-test';

module(basename(import.meta.filename), function () {
  for (let name of Object.keys(automationScheduleTests)) {
    test(name, async function (assert) {
      await runSharedTest(automationScheduleTests, assert, {});
    });
  }
});
