import { module, test } from 'qunit';

import {
  CHECK_CORRECTNESS_COMMAND_NAME,
  isAutoExecutableCommand,
} from '@cardstack/host/lib/command-auto-execute';

type AutoExecCommandInput = Parameters<typeof isAutoExecutableCommand>[0];

function cmd(
  name: string | undefined,
  requiresApproval = true,
): AutoExecCommandInput {
  return { name, requiresApproval };
}

module('Unit | Lib | command-auto-execute', function () {
  test('check-correctness commands auto-execute regardless of mode or approval flag', function (assert) {
    assert.true(
      isAutoExecutableCommand(cmd(CHECK_CORRECTNESS_COMMAND_NAME, true), 'ask'),
      'checkCorrectness in ask mode with requiresApproval=true still auto-executes',
    );
    assert.true(
      isAutoExecutableCommand(
        cmd(CHECK_CORRECTNESS_COMMAND_NAME, true),
        undefined,
      ),
      'checkCorrectness with unknown mode still auto-executes',
    );
  });

  test('commands with requiresApproval=false auto-execute', function (assert) {
    assert.true(
      isAutoExecutableCommand(cmd('searchCard', false), 'ask'),
      'requiresApproval=false bypasses approval even in ask mode',
    );
  });

  test('act mode auto-executes commands that would otherwise require approval', function (assert) {
    assert.true(
      isAutoExecutableCommand(cmd('patchCardInstance', true), 'act'),
      'patchCardInstance in act mode auto-executes',
    );
  });

  test('ask mode with requiresApproval=true does not auto-execute', function (assert) {
    assert.false(
      isAutoExecutableCommand(cmd('patchCardInstance', true), 'ask'),
      'manual approval is required in ask mode',
    );
    assert.false(
      isAutoExecutableCommand(cmd('patchCardInstance', true), undefined),
      'manual approval is required when mode is unknown',
    );
  });
});
