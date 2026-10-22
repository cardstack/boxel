import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { TopLevelJsonFieldScanner } from '../lib/top-level-json-fields.ts';

const encoder = new TextEncoder();

function scan(
  chunks: (string | Uint8Array)[],
  wanted = ['id', 'usage'],
  maxValueBytes = 1024,
): TopLevelJsonFieldScanner {
  let scanner = new TopLevelJsonFieldScanner(wanted, { maxValueBytes });
  for (let chunk of chunks) {
    scanner.feed(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
  }
  scanner.finish();
  return scanner;
}

// The document cut into two chunks at every byte, and into single bytes.
function everySplit(document: string): Uint8Array[][] {
  let bytes = encoder.encode(document);
  let splits: Uint8Array[][] = [];
  for (let at = 0; at <= bytes.length; at++) {
    splits.push([bytes.subarray(0, at), bytes.subarray(at)]);
  }
  splits.push(Array.from(bytes, (byte) => Uint8Array.of(byte)));
  return splits;
}

module(basename(import.meta.filename), function () {
  test('reads the chosen top-level members wherever the chunks split', function (assert) {
    let document = JSON.stringify({
      id: 'gen-1',
      choices: [
        {
          message: {
            id: 'not-this-one',
            content: 'say "hi" \\ or {not: a [bracket]}, "usage": 1',
          },
        },
      ],
      model: 'm',
      usage: { prompt_tokens: 3, cost: 0.004 },
    });
    for (let chunks of everySplit(document)) {
      let scanner = scan(chunks);
      assert.strictEqual(scanner.error, undefined);
      assert.true(scanner.complete);
      assert.deepEqual(Object.fromEntries(scanner.values), {
        id: 'gen-1',
        usage: { prompt_tokens: 3, cost: 0.004 },
      });
    }
  });

  test('reads members from a document with whitespace and multi-byte text', function (assert) {
    let document = `\n  {\n  "usage" : { "cost" : 0.5 } ,\n  "note": "日本語 ✓ \\"quoted\\" \\\\",\n  "id" : "gen-ü"\n}\n  `;
    for (let chunks of everySplit(document)) {
      let scanner = scan(chunks);
      assert.strictEqual(scanner.error, undefined);
      assert.deepEqual(Object.fromEntries(scanner.values), {
        usage: { cost: 0.5 },
        id: 'gen-ü',
      });
    }
  });

  test('the last of a repeated member wins, as with JSON.parse', function (assert) {
    let scanner = scan(['{"id":"first","id":"second"}']);
    assert.strictEqual(scanner.values.get('id'), 'second');
  });

  test('a member value longer than the limit is reported as missing', function (assert) {
    let scanner = scan(
      [`{"id":"${'x'.repeat(100)}","usage":{"cost":1}}`],
      ['id', 'usage'],
      50,
    );
    assert.strictEqual(scanner.error, undefined, 'the document is still fine');
    assert.false(scanner.values.has('id'));
    assert.deepEqual(scanner.values.get('usage'), { cost: 1 });
  });

  test('a top-level array carries no members but is a document', function (assert) {
    let scanner = scan(['[{"id":"inner"}]']);
    assert.true(scanner.complete);
    assert.strictEqual(scanner.values.size, 0);
  });

  test('a document with structural faults reports them', function (assert) {
    let cases: Record<string, string> = {
      truncated: '{"id":"gen-1","usage":{"cost":1}',
      'unterminated string': '{"id":"gen-1',
      'mismatched bracket': '{"id":["gen-1"}',
      'trailing content': '{"id":"gen-1"} {"id":"gen-2"}',
      'a bare word': 'no healthy upstream',
      empty: '   ',
    };
    for (let [name, document] of Object.entries(cases)) {
      let scanner = scan([document]);
      assert.notStrictEqual(scanner.error, undefined, `${name} is refused`);
      assert.false(scanner.complete, `${name} is not complete`);
    }
  });

  test('a multi-megabyte member that is not chosen is read past, not kept', function (assert) {
    let scanner = new TopLevelJsonFieldScanner(['id', 'usage'], {
      maxValueBytes: 1024,
    });
    scanner.feed(encoder.encode('{"id":"gen-big","data":[{"b64_json":"'));
    let block = encoder.encode('QUJD'.repeat(256 * 1024));
    for (let i = 0; i < 8; i++) {
      scanner.feed(block);
    }
    scanner.feed(encoder.encode('"}],"usage":{"cost":0.04}}'));
    scanner.finish();
    assert.true(scanner.complete);
    assert.deepEqual(Object.fromEntries(scanner.values), {
      id: 'gen-big',
      usage: { cost: 0.04 },
    });
  });
});
