import QUnit from 'qunit';
const { module, test } = QUnit;
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import {
  escapeControlCharactersInStrings,
  parseLenientJson,
} from '../lib/lenient-json.ts';
import { toCommandRequest } from '../lib/matrix/response-publisher.ts';

module('toCommandRequest arguments', () => {
  let call = (args: string) =>
    ({
      id: 'call_1',
      type: 'function',
      function: { name: 'run-realm-code_6b92', arguments: args },
    }) as ChatCompletionMessageFunctionToolCall;

  test('a preview gets the raw text received so far, and no arguments', (assert) => {
    let request = toCommandRequest(call('{"attributes":{"code":"await rea'), {
      argumentsText: true,
    });
    assert.deepEqual(request.arguments, {});
    assert.strictEqual(
      request.argumentsText,
      '{"attributes":{"code":"await rea',
    );
    assert.strictEqual(request.argumentsError, undefined);
  });

  test('a preview of complete arguments has no raw text', (assert) => {
    let request = toCommandRequest(call('{"attributes":{"code":"x"}}'), {
      argumentsText: true,
    });
    assert.deepEqual(request.arguments, { attributes: { code: 'x' } });
    assert.strictEqual(request.argumentsText, undefined);
  });

  test('a finished call with invalid JSON is marked, not silently emptied', (assert) => {
    let request = toCommandRequest(call('{"attributes":{"code":"x"'), {
      finished: true,
    });
    assert.deepEqual(request.arguments, {});
    assert.ok(request.argumentsError, 'the parse error is carried');
  });

  test('a call still streaming is not marked', (assert) => {
    let request = toCommandRequest(call('{"attributes":{"code":"x"'));
    assert.deepEqual(request.arguments, {});
    assert.strictEqual(request.argumentsError, undefined);
    assert.strictEqual(request.argumentsText, undefined);
  });
});

module('lenient tool arguments', () => {
  // The shape Claude streamed in small pieces: raw newlines and a tab inside
  // the code string.
  let raw =
    '{"attributes": {\n  "realm": "https://localhost:4201/user/demo/",\n  "code": "await realm.fs.writeText(\'a.gts\', `line 1\n\tline 2`);"\n}}';

  test('raw control characters inside strings are escaped, not fatal', (assert) => {
    assert.throws(() => JSON.parse(raw));
    assert.deepEqual(parseLenientJson(raw), {
      attributes: {
        realm: 'https://localhost:4201/user/demo/',
        code: "await realm.fs.writeText('a.gts', `line 1\n\tline 2`);",
      },
    });
  });

  test('the finished call keeps its arguments instead of becoming {}', (assert) => {
    let request = toCommandRequest(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'run-realm-code_6b92', arguments: raw },
      } as ChatCompletionMessageFunctionToolCall,
      { finished: true },
    );
    assert.strictEqual(request.argumentsError, undefined);
    assert.strictEqual(
      request.arguments?.attributes?.realm,
      'https://localhost:4201/user/demo/',
    );
  });

  test('an extra closing brace after a complete call is dropped', (assert) => {
    // The ending Claude wrote on a long run-realm-code call: one `}` too many.
    let extra =
      '{"description": "Add a company field.", "attributes": {"code": "await realm.fs.replace(p, a, JSON.stringify(b, null, 2));\\n"}}}';
    assert.throws(() => JSON.parse(extra));
    assert.deepEqual(parseLenientJson(extra), {
      description: 'Add a company field.',
      attributes: {
        code: 'await realm.fs.replace(p, a, JSON.stringify(b, null, 2));\n',
      },
    });
    let request = toCommandRequest(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'run-realm-code_6b92', arguments: extra },
      } as ChatCompletionMessageFunctionToolCall,
      { finished: true },
    );
    assert.strictEqual(request.argumentsError, undefined);
    assert.strictEqual(request.arguments?.description, 'Add a company field.');
  });

  test('cut-off arguments and other trailing text are still errors', (assert) => {
    assert.throws(() => parseLenientJson('{"attributes":{"code":"x"}'));
    assert.throws(() => parseLenientJson('{"a":1}{"b":2}'));
    assert.throws(() => parseLenientJson('{"a":1} trailing'));
  });

  test('valid JSON and escaped sequences are left alone', (assert) => {
    assert.strictEqual(
      escapeControlCharactersInStrings('{"a": "x\\ny"}\n'),
      '{"a": "x\\ny"}\n',
    );
  });
});
