import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Readable } from 'node:stream';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  MediaCacheAdapter,
  MediaCacheEntry,
  QueuePublisher,
  Realm,
  RequestContext,
  ResponseWithNodeStream,
} from '@cardstack/runtime-common';
import {
  MEDIA_CACHE_MAX_AGE_SECONDS,
  MEDIA_CACHE_STALE_WHILE_REVALIDATE_SECONDS,
  findMediaCacheEntry,
  mediaCacheMissResponse,
  putMedia,
  serveMediaCacheEntry,
} from '@cardstack/runtime-common';

import { nodeStreamToBuffer } from '../stream.ts';
import { setupDB } from './helpers/index.ts';

const REALM_URL = 'http://test-realm/a/';
const BYTES = new TextEncoder().encode('png-bytes');

// Minimal store: real bytes behind the interface, with a switch between the
// two stream shapes the serving layer handles (a node Readable, which
// streams via `nodeStream`, and a bare async iterable, which is buffered).
class FakeMediaCacheAdapter implements MediaCacheAdapter {
  objects = new Map<string, Uint8Array>();
  streamShape: 'readable' | 'iterable' = 'readable';

  async put(key: string, bytes: Uint8Array, _opts: { contentType: string }) {
    this.objects.set(key, bytes);
  }
  async head(key: string) {
    let bytes = this.objects.get(key);
    return bytes ? { size: bytes.length } : undefined;
  }
  async getStream(key: string) {
    let bytes = this.objects.get(key);
    if (!bytes) {
      return undefined;
    }
    if (this.streamShape === 'readable') {
      return Readable.from(Buffer.from(bytes));
    }
    return (async function* () {
      yield bytes.slice(0, 3);
      yield bytes.slice(3);
    })();
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

function requestContext(
  permissions: Record<string, string[]> = {},
): RequestContext {
  return {
    realm: { url: REALM_URL } as unknown as Realm,
    permissions,
  } as RequestContext;
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let adapter: FakeMediaCacheAdapter;
  let entry: MediaCacheEntry;

  setupDB(hooks, {
    beforeEach: async (
      _dbAdapter: PgAdapter,
      _publisher: QueuePublisher,
    ): Promise<void> => {
      dbAdapter = _dbAdapter;
      adapter = new FakeMediaCacheAdapter();
      await putMedia(dbAdapter, adapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'spec-1',
        sourceGeneration: 1,
        bytes: BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });
      entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'spec-1',
      }))!;
    },
  });

  function serve(
    init: { method?: string; headers?: Record<string, string> } = {},
    permissions: Record<string, string[]> = {},
  ): Promise<ResponseWithNodeStream> {
    return serveMediaCacheEntry({
      request: new Request(`${REALM_URL}_screenshot/card-1`, init),
      requestContext: requestContext(permissions),
      entry,
      mediaCacheAdapter: adapter,
      dbAdapter,
    });
  }

  async function lastAccessedAt(): Promise<number> {
    let row = await findMediaCacheEntry(dbAdapter, {
      realmURL: REALM_URL,
      sourceURL: `${REALM_URL}card-1`,
      captureSpecHash: 'spec-1',
    });
    return row!.lastAccessedAt;
  }

  test('a hit streams the bytes with content-hash validators', async function (assert) {
    let response = await serve();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'image/png');
    assert.strictEqual(
      response.headers.get('content-length'),
      String(BYTES.length),
    );
    assert.strictEqual(
      response.headers.get('etag'),
      `"${entry.objectKey}"`,
      'the ETag is the content hash',
    );
    assert.strictEqual(
      response.headers.get('cache-control'),
      `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${MEDIA_CACHE_STALE_WHILE_REVALIDATE_SECONDS}`,
    );
    assert.ok(response.nodeStream, 'a node Readable rides nodeStream');
    assert.deepEqual(
      [...(await nodeStreamToBuffer(response.nodeStream!))],
      [...BYTES],
      'the streamed bytes are the stored bytes',
    );
  });

  test('a world-readable realm gets public cache-control', async function (assert) {
    let response = await serve({}, { '*': ['read'] });
    assert.ok(response.headers.get('cache-control')!.startsWith('public, '));
  });

  test('an If-None-Match echo of the ETag answers as a bodyless 304', async function (assert) {
    for (let headerValue of [
      `"${entry.objectKey}"`,
      `W/"${entry.objectKey}"`,
      `"something-else", "${entry.objectKey}"`,
      '*',
    ]) {
      let response = await serve({
        headers: { 'if-none-match': headerValue },
      });
      assert.strictEqual(response.status, 304, `304 for ${headerValue}`);
      assert.strictEqual(response.nodeStream, undefined);
      assert.strictEqual(
        response.headers.get('etag'),
        `"${entry.objectKey}"`,
        'the 304 re-states the validator',
      );
    }
  });

  test('a stale If-None-Match gets the new bytes', async function (assert) {
    let response = await serve({
      headers: { 'if-none-match': '"some-prior-capture-hash"' },
    });
    assert.strictEqual(response.status, 200);
  });

  test('a bare async-iterable stream still exits via nodeStream', async function (assert) {
    // Any body shape other than nodeStream is drained through text by the
    // realm-server's Koa bridge, corrupting binary — so both interface-legal
    // stream shapes must leave through nodeStream.
    adapter.streamShape = 'iterable';
    let response = await serve();
    assert.strictEqual(response.status, 200);
    assert.ok(response.nodeStream, 'the wrapped iterable rides nodeStream');
    assert.deepEqual(
      [...(await nodeStreamToBuffer(response.nodeStream!))],
      [...BYTES],
    );
  });

  test('an entry whose object is gone serves as an uncaptured miss', async function (assert) {
    await adapter.delete(entry.objectKey);
    let response = await serve();
    assert.strictEqual(response.status, 404);
    assert.strictEqual(
      response.headers.get('cache-control'),
      `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
      'the miss is briefly cacheable, so image retries are cheap',
    );
  });

  test('200 and 304 both bump last_accessed_at', async function (assert) {
    let before = await lastAccessedAt();
    for (let init of [
      {},
      { headers: { 'if-none-match': `"${entry.objectKey}"` } },
    ]) {
      // ensure the clock can only move forward past the prior stamp
      await new Promise((resolve) => setTimeout(resolve, 5));
      await serve(init as any);
      let after = await lastAccessedAt();
      assert.true(
        after > before,
        `serving with ${JSON.stringify(init)} bumped last_accessed_at`,
      );
      before = after;
    }
  });

  test('the miss response carries realm visibility', async function (assert) {
    let response = mediaCacheMissResponse({
      requestContext: requestContext({ '*': ['read'] }),
    });
    assert.strictEqual(response.status, 404);
    assert.strictEqual(
      response.headers.get('cache-control'),
      `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
    );
  });
});
