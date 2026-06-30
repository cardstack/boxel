import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import {
  buildReadRealmFileFollowup,
  readRealmFileCommandRequests,
  fileReadResultContent,
} from '../lib/read-realm-file-loop.ts';
import { READ_REALM_FILE_TOOL_NAME } from '../lib/read-realm-file.ts';
import {
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

const ON_BEHALF_OF = '@user:localhost';
const REALM = 'https://localhost:4201/user/jane/';
const FILE_URL =
  'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md';

function assistantMessage(toolCalls: any[]): any {
  return { role: 'assistant', content: null, tool_calls: toolCalls };
}

function readRealmFileCall(id: string, args: object) {
  return {
    id,
    type: 'function',
    function: {
      name: READ_REALM_FILE_TOOL_NAME,
      arguments: JSON.stringify(args),
    },
  };
}

function deps(body = 'FILE BODY') {
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

module('buildReadRealmFileFollowup', () => {
  test('returns nothing when the message made no tool calls', async () => {
    let d = deps();
    let out = await buildReadRealmFileFollowup(assistantMessage([]), d);
    assert.deepEqual(out.messages, []);
    assert.deepEqual(out.outcomes, []);
  });

  test('runs readRealmFile calls and returns assistant turn + one tool result each', async () => {
    let d = deps('# Trip Planner');
    let msg = assistantMessage([
      readRealmFileCall('c1', { realm: REALM, url: FILE_URL }),
    ]);
    let out = await buildReadRealmFileFollowup(msg, d);

    assert.strictEqual(
      out.messages.length,
      2,
      'assistant message + one tool result',
    );
    assert.strictEqual(
      out.messages[0],
      msg,
      'assistant turn is preserved first',
    );
    assert.strictEqual((out.messages[1] as any).role, 'tool');
    assert.strictEqual((out.messages[1] as any).tool_call_id, 'c1');
    assert.strictEqual((out.messages[1] as any).content, '# Trip Planner');
    assert.strictEqual(out.outcomes.length, 1);
    assert.strictEqual(out.outcomes[0].commandRequestId, 'c1');
    assert.true(out.outcomes[0].ok, 'a successful read is reported ok');
    assert.deepEqual(d.calls, [{ onBehalfOf: ON_BEHALF_OF, realm: REALM }]);
  });

  test('does not loop when host-dispatched tool calls are mixed in', async () => {
    let d = deps();
    let msg = assistantMessage([
      readRealmFileCall('c1', { realm: REALM, url: FILE_URL }),
      {
        id: 'c2',
        type: 'function',
        function: { name: 'SomeHostCommand', arguments: '{}' },
      },
    ]);
    let out = await buildReadRealmFileFollowup(msg, d);
    assert.deepEqual(
      out.messages,
      [],
      'leaves the turn to the normal command path',
    );
    assert.strictEqual(d.calls.length, 0, 'no file fetched');
  });

  test('reports a failed outcome for malformed arguments', async () => {
    let d = deps();
    let msg = assistantMessage([
      {
        id: 'c1',
        type: 'function',
        function: {
          name: READ_REALM_FILE_TOOL_NAME,
          arguments: '{not json',
        },
      },
    ]);
    let out = await buildReadRealmFileFollowup(msg, d);
    assert.strictEqual(out.messages.length, 2);
    assert.true(
      (out.messages[1] as any).content.startsWith('Error:'),
      'tool result carries an error the model can read',
    );
    assert.false(out.outcomes[0].ok, 'outcome is marked failed');
  });

  test('exposes read files as ai-bot-executed command requests', async () => {
    let msg = assistantMessage([
      readRealmFileCall('c1', { realm: REALM, url: FILE_URL }),
    ]);
    let requests = readRealmFileCommandRequests(msg);
    assert.strictEqual(
      requests.length,
      1,
      'the readRealmFile call is recorded',
    );
    assert.strictEqual(requests[0].id, 'c1');
    assert.strictEqual(requests[0].name, READ_REALM_FILE_TOOL_NAME);
    assert.strictEqual(
      requests[0].executedBy,
      'ai-bot',
      'tagged so the host records but skips it',
    );
    assert.strictEqual(requests[0].arguments!.realm, REALM);
    assert.strictEqual(requests[0].arguments!.url, FILE_URL);
    assert.strictEqual(
      requests[0].arguments!.description,
      'Read file: trip-planner/SKILL.md',
      'the marker carries a human label derived from the url',
    );
  });

  test('records nothing when readRealmFile is mixed with a host command', async () => {
    // Mirrors buildReadRealmFileFollowup: a mixed turn is left to the command
    // path, so no marker is emitted (and no file is read in-process).
    let msg = assistantMessage([
      readRealmFileCall('c1', { realm: REALM, url: FILE_URL }),
      {
        id: 'c2',
        type: 'function',
        function: { name: 'SomeHostCommand', arguments: '{}' },
      },
    ]);
    assert.deepEqual(readRealmFileCommandRequests(msg), []);
  });

  test('a successful read resolves its marker to applied', () => {
    let content = fileReadResultContent({
      commandRequestId: 'c1',
      markerEventId: '$marker:localhost',
      ok: true,
      agentId: 'agent-1',
    });
    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(content.commandRequestId, 'c1');
    assert.strictEqual(content.failureReason, undefined);
    assert.deepEqual(content['m.relates_to'], {
      event_id: '$marker:localhost',
      key: 'applied',
      rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    });
  });

  test('a failed read resolves its marker to invalid with the reason', () => {
    let content = fileReadResultContent({
      commandRequestId: 'c1',
      markerEventId: '$marker:localhost',
      ok: false,
      failureReason: 'could not load SKILL.md (HTTP 404)',
      agentId: 'agent-1',
    });
    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.strictEqual(
      content.failureReason,
      'could not load SKILL.md (HTTP 404)',
      'the reason rides along so the user sees why it failed',
    );
  });

  test('feeds a fetch failure back as an error tool result', async () => {
    let d = deps();
    d.fetch = (async () =>
      new Response('nope', {
        status: 404,
      })) as unknown as typeof globalThis.fetch;
    let msg = assistantMessage([
      readRealmFileCall('c1', { realm: REALM, url: FILE_URL }),
    ]);
    let out = await buildReadRealmFileFollowup(msg, d);
    assert.true((out.messages[1] as any).content.includes('404'));
    assert.false(out.outcomes[0].ok, 'a 404 read is reported as failed');
  });
});
