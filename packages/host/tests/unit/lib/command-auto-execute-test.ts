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
      isAutoExecutableCommand(
        cmd(CHECK_CORRECTNESS_COMMAND_NAME, true),
        'ask',
        true,
      ),
      'checkCorrectness in ask mode with requiresApproval=true still auto-executes',
    );
    assert.true(
      isAutoExecutableCommand(
        cmd(CHECK_CORRECTNESS_COMMAND_NAME, true),
        undefined,
        true,
      ),
      'checkCorrectness with unknown mode still auto-executes',
    );
  });

  test('commands with requiresApproval=false auto-execute', function (assert) {
    assert.true(
      isAutoExecutableCommand(cmd('searchCard', false), 'ask', true),
      'requiresApproval=false bypasses approval even in ask mode',
    );
  });

  test('act mode auto-executes commands that would otherwise require approval', function (assert) {
    assert.true(
      isAutoExecutableCommand(cmd('patchCardInstance', true), 'act', true),
      'patchCardInstance in act mode auto-executes',
    );
  });

  test('ask mode with requiresApproval=true does not auto-execute', function (assert) {
    assert.false(
      isAutoExecutableCommand(cmd('patchCardInstance', true), 'ask', true),
      'manual approval is required in ask mode',
    );
    assert.false(
      isAutoExecutableCommand(cmd('patchCardInstance', true), undefined, true),
      'manual approval is required when mode is unknown',
    );
  });

  test('commands owned by another agent never auto-execute', function (assert) {
    // Mirrors the agentId gate in command-service.drainCommandProcessingQueue:
    // a command whose message came from a different agent must not auto-run
    // on this host, even if it would otherwise satisfy one of the auto-exec
    // branches. UI callers rely on this so the manual approval bar / per-
    // command Apply button stay clickable for non-current-agent commands.
    assert.false(
      isAutoExecutableCommand(
        cmd(CHECK_CORRECTNESS_COMMAND_NAME, true),
        'act',
        false,
      ),
      'checkCorrectness from another agent does not auto-execute',
    );
    assert.false(
      isAutoExecutableCommand(cmd('searchCard', false), 'act', false),
      'requiresApproval=false from another agent does not auto-execute',
    );
    assert.false(
      isAutoExecutableCommand(cmd('patchCardInstance', true), 'act', false),
      'act mode from another agent does not auto-execute',
    );
  });
});
