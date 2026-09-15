import { createHash } from 'node:crypto';
import QUnit from 'qunit';
import {
  baseFileData,
  jsonFileData,
} from '@cardstack/runtime-common/base-file-data';

const { module, test } = QUnit;

module('Lattice | trusted file data in Node', function () {
  test('file identity uses decoded names and hashes the original UTF-8 bytes', async function (assert) {
    const url = 'https://example.com/%E9%9B%AA%20notes.json';
    const bytes = new TextEncoder().encode('{"note":"雪🙂"}\r\n');
    const result = await baseFileData(url, async () => bytes);
    assert.deepEqual(result, {
      sourceUrl: url,
      url,
      name: '雪 notes.json',
      contentType: 'application/json',
      contentHash: createHash('md5').update(bytes).digest('hex'),
      contentSize: bytes.byteLength,
    });
  });

  test('complete metadata avoids a byte read, while partial metadata reads exactly once', async function (assert) {
    let reads = 0;
    const bytes = new Uint8Array([1, 2, 3]);
    const getBytes = async () => {
      reads++;
      return bytes;
    };
    const empty = await baseFileData(
      'https://example.com/empty.json',
      getBytes,
      {
        contentHash: 'known-empty',
        contentSize: 0,
      },
    );
    assert.strictEqual(reads, 0);
    assert.strictEqual(empty.contentSize, 0);
    const partial = await baseFileData(
      'https://example.com/data.json',
      getBytes,
      {
        contentHash: 'known-data',
      },
    );
    assert.strictEqual(reads, 1);
    assert.strictEqual(partial.contentHash, 'known-data');
    assert.strictEqual(partial.contentSize, 3);
    await assert.rejects(baseFileData('not a URL', getBytes));
    assert.strictEqual(reads, 1, 'an invalid URL does not read bytes');
  });

  test('JSON summaries preserve invalid text, scalar roots and newline semantics', function (assert) {
    for (const [text, rootType, keyCount, lineCount] of [
      ['{"a":1,"b":2}\r\n', 'object', 2, 1],
      ['[1,\r2,\n3]\n', 'array', 3, 3],
      ['null', 'null', 0, 1],
      ['"雪🙂"', 'string', 0, 1],
      ['42', 'number', 0, 1],
      ['false', 'boolean', 0, 1],
      ['broken\njson\n', '', 0, 2],
      ['', '', 0, 0],
    ] as const) {
      assert.deepEqual(
        jsonFileData(text, 'notes.v2.json'),
        {
          title: 'notes.v2',
          excerpt: text.trim(),
          content: text,
          rootType,
          keyCount,
          lineCount,
        },
        text,
      );
    }
    const long = ' '.repeat(3) + 'x'.repeat(600) + '\n';
    assert.strictEqual(jsonFileData(long, '.json').title, 'Untitled JSON');
    assert.strictEqual(
      jsonFileData(long, 'notes').excerpt,
      'x'.repeat(497) + '...',
    );
    assert.strictEqual(jsonFileData(long, 'notes').content, long);
  });
});
