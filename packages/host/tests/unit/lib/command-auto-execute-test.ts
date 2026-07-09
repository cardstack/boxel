import { module, test } from 'qunit';

import {
  CHECK_CORRECTNESS_COMMAND_NAME,
  isAutoExecutableCommand,
} from '@cardstack/host/lib/tool-auto-execute';

type AutoExecCommandInput = Parameters<typeof isAutoExecutableCommand>[0];

function cmd(
  name: string | undefined,
  requiresApproval = true,
  executedBy: string | undefined = undefined,
): AutoExecCommandInput {
  return { name, requiresApproval, executedBy };
}

module('Unit | Lib | tool-auto-execute', function () {
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

  test('commands already executed by a server-side actor never auto-execute', function (assert) {
    // readRealmFile and friends are run by ai-bot itself; the host records them
    // in the timeline but must never execute them, even in act mode or with
    // requiresApproval=false.
    assert.false(
      isAutoExecutableCommand(
        cmd('readRealmFile', false, 'ai-bot'),
        'act',
        true,
      ),
      'executedBy overrides requiresApproval=false',
    );
    assert.false(
      isAutoExecutableCommand(
        cmd('readRealmFile', true, 'ai-bot'),
        'act',
        true,
      ),
      'executedBy overrides act mode',
    );
  });

  test('a non-ai-bot executor is not treated as bot-executed', function (assert) {
    // The guard matches ai-bot's own executor explicitly, not any value — a
    // command executed by the host (or any other actor) is evaluated normally.
    assert.true(
      isAutoExecutableCommand(
        cmd('patchCardInstance', true, 'host'),
        'act',
        true,
      ),
      "executedBy: 'host' does not short-circuit; act mode still auto-executes",
    );
  });

  test('commands owned by another agent never auto-execute', function (assert) {
    // Mirrors the agentId gate in tool-service.drainCommandProcessingQueue:
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
