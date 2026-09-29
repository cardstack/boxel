import QUnit from 'qunit';
const { module, test } = QUnit;
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import {
  escapeControlCharactersInStrings,
  parseLenientJson,
  parsePartialJson,
} from '../lib/partial-json.ts';
import { toCommandRequest } from '../lib/matrix/response-publisher.ts';

module('parsePartialJson', () => {
  test('returns complete JSON unchanged', (assert) => {
    assert.deepEqual(parsePartialJson('{"a":[1,true,null]}'), {
      a: [1, true, null],
    });
  });

  test('keeps a string value that is still being written', (assert) => {
    assert.deepEqual(
      parsePartialJson(
        '{"description":"Build","attributes":{"code":"await realm.fs.writeText(\'a.gts\', \'line 1\\nli',
      ),
      {
        description: 'Build',
        attributes: { code: "await realm.fs.writeText('a.gts', 'line 1\nli" },
      },
    );
  });

  test('drops an escape sequence cut in half', (assert) => {
    assert.deepEqual(parsePartialJson('{"code":"a\\'), { code: 'a' });
    assert.deepEqual(parsePartialJson('{"code":"a\\u00'), { code: 'a' });
  });

  test('leaves out an incomplete key, number or literal', (assert) => {
    assert.deepEqual(parsePartialJson('{"a":1,"b'), { a: 1 });
    assert.deepEqual(parsePartialJson('{"a":1,"b":'), { a: 1 });
    assert.deepEqual(parsePartialJson('{"a":1,"b":12'), { a: 1 });
    assert.deepEqual(parsePartialJson('{"a":1,"b":tr'), { a: 1 });
    assert.deepEqual(parsePartialJson('{"a":[1,2,'), { a: [1, 2] });
    assert.deepEqual(parsePartialJson('{"a":{"b":'), { a: {} });
  });

  test('returns undefined before any container opens', (assert) => {
    assert.strictEqual(parsePartialJson(''), undefined);
    assert.strictEqual(parsePartialJson('  '), undefined);
  });
});

module('toCommandRequest arguments', () => {
  let call = (args: string) =>
    ({
      id: 'call_1',
      type: 'function',
      function: { name: 'run-realm-code_6b92', arguments: args },
    }) as ChatCompletionMessageFunctionToolCall;

  test('a preview gets the arguments parsed so far', (assert) => {
    let request = toCommandRequest(call('{"attributes":{"code":"await rea'), {
      partialArguments: true,
    });
    assert.deepEqual(request.arguments, { attributes: { code: 'await rea' } });
    assert.strictEqual(request.argumentsError, undefined);
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

  test('the preview parses a streaming prefix with raw newlines', (assert) => {
    assert.deepEqual(parsePartialJson('{"attributes": {"code": "a\nb'), {
      attributes: { code: 'a\nb' },
    });
  });

  test('valid JSON and escaped sequences are left alone', (assert) => {
    assert.strictEqual(
      escapeControlCharactersInStrings('{"a": "x\\ny"}\n'),
      '{"a": "x\\ny"}\n',
    );
  });
});
