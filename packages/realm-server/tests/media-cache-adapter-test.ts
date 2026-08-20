import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeMediaCacheKey } from '@cardstack/runtime-common';
import { LocalDiskMediaCacheAdapter } from '../media-cache/local-disk-adapter.ts';
import { S3MediaCacheAdapter } from '../media-cache/s3-adapter.ts';

async function collectBytes(
  stream: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  let chunks: Uint8Array[] = [];
  for await (let chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module(basename(import.meta.filename), function () {
  module('computeMediaCacheKey', function () {
    test('is the sha256 hex of the bytes', async function (assert) {
      // Pinned against `echo -n "boxel" | shasum -a 256`, so the content
      // address never silently changes shape — object keys, ledger rows, and
      // (later) ETags all depend on it.
      assert.strictEqual(
        await computeMediaCacheKey(new TextEncoder().encode('boxel')),
        '1c1ab2b8fae6c953de3694b4bb8b1dc9295d4ce0bb71e24d284ee4012611579c',
      );
    });

    test('distinguishes different bytes', async function (assert) {
      assert.notStrictEqual(
        await computeMediaCacheKey(new Uint8Array([1, 2, 3])),
        await computeMediaCacheKey(new Uint8Array([1, 2, 4])),
      );
    });
  });

  module('LocalDiskMediaCacheAdapter', function (hooks) {
    let dir: string;
    let adapter: LocalDiskMediaCacheAdapter;
    let bytes = new TextEncoder().encode('png-bytes');
    let key: string;

    hooks.beforeEach(async function () {
      dir = await mkdtemp(join(tmpdir(), 'media-cache-test-'));
      adapter = new LocalDiskMediaCacheAdapter({ dir });
      key = await computeMediaCacheKey(bytes);
    });

    hooks.afterEach(async function () {
      await rm(dir, { recursive: true, force: true });
    });

    test('round-trips an object', async function (assert) {
      await adapter.put(key, bytes, { contentType: 'image/png' });

      let stat = await adapter.head(key);
      assert.strictEqual(stat?.size, bytes.length, 'head reports the size');

      let stream = await adapter.getStream(key);
      assert.ok(stream, 'the object streams');
      assert.deepEqual(
        [...(await collectBytes(stream!))],
        [...bytes],
        'the streamed bytes are the stored bytes',
      );

      await adapter.delete(key);
      assert.strictEqual(await adapter.head(key), undefined, 'deleted');
    });

    test('reports absence rather than erroring', async function (assert) {
      assert.strictEqual(await adapter.head('0'.repeat(64)), undefined);
      assert.strictEqual(await adapter.getStream('0'.repeat(64)), undefined);
      await adapter.delete('0'.repeat(64)); // idempotent no-op
      assert.ok(true, 'deleting a missing key does not throw');
    });

    test('put is dedupe-on-write: an existing object is not rewritten', async function (assert) {
      await adapter.put(key, bytes, { contentType: 'image/png' });
      // Scribble on the stored file, then re-put the same key. A correct
      // adapter treats key-exists as bytes-present and skips the write, so
      // the scribble survives — proof the second put was a no-op.
      let path = join(dir, key.slice(0, 2), key);
      await writeFile(path, 'scribble');
      await adapter.put(key, bytes, { contentType: 'image/png' });
      assert.strictEqual(
        await readFile(path, 'utf8'),
        'scribble',
        'the second put did not rewrite the object',
      );
    });

    test('objects fan out under a two-character prefix directory', async function (assert) {
      await adapter.put(key, bytes, { contentType: 'image/png' });
      let path = join(dir, key.slice(0, 2), key);
      assert.deepEqual(
        [...(await readFile(path))],
        [...bytes],
        'the object lives at <dir>/<key[0..2]>/<key>',
      );
    });
  });

  module('S3MediaCacheAdapter', function (hooks) {
    // The stub stands in for S3Client: it records every command and answers
    // from a scripted head/get response, so these tests pin the adapter's
    // command construction and error mapping without any network.
    let sent: { name: string; input: any }[];
    let headResult: (() => any) | undefined;
    let getResult: (() => any) | undefined;
    let adapter: S3MediaCacheAdapter;

    function notFound(name: string) {
      return Object.assign(new Error(name), {
        name,
        $metadata: { httpStatusCode: 404 },
      });
    }

    hooks.beforeEach(function () {
      sent = [];
      headResult = undefined;
      getResult = undefined;
      let client = {
        send: async (command: any) => {
          sent.push({ name: command.constructor.name, input: command.input });
          switch (command.constructor.name) {
            case 'HeadObjectCommand':
              if (!headResult) {
                throw notFound('NotFound');
              }
              return headResult();
            case 'GetObjectCommand':
              if (!getResult) {
                throw notFound('NoSuchKey');
              }
              return getResult();
            default:
              return {};
          }
        },
      };
      adapter = new S3MediaCacheAdapter({
        bucket: 'test-bucket',
        keyPrefix: 'media/',
        client: client as any,
      });
    });

    test('put uploads a missing object with its content type', async function (assert) {
      await adapter.put('abc123', new Uint8Array([1, 2]), {
        contentType: 'image/png',
      });
      assert.deepEqual(
        sent.map((s) => s.name),
        ['HeadObjectCommand', 'PutObjectCommand'],
        'head-checks then uploads',
      );
      let put = sent[1].input;
      assert.strictEqual(put.Bucket, 'test-bucket');
      assert.strictEqual(put.Key, 'media/abc123', 'the key prefix is applied');
      assert.strictEqual(put.ContentType, 'image/png');
      assert.deepEqual([...put.Body], [1, 2]);
    });

    test('put is dedupe-on-write: an existing object is not re-uploaded', async function (assert) {
      headResult = () => ({ ContentLength: 2 });
      await adapter.put('abc123', new Uint8Array([1, 2]), {
        contentType: 'image/png',
      });
      assert.deepEqual(
        sent.map((s) => s.name),
        ['HeadObjectCommand'],
        'no upload was issued',
      );
    });

    test('head reports size and content type, and absence as undefined', async function (assert) {
      headResult = () => ({ ContentLength: 42, ContentType: 'image/webp' });
      assert.deepEqual(await adapter.head('abc123'), {
        size: 42,
        contentType: 'image/webp',
      });
      assert.strictEqual(sent[0].input.Key, 'media/abc123');

      headResult = undefined;
      assert.strictEqual(await adapter.head('missing'), undefined);
    });

    test('getStream returns the body and maps a missing key to undefined', async function (assert) {
      let body = (async function* () {
        yield new Uint8Array([9]);
      })();
      getResult = () => ({ Body: body });
      assert.strictEqual(await adapter.getStream('abc123'), body);

      getResult = undefined;
      assert.strictEqual(await adapter.getStream('missing'), undefined);
    });

    test('delete issues a DeleteObjectCommand under the prefixed key', async function (assert) {
      await adapter.delete('abc123');
      assert.deepEqual(
        sent.map((s) => s.name),
        ['DeleteObjectCommand'],
      );
      assert.strictEqual(sent[0].input.Key, 'media/abc123');
    });

    test('non-404 errors propagate', async function (assert) {
      headResult = () => {
        throw Object.assign(new Error('AccessDenied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        });
      };
      await assert.rejects(adapter.head('abc123'), /AccessDenied/);
    });
  });
});
