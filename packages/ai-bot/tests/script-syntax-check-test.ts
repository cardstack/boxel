import QUnit from 'qunit';
const { module, test } = QUnit;
import type { ChatCompletionMessageToolCall } from 'openai/resources';
import {
  scriptSyntaxError,
  scriptSyntaxRetryMessages,
} from '../lib/script-syntax-check.ts';
import ResponseState from '../lib/response-state.ts';

function runRealmCodeCall(id: string, code: string) {
  return {
    id,
    type: 'function',
    function: {
      name: 'run-realm-code_6b92',
      arguments: JSON.stringify({
        description: 'Write the file',
        attributes: { code },
      }),
    },
  } as ChatCompletionMessageToolCall;
}

const unescapedBacktick = [
  "await realm.fs.writeText('swim.gts', `import { CardDef } from '@cardstack/base/card-api';",
  'let title = `Swim`;',
  '`);',
].join('\n');

module('script syntax check', () => {
  test('a script that parses has no error', (assert) => {
    assert.strictEqual(
      scriptSyntaxError(
        "let text = await realm.fs.readText('a.gts');\nreturn text.length;",
      ),
      undefined,
    );
  });

  test('a backtick inside a template literal is described as the host worker describes it', (assert) => {
    let error = scriptSyntaxError(unescapedBacktick);
    assert.ok(error?.startsWith('SyntaxError in the script at line 1: '));
    assert.ok(
      error?.includes("> 1 | await realm.fs.writeText('swim.gts', `import"),
      'the excerpt marks the line the error points at',
    );
    assert.ok(
      error?.includes('a backtick or ${ in that content ends the string'),
    );
  });

  test('a reply whose scripts all parse is not handed back', (assert) => {
    assert.strictEqual(
      scriptSyntaxRetryMessages('Writing it.', [
        runRealmCodeCall('call-1', 'return 1;'),
      ]),
      undefined,
    );
  });

  test('arguments that are not JSON are left to the host', (assert) => {
    assert.strictEqual(
      scriptSyntaxRetryMessages('', [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'run-realm-code_6b92',
            arguments: '{"attributes":{"code":"let x = `',
          },
        },
      ]),
      undefined,
    );
  });

  test("a reply with a script that doesn't parse is handed back with a result for every call", (assert) => {
    let calls = [
      runRealmCodeCall('call-1', unescapedBacktick),
      {
        id: 'call-2',
        type: 'function',
        function: { name: 'showCard_1234', arguments: '{}' },
      } as ChatCompletionMessageToolCall,
    ];
    let messages = scriptSyntaxRetryMessages('Writing it.', calls);
    assert.strictEqual(messages?.length, 3);
    assert.strictEqual(messages?.[0].role, 'assistant');
    assert.strictEqual(messages?.[0].content, 'Writing it.');
    assert.deepEqual(
      messages?.[0].tool_calls?.map((call) => call.id),
      ['call-1', 'call-2'],
    );
    assert.strictEqual(messages?.[1].tool_call_id, 'call-1');
    assert.ok(
      (messages?.[1].content as string).includes(
        'SyntaxError in the script at line 1',
      ),
    );
    assert.strictEqual(messages?.[2].tool_call_id, 'call-2');
    assert.ok(
      (messages?.[2].content as string).startsWith(
        'Tool call not run: another script in this answer does not parse',
      ),
    );
  });
});

module('ResponseState.startNewReply', () => {
  test("the next reply drops the earlier reply's calls and keeps its content", (assert) => {
    let state = new ResponseState([]);
    state.setAllowedToolNames(['run-realm-code_6b92']);
    state.update(
      undefined,
      'Writing it.',
      [{ ...runRealmCodeCall('call:0', unescapedBacktick), index: 0 } as any],
      false,
    );
    assert.deepEqual(
      state.toolCalls.map((call) => call.id),
      ['call:0'],
    );

    state.startNewReply();
    assert.deepEqual(state.toolCalls, []);

    state.update(
      undefined,
      'Fixed the escaping.',
      [{ ...runRealmCodeCall('call:0', 'return 1;'), index: 0 } as any],
      false,
    );
    assert.strictEqual(
      state.latestContent,
      'Writing it.\n\nFixed the escaping.',
    );
    assert.deepEqual(
      state.toolCalls.map((call) => call.id),
      ['call:0_1'],
      'the new call does not reuse the id the earlier reply was given',
    );
  });
});
