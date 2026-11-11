import QUnit from 'qunit';
import { basename } from 'path';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPublicReferenceCache } from '../lib/public-reference-cache.ts';
import {
  createPublicReferenceFetch,
  publicReferenceFetchFromEnv,
} from '@cardstack/runtime-common/public-reference-fetch';

const { module, test } = QUnit;

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No test address');
  return `http://127.0.0.1:${address.port}/`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

module(basename(import.meta.filename), function (hooks) {
  let directory: string;
  let upstream: Server;
  let origin: string;
  let calls: number;
  let noStoreSearch: boolean;
  let cache: Awaited<ReturnType<typeof createPublicReferenceCache>>;
  hooks.beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'boxel-reference-test-'));
    calls = 0;
    noStoreSearch = false;
    upstream = createServer(async (request, response) => {
      calls++;
      if (request.url === '/catalog/redirect') {
        response
          .writeHead(302, { Location: 'https://example.invalid/private' })
          .end();
        return;
      }
      if (request.url === '/catalog/cookie')
        response.setHeader('Set-Cookie', 'fixture=only');
      if (request.url === '/catalog/private')
        response.setHeader('Cache-Control', 'private');
      if (request.url?.startsWith('/catalog/no-store'))
        response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/catalog/no-store-public') {
        response.setHeader('X-Boxel-Realm-Public-Readable', 'true');
      }
      if (request.url === '/catalog/_info')
        response.setHeader('X-Boxel-Realm-Public-Readable', 'true');
      if (request.url === '/_federated-search' && noStoreSearch)
        response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/catalog/oversize') {
        response.end(Buffer.alloc(10 * 1024 * 1024 + 1));
        return;
      }
      let chunks: Buffer[] = [];
      for await (let chunk of request) chunks.push(Buffer.from(chunk));
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('X-Boxel-Realm-Url', `${origin}catalog/`);
      response.end(
        JSON.stringify({
          path: request.url,
          accept: request.headers.accept,
          body: Buffer.concat(chunks).toString(),
          authenticated: Boolean(
            request.headers.authorization || request.headers.cookie,
          ),
        }),
      );
    });
    origin = await listen(upstream);
    cache = await createPublicReferenceCache({
      directory,
      realmURLs: [`${origin}catalog/`],
    });
  });
  hooks.afterEach(async () => {
    await cache.close();
    if (upstream.listening) await close(upstream);
    await rm(directory, { recursive: true, force: true });
  });

  function request(file: string, init?: RequestInit) {
    return new Request(`http://cache.localhost/${file}`, init);
  }

  test('a restarted cache serves warmed source, metadata and public search after upstream shutdown', async (assert) => {
    let query = JSON.stringify({
      realms: [`${origin}catalog/`],
      filter: { type: 'card' },
    });
    let requests = [
      request('catalog/file.gts', {
        headers: { Accept: 'application/vnd.card+source' },
      }),
      request('catalog/file.gts', {
        headers: { Accept: 'application/vnd.card+json' },
      }),
      request('_federated-search', {
        method: 'QUERY',
        body: query,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
    let expected: string[] = [];
    for (let input of requests) {
      let response = await cache.fetch(input.clone());
      assert.strictEqual(response.status, 200);
      expected.push(await response.text());
    }
    assert.strictEqual(calls, 3, 'content negotiation has independent entries');
    await cache.close();
    await close(upstream);
    cache = await createPublicReferenceCache({
      directory,
      realmURLs: [`${origin}catalog/`],
      freshnessMs: 0,
    });
    for (let [index, input] of requests.entries()) {
      let response = await cache.fetch(input);
      assert.strictEqual(await response.text(), expected[index]);
      assert.strictEqual(
        response.headers.get('X-Boxel-Reference-Cache'),
        'hit',
      );
      assert.strictEqual(
        response.headers.get('X-Boxel-Realm-Url'),
        `${origin}catalog/`,
      );
    }
    let head = await cache.fetch(
      request('catalog/file.gts', {
        method: 'HEAD',
        headers: { Accept: 'application/vnd.card+source' },
      }),
    );
    assert.strictEqual(head.status, 200);
    assert.strictEqual(await head.text(), '');
    assert.strictEqual(
      (await cache.fetch(request('catalog/not-warmed'))).status,
      503,
    );
  });

  test('rejects private destinations, authenticated reads, writes and private search without contacting upstream', async (assert) => {
    for (let input of [
      request('private/file'),
      request('catalogue/file'),
      request('catalog/%2fprivate'),
      request('catalog/file?access_token=fixture'),
      request('catalog/file', { method: 'POST', body: 'no writes' }),
      request('catalog/file', { headers: { Authorization: 'Bearer fixture' } }),
      request('catalog/file', { headers: { Cookie: 'fixture=only' } }),
      request('_federated-search', {
        method: 'QUERY',
        body: JSON.stringify({ realms: [`${origin}private/`] }),
      }),
      request('_federated-search', { method: 'QUERY', body: '{"realms":[]}' }),
    ]) {
      assert.true((await cache.fetch(input)).status >= 400);
    }
    assert.strictEqual(calls, 0);
    assert.deepEqual(await readdir(directory), []);
  });

  test('does not store redirects, cookie responses, private responses or oversized responses', async (assert) => {
    for (let file of [
      'redirect',
      'cookie',
      'private',
      'oversize',
      'no-store-public',
    ]) {
      assert.strictEqual(
        (await cache.fetch(request(`catalog/${file}`))).status,
        503,
        file,
      );
    }
    assert.deepEqual(await readdir(directory), []);
  });

  test('explicit offline snapshots require public realm assertions and still forbid private responses', async (assert) => {
    await cache.close();
    cache = await createPublicReferenceCache({
      directory,
      realmURLs: [`${origin}catalog/`],
      savePublicSnapshots: true,
    });
    assert.strictEqual(
      (await cache.fetch(request('catalog/no-store'))).status,
      503,
      'no public assertion',
    );
    assert.strictEqual(
      (await cache.fetch(request('catalog/private'))).status,
      503,
      'private remains private',
    );
    let response = await cache.fetch(request('catalog/no-store-public'));
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('Cache-Control'),
      'no-store',
      'HTTP intermediaries cannot cache snapshots',
    );
    assert.strictEqual((await readdir(directory)).length, 1);
    noStoreSearch = true;
    let query = request('_federated-search', {
      method: 'QUERY',
      body: JSON.stringify({ realms: [`${origin}catalog/`] }),
    });
    assert.strictEqual(
      (await cache.fetch(query.clone())).status,
      200,
      'public search verifies the owning realms',
    );
    await cache.close();
    await close(upstream);
    cache = await createPublicReferenceCache({
      directory,
      realmURLs: [`${origin}catalog/`],
      savePublicSnapshots: true,
    });
    assert.strictEqual(
      (await cache.fetch(query)).status,
      200,
      'saved public search works offline',
    );
  });

  test('cold reads are coalesced and corrupted cache entries are refetched', async (assert) => {
    let results = await Promise.all(
      Array.from({ length: 8 }, () => cache.fetch(request('catalog/shared'))),
    );
    assert.true(results.every((response) => response.status === 200));
    assert.strictEqual(calls, 1);
    let [file] = await readdir(directory);
    await writeFile(path.join(directory, file), '{corrupt');
    assert.strictEqual(
      (await cache.fetch(request('catalog/shared'))).status,
      200,
    );
    assert.strictEqual(calls, 2);
  });

  test('query bodies and response shapes have distinct cache entries', async (assert) => {
    let body = JSON.stringify({
      realms: [`${origin}catalog/`],
      filter: { a: 1 },
    });
    let other = JSON.stringify({
      realms: [`${origin}catalog/`],
      filter: { a: 2 },
    });
    for (let [query, shape] of [
      [body, 'links-only'],
      [other, 'links-only'],
      [body, 'full'],
    ]) {
      assert.strictEqual(
        (
          await cache.fetch(
            request('_federated-search', {
              method: 'QUERY',
              body: query,
              headers: { 'X-Boxel-Link-Shape': shape },
            }),
          )
        ).status,
        200,
      );
    }
    assert.strictEqual(calls, 3);
    assert.strictEqual(
      (
        await cache.fetch(
          request('_federated-search', {
            method: 'QUERY',
            body: 'x'.repeat(64 * 1024 + 1),
          }),
        )
      ).status,
      413,
    );
    assert.strictEqual(calls, 3);
  });
});

