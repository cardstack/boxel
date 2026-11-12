import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import automationAICostTests from '@cardstack/runtime-common/tests/automation-ai-cost-test';

module(basename(import.meta.filename), function () {
  for (let name of Object.keys(automationAICostTests)) {
    test(name, async function (assert) {
      await runSharedTest(automationAICostTests, assert, {});
    });
  }
});
