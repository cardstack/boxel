import assert from 'node:assert/strict';
import test from 'node:test';

import { BoxelHttpAdapter } from '../src/http-adapter.js';

function jwt(claims) {
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

test('discovers effective Realm grants with the calling Realm JWT', async () => {
  let requests = [];
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch(url, init) {
      requests.push({ url, init });
      return jsonResponse({
        'https://example.test/one/': jwt({
          permissions: ['read', 'write'],
        }),
        'https://example.test/two/': jwt({ permissions: ['read'] }),
      });
    },
  });

  let grants = await adapter.listRealms();

  assert.deepEqual(grants, [
    {
      id: 'https://example.test/one/',
      url: 'https://example.test/one/',
      canRead: true,
      canWrite: true,
    },
    {
      id: 'https://example.test/two/',
      url: 'https://example.test/two/',
      canRead: true,
      canWrite: false,
    },
  ]);
  assert.equal(requests[0].url, 'https://example.test/_realm-auth');
  assert.equal(
    requests[0].init.headers.get('Authorization'),
    'Bearer current-realm-token',
  );
});

test('uses the federated full-text index and returns item resources', async () => {
  let captured;
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch(url, init) {
      captured = { url, init };
      return jsonResponse({
        data: [
          {
            relationships: {
              item: {
                data: {
                  type: 'file-meta',
                  id: 'https://example.test/two/card.gts',
                },
              },
            },
          },
        ],
        included: [
          {
            type: 'file-meta',
            id: 'https://example.test/two/card.gts',
            attributes: { name: 'card.gts' },
          },
        ],
      });
    },
  });

  let results = await adapter.search(
    ['https://example.test/one/', 'https://example.test/two/'],
    { filter: { any: [{ matches: 'three' }, { matches: 'threejs' }] } },
  );

  assert.equal(captured.url, 'https://example.test/_federated-search');
  assert.equal(captured.init.method, 'QUERY');
  assert.deepEqual(JSON.parse(captured.init.body), {
    realms: ['https://example.test/one/', 'https://example.test/two/'],
    fields: { entry: ['item'] },
    filter: { any: [{ matches: 'three' }, { matches: 'threejs' }] },
  });
  assert.deepEqual(results, [
    {
      type: 'file-meta',
      id: 'https://example.test/two/card.gts',
      attributes: { name: 'card.gts' },
    },
  ]);
});

test('commits every staged text change in one atomic request', async () => {
  let captured;
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch(url, init) {
      captured = { url, init };
      return jsonResponse({ 'atomic:results': [] });
    },
  });

  await adapter.atomicWrite('https://example.test/one/', [
    {
      operation: 'update',
      path: 'existing.gts',
      content: 'updated',
      exists: true,
    },
    {
      operation: 'create',
      path: 'new.gts',
      content: 'created',
      exists: false,
    },
    { operation: 'remove', path: 'old.gts', exists: true },
  ]);

  assert.equal(captured.url, 'https://example.test/one/_atomic');
  let body = JSON.parse(captured.init.body);
  assert.deepEqual(
    body['atomic:operations'].map(({ op, href }) => ({ op, href })),
    [
      { op: 'update', href: 'existing.gts' },
      { op: 'add', href: 'new.gts' },
      { op: 'remove', href: 'old.gts' },
    ],
  );
});

test('executes scoped raw Realm API requests with host-controlled auth', async () => {
  let captured;
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch(url, init) {
      captured = { url, init };
      return jsonResponse({ updated: true }, { status: 202 });
    },
  });

  let result = await adapter.realmRequest(
    'https://example.test/one/',
    'PATCH',
    '_permissions',
    {
      body: { add: ['read'] },
      bodyType: 'json',
      contentType: 'application/json',
      headers: { 'If-Match': 'current' },
      responseType: 'auto',
    },
  );

  assert.equal(captured.url, 'https://example.test/one/_permissions');
  assert.equal(captured.init.method, 'PATCH');
  assert.equal(
    captured.init.headers.get('Authorization'),
    'Bearer current-realm-token',
  );
  assert.equal(captured.init.headers.get('If-Match'), 'current');
  assert.deepEqual(JSON.parse(captured.init.body), { add: ['read'] });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { updated: true });
});

test('transports binary raw API bodies and responses as base64', async () => {
  let captured;
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch(url, init) {
      captured = { url, init };
      return new Response(Uint8Array.from([9, 8, 7]), {
        headers: { 'content-type': 'application/octet-stream' },
      });
    },
  });
  let requestBytes = Uint8Array.from([0, 1, 2, 255]);

  let result = await adapter.realmRequest(
    'https://example.test/one/',
    'POST',
    'asset.bin',
    {
      body: Buffer.from(requestBytes).toString('base64'),
      bodyType: 'base64',
      contentType: 'application/octet-stream',
      responseType: 'base64',
    },
  );

  assert.deepEqual(new Uint8Array(captured.init.body), requestBytes);
  assert.deepEqual(Buffer.from(result.body, 'base64'), Buffer.from([9, 8, 7]));
});

test('blocks raw access to credential-minting and recursive endpoints', async () => {
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch() {
      throw new Error('must not fetch');
    },
  });

  await assert.rejects(adapter.serverRequest('POST', '_realm-auth', {}), {
    code: 'CAPABILITY_DENIED',
  });
  await assert.rejects(
    adapter.realmRequest(
      'https://example.test/one/',
      'QUERY',
      '_realm-program',
      { body: { code: 'return 1' }, bodyType: 'json' },
    ),
    { code: 'CAPABILITY_DENIED' },
  );
});

test('stops streaming a raw API response at the host byte limit', async () => {
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch() {
      return new Response('response is too large');
    },
  });

  await assert.rejects(
    adapter.realmRequest('https://example.test/one/', 'GET', 'large.txt', {
      responseType: 'text',
      maxResponseBytes: 4,
    }),
    { code: 'BYTE_LIMIT' },
  );
});

test('stops streaming file helper responses at the host byte limit', async () => {
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch() {
      return new Response('file is too large');
    },
  });

  await assert.rejects(
    adapter.readText('https://example.test/one/', 'large.txt', 4),
    { code: 'BYTE_LIMIT' },
  );
  await assert.rejects(
    adapter.readBase64('https://example.test/one/', 'large.bin', 4),
    { code: 'BYTE_LIMIT' },
  );
});

test('turns request aborts into a stable Realm API timeout error', async () => {
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    requestTimeoutMs: 5,
    async fetch() {
      throw new DOMException('timed out', 'TimeoutError');
    },
  });

  await assert.rejects(
    adapter.realmRequest('https://example.test/one/', 'GET', '_info'),
    { code: 'REALM_API_TIMEOUT' },
  );
});

test('aborts in-flight HTTP when the Realm Program deadline expires', async () => {
  let controller = new AbortController();
  let adapter = new BoxelHttpAdapter({
    authorization: 'Bearer current-realm-token',
    realmServerUrl: 'https://example.test/',
    async fetch(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    },
  });
  adapter.setProgramSignal(controller.signal);

  let pending = adapter.realmRequest(
    'https://example.test/one/',
    'GET',
    '_info',
  );
  controller.abort();

  await assert.rejects(pending, { code: 'TIME_LIMIT' });
});