module(
  `${basename(import.meta.filename)} | public reference fetch boundary`,
  function () {
    test('preserves canonical response URLs, drops credentials only for public references, and leaves private fetches intact', async (assert) => {
      let observed: Request[] = [];
      let fetch = createPublicReferenceFetch(
        {
          proxyURL: 'http://cache.localhost/',
          realmURLs: ['https://public.example/catalog/'],
        },
        async (input, init) => {
          observed.push(new Request(input, init));
          return new Response('fixture');
        },
      );
      let response = await fetch('https://public.example/catalog/card.gts', {
        headers: {
          Authorization: 'Bearer fixture',
          Cookie: 'fixture=only',
          Accept: 'application/vnd.card+source',
        },
      });
      assert.strictEqual(
        response.url,
        'https://public.example/catalog/card.gts',
      );
      assert.strictEqual(
        observed[0].url,
        'http://cache.localhost/catalog/card.gts',
      );
      assert.false(observed[0].headers.has('authorization'));
      assert.false(observed[0].headers.has('cookie'));
      assert.strictEqual(observed[0].credentials, 'omit');
      await fetch('https://private.example/workspace/card', {
        headers: { Authorization: 'Bearer fixture' },
      });
      assert.strictEqual(
        observed[1].url,
        'https://private.example/workspace/card',
      );
      assert.strictEqual(
        observed[1].headers.get('authorization'),
        'Bearer fixture',
      );
      await fetch('https://public.example/_federated-search', {
        method: 'QUERY',
        body: '{"realms":["https://private.example/workspace/"]}',
      });
      assert.strictEqual(
        observed[2].url,
        'https://public.example/_federated-search',
      );
    });

    test('a published-site cache mount keeps its base path without forwarding credentials', async (assert) => {
      let observed: Request | undefined;
      let fetch = createPublicReferenceFetch(
        {
          proxyURL: 'https://viewer.example/_reference/',
          realmURLs: ['https://public.example/skills/'],
        },
        async (input, init) => {
          observed = new Request(input, init);
          return new Response('fixture');
        },
      );
      let response = await fetch('https://public.example/skills/index.md', {
        headers: { Authorization: 'Bearer fixture' },
      });
      assert.strictEqual(
        observed?.url,
        'https://viewer.example/_reference/skills/index.md',
      );
      assert.false(observed?.headers.has('authorization'));
      assert.strictEqual(
        response.url,
        'https://public.example/skills/index.md',
      );
    });

    test('incomplete cache configuration fails rather than using a different transport', (assert) => {
      assert.throws(() =>
        publicReferenceFetchFromEnv(
          { BOXEL_PUBLIC_REFERENCE_CACHE_URL: 'http://cache.localhost/' },
          globalThis.fetch,
        ),
      );
      assert.throws(() =>
        createPublicReferenceFetch({
          proxyURL: 'http://secret@cache.localhost/',
          realmURLs: ['https://public.example/catalog/'],
        }),
      );
      assert.strictEqual(
        publicReferenceFetchFromEnv({}, globalThis.fetch),
        globalThis.fetch,
      );
    });
  },
);
