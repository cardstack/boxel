import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { buildLoadSkillFollowup } from '../lib/load-skill-loop.ts';
import { LOAD_SKILL_TOOL_NAME } from '../lib/load-skill.ts';

const ON_BEHALF_OF = '@user:localhost';
const REALM = 'https://localhost:4201/user/jane/';

function assistantMessage(toolCalls: any[]): any {
  return { role: 'assistant', content: null, tool_calls: toolCalls };
}

function loadSkillCall(id: string, args: object) {
  return {
    id,
    type: 'function',
    function: { name: LOAD_SKILL_TOOL_NAME, arguments: JSON.stringify(args) },
  };
}

function deps(body = 'SKILL BODY') {
  let calls: { onBehalfOf: string; realm: string }[] = [];
  return {
    calls,
    onBehalfOf: ON_BEHALF_OF,
    delegatedUserRealmSessions: {
      getToken: async (a: { onBehalfOf: string; realm: string }) => {
        calls.push(a);
        return 'tok';
      },
      invalidate: () => {},
    },
    fetch: (async () =>
      new Response(body, {
        status: 200,
      })) as unknown as typeof globalThis.fetch,
  };
}

module('buildLoadSkillFollowup', () => {
  test('returns [] when the message made no tool calls', async () => {
    let d = deps();
    let out = await buildLoadSkillFollowup(assistantMessage([]), d);
    assert.deepEqual(out, []);
  });

  test('runs loadSkill calls and returns assistant turn + one tool result each', async () => {
    let d = deps('# Trip Planner');
    let msg = assistantMessage([
      loadSkillCall('c1', { realm: REALM, name: 'trip-planner' }),
    ]);
    let out = await buildLoadSkillFollowup(msg, d);

    assert.strictEqual(out.length, 2, 'assistant message + one tool result');
    assert.strictEqual(out[0], msg, 'assistant turn is preserved first');
    assert.strictEqual((out[1] as any).role, 'tool');
    assert.strictEqual((out[1] as any).tool_call_id, 'c1');
    assert.strictEqual((out[1] as any).content, '# Trip Planner');
    assert.deepEqual(d.calls, [{ onBehalfOf: ON_BEHALF_OF, realm: REALM }]);
  });

  test('does not loop when host-dispatched tool calls are mixed in', async () => {
    let d = deps();
    let msg = assistantMessage([
      loadSkillCall('c1', { realm: REALM, name: 'trip-planner' }),
      {
        id: 'c2',
        type: 'function',
        function: { name: 'SomeHostCommand', arguments: '{}' },
      },
    ]);
    let out = await buildLoadSkillFollowup(msg, d);
    assert.deepEqual(out, [], 'leaves the turn to the normal command path');
    assert.strictEqual(d.calls.length, 0, 'no skill fetched');
  });

  test('reports an error result for malformed arguments', async () => {
    let d = deps();
    let msg = assistantMessage([
      {
        id: 'c1',
        type: 'function',
        function: { name: LOAD_SKILL_TOOL_NAME, arguments: '{not json' },
      },
    ]);
    let out = await buildLoadSkillFollowup(msg, d);
    assert.strictEqual(out.length, 2);
    assert.true(
      (out[1] as any).content.startsWith('Error:'),
      'tool result carries an error the model can read',
    );
  });

  test('feeds a fetch failure back as an error tool result', async () => {
    let d = deps();
    d.fetch = (async () =>
      new Response('nope', {
        status: 404,
      })) as unknown as typeof globalThis.fetch;
    let msg = assistantMessage([
      loadSkillCall('c1', { realm: REALM, name: 'missing' }),
    ]);
    let out = await buildLoadSkillFollowup(msg, d);
    assert.true((out[1] as any).content.includes('404'));
  });
});
