import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import automationDeclarationTests from '@cardstack/runtime-common/tests/automation-declaration-test';

module(basename(import.meta.filename), function () {
  for (let name of Object.keys(automationDeclarationTests)) {
    test(name, async function (assert) {
      await runSharedTest(automationDeclarationTests, assert, {});
    });
  }
});
