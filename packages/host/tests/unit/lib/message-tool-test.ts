import type Owner from '@ember/owner';

import { module, test } from 'qunit';

import type { Message } from '@cardstack/host/lib/matrix-classes/message';
import MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import { isAutoExecutableTool } from '@cardstack/host/lib/tool-auto-execute';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

// The click rule as act mode sees it: the tool class's per-call predicate,
// read through MessageTool from the arguments the model sent.
function runRealmCodeCall(args: Record<string, unknown>) {
  return new MessageTool(
    {} as Message,
    { id: 'call-1', name: 'run-realm-code_abcd', arguments: args },
    undefined,
    '$event',
    true,
    'Run',
    'ready',
    undefined,
    {} as Owner,
    undefined,
    false,
    RunRealmCodeTool.neverAutoExecutesFor,
  );
}

const deleteCode = `await realm.workspaces.delete('http://test-realm/testuser/old/');`;

module('Unit | Lib | message-tool', function () {
  test('a run-realm-code call that deletes a workspace does not auto-execute in act mode', function (assert) {
    let tool = runRealmCodeCall({ attributes: { code: deleteCode } });
    assert.true(tool.neverAutoExecutes);
    assert.false(isAutoExecutableTool(tool, 'act', true));
  });

  test('the click rule holds when the attributes arrive at the top level', function (assert) {
    let tool = runRealmCodeCall({ code: deleteCode });
    assert.true(tool.neverAutoExecutes);
    assert.false(isAutoExecutableTool(tool, 'act', true));
  });

  test('a run-realm-code call that does not delete keeps the room mode', function (assert) {
    let tool = runRealmCodeCall({
      attributes: { code: `await realm.fs.writeText('a.json', '{}');` },
    });
    assert.false(tool.neverAutoExecutes);
    assert.true(isAutoExecutableTool(tool, 'act', true));
  });
});
