import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import {
  executeReadUrl,
  guardedLookup,
  isPublicAddress,
  knownRealmOrigins,
  processHtml,
  readUrlLabel,
  urlFromReadUrlArguments,
  READ_URL_MAX_CONTENT_CHARS,
  READ_URL_MAX_MEDIA_BYTES,
  READ_URL_MAX_REDIRECTS,
  READ_URL_MAX_TEXT_BYTES,
  type ReadUrlRequestInit,
} from '../lib/read-url.ts';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type FakeRoute = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
};

// A fetch that answers from a route table and records every request, so a
// test sees exactly which URLs a read reached.
function fakeFetch(routes: Record<string, FakeRoute>) {
  let requested: { url: string; init: ReadUrlRequestInit }[] = [];
  let fetch = async (url: string, init: ReadUrlRequestInit) => {
    requested.push({ url, init });
    let route = routes[url];
    if (!route) {
      throw new Error(`unexpected request to ${url}`);
    }
    let body =
      typeof route.body === 'string' || route.body === undefined
        ? (route.body ?? '')
        : Buffer.from(route.body);
    return new Response(body, {
      status: route.status ?? 200,
      headers: route.headers ?? {},
    });
  };
  return { fetch, requested };
}

// The page a realm server sends to a request that accepts HTML: the Boxel
// host app's shell, which carries no realm header.
const BOXEL_HOST_SHELL = `<!DOCTYPE html><html><head><title>Boxel</title>
  <meta name="@cardstack/host/config/environment" content="%7B%7D">
  </head><body><script src="/assets/app.js"></script></body></html>`;

module('readUrl address policy', () => {
  test('isPublicAddress refuses private, loopback, link-local and reserved addresses', () => {
    for (let address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:7f00:1',
      '::127.0.0.1',
      '::7f00:1',
      '::ffff:0:7f00:1',
      '64:ff9b::7f00:1',
      '64:ff9b:1::a00:1',
      '2002:7f00:1::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      'not-an-address',
    ]) {
      assert.false(isPublicAddress(address), `${address} is not public`);
    }
  });

  test('isPublicAddress accepts public addresses', () => {
    for (let address of ['93.184.215.14', '8.8.8.8', '2606:4700::1111']) {
      assert.true(isPublicAddress(address), `${address} is public`);
    }
  });

  test('guardedLookup refuses a hostname with any private address', async () => {
    let lookup = guardedLookup(async () => ['93.184.215.14', '10.0.0.5']);
    let error = await new Promise<Error | null>((resolve) =>
      lookup('mixed.example', {}, (err) => resolve(err)),
    );
    assert.ok(error, 'the lookup fails');
    assert.ok(
      error?.message.includes('private or reserved address'),
      'it says why',
    );
  });

  test('guardedLookup answers an all-addresses lookup with every vetted address', async () => {
    // undici's connector asks for every address (`all: true`).
    let lookup = guardedLookup(async () => [
      '93.184.215.14',
      '2606:4700::1111',
    ]);
    let entries = await new Promise<unknown>((resolve, reject) =>
      (lookup as any)(
        'example.com',
        { all: true },
        (err: Error | null, list: unknown) =>
          err ? reject(err) : resolve(list),
      ),
    );
    assert.deepEqual(entries, [
      { address: '93.184.215.14', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);
  });

  test('guardedLookup passes the vetted addresses to the socket', async () => {
    let lookup = guardedLookup(async () => ['93.184.215.14']);
    let result = await new Promise<{ address: unknown; family: unknown }>(
      (resolve, reject) =>
        lookup('example.com', {}, (err, address, family) =>
          err ? reject(err) : resolve({ address, family }),
        ),
    );
    assert.deepEqual(result, { address: '93.184.215.14', family: 4 });
  });
});

module('executeReadUrl', () => {
  test('a page comes back as its title, images and script-free HTML', async () => {
    let { fetch } = fakeFetch({
      'https://example.com/article': {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: `<html><head><title>An Article</title>
          <script>alert('pwned')</script><style>body{color:red}</style>
          <meta name="description" content="About things">
          <meta property="og:image" content="/og.png"></head>
          <body onload="steal()"><div class="wrap"><h1 class="x" id="t" style="a">Hello</h1>
          <img src="pics/one.png" alt="One" srcset="pics/one-2x.png 2x">
          <a href="/next" onclick="track()"><span>Next page</span></a></div></body></html>`,
      },
    });

    let result = await executeReadUrl('https://example.com/article', {
      fetch,
    });

    assert.true(result.ok);
    if (!result.ok || result.kind !== 'text') {
      return;
    }
    let { content } = result;
    assert.ok(content.includes('Title: An Article'));
    assert.ok(content.includes('Description: About things'));
    assert.ok(
      content.includes(
        '## Images\n- https://example.com/og.png\n- https://example.com/pics/one.png\n- https://example.com/pics/one-2x.png',
      ),
      'images are absolute, og:image first',
    );
    assert.ok(
      content.includes('<a href="https://example.com/next">Next page</a>'),
      'links keep absolute targets next to their text',
    );
    assert.ok(
      content.includes(
        '<img src="https://example.com/pics/one.png" alt="One">',
      ),
      'images keep their source and description',
    );
    assert.ok(content.includes('<h1>Hello</h1>'), 'the HTML is kept');
    for (let dropped of [
      'alert(',
      'color:red',
      'onload',
      'onclick',
      'style=',
      'class=',
      'id=',
      '<div',
      '<span',
      '<title',
      '<meta',
    ]) {
      assert.notOk(content.includes(dropped), `${dropped} is removed`);
    }
  });

  test('an image comes back as media bytes with its content type', async () => {
    let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let { fetch } = fakeFetch({
      'https://example.com/pics/one.png': {
        headers: { 'content-type': 'image/png' },
        body: bytes,
      },
    });

    let result = await executeReadUrl('https://example.com/pics/one.png', {
      fetch,
    });

    assert.true(result.ok);
    if (!result.ok || result.kind !== 'media') {
      return;
    }
    assert.strictEqual(result.contentType, 'image/png');
    assert.strictEqual(result.name, 'one.png');
    assert.deepEqual([...result.bytes], [...bytes]);
  });

  test('a URL on a realm the room knows is refused before any request', async () => {
    let { fetch, requested } = fakeFetch({});

    let result = await executeReadUrl(
      'http://localhost:4201/user/jane/realm/Person/1',
      {
        fetch,
        realmOrigins: new Set(['http://localhost:4201']),
        realmFileReadingAllowed: true,
      },
    );

    assert.false(result.ok);
    assert.ok(
      !result.ok && result.error.includes('Read it with readRealmFile'),
      'the model is pointed at readRealmFile, not told the host is private',
    );
    assert.strictEqual(requested.length, 0, 'nothing was fetched');
  });

  test('the Boxel host shell a realm server answers with is refused', async () => {
    // Any realm URL — a card, its .json, an image — requested with an HTML
    // accept header gets the host shell, with no realm header.
    let { fetch } = fakeFetch({
      'https://app.example.com/catalog/logo.png': {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: BOXEL_HOST_SHELL,
      },
    });

    let result = await executeReadUrl(
      'https://app.example.com/catalog/logo.png',
      { fetch, realmFileReadingAllowed: true },
    );

    assert.false(result.ok);
    assert.ok(
      !result.ok && result.error.includes('Read it with readRealmFile'),
      'the model is pointed at readRealmFile',
    );
  });

  test('a realm API response is refused and its body is not returned', async () => {
    let { fetch } = fakeFetch({
      'https://app.example.com/user/jane/realm/Person/1': {
        headers: {
          'content-type': 'text/html',
          'x-boxel-realm-url': 'https://app.example.com/user/jane/realm/',
        },
        body: '<html><body>secret card</body></html>',
      },
    });

    let result = await executeReadUrl(
      'https://app.example.com/user/jane/realm/Person/1',
      { fetch, realmFileReadingAllowed: false },
    );

    assert.false(result.ok);
    if (result.ok) {
      return;
    }
    assert.ok(result.error.includes('is in a Boxel realm'));
    assert.ok(
      result.error.includes('realm files cannot be read in this room'),
      'a room without realm reads says so instead of naming readRealmFile',
    );
    assert.notOk(result.error.includes('secret card'));
  });

  test('a redirect into a realm is refused', async () => {
    let { fetch } = fakeFetch({
      'https://short.example/abc': {
        status: 302,
        headers: { location: 'https://app.example.com/user/jane/realm/x' },
      },
      'https://app.example.com/user/jane/realm/x': {
        headers: { 'content-type': 'text/html' },
        body: BOXEL_HOST_SHELL,
      },
    });

    let result = await executeReadUrl('https://short.example/abc', {
      fetch,
      realmFileReadingAllowed: true,
    });

    assert.false(result.ok);
    assert.ok(!result.ok && result.error.includes('is in a Boxel realm'));
  });

  test('private and reserved targets are refused before any request', async () => {
    let { fetch, requested } = fakeFetch({});
    for (let url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:8080/',
      'http://[::ffff:127.0.0.1]/',
      'http://localhost:4201/',
      'http://api.localhost/',
    ]) {
      let result = await executeReadUrl(url, {
        fetch,
      });
      assert.false(result.ok, `${url} is refused`);
      assert.ok(
        !result.ok && result.error.includes('private'),
        `${url} is refused as private`,
      );
    }
    assert.strictEqual(requested.length, 0, 'nothing was fetched');
  });

  test('the real fetch never connects to a hostname that resolves to a private address', async () => {
    // No injected fetch: this exercises the guarded dispatcher every real
    // read uses. The server listens on loopback and must see no request.
    let requests = 0;
    let server = createServer((_req, res) => {
      requests++;
      res.end('internal');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    let { port } = server.address() as AddressInfo;
    try {
      for (let addresses of [['127.0.0.1'], ['93.184.215.14', '127.0.0.1']]) {
        let result = await executeReadUrl(`http://internal.test:${port}/`, {
          resolveHost: async () => addresses,
        });
        assert.false(result.ok, `${addresses.join(', ')} is refused`);
        assert.ok(
          !result.ok && result.error.includes('resolves to a private'),
          'it says why',
        );
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.strictEqual(requests, 0, 'the internal server was never reached');
  });

  test('a redirect to a private address is refused', async () => {
    let { fetch, requested } = fakeFetch({
      'https://example.com/go': {
        status: 301,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      },
    });

    let result = await executeReadUrl('https://example.com/go', {
      fetch,
    });

    assert.false(result.ok);
    assert.deepEqual(
      requested.map((r) => r.url),
      ['https://example.com/go'],
      'the private redirect target is never fetched',
    );
  });

  test('redirects are followed manually up to the limit', async () => {
    let routes: Record<string, FakeRoute> = {};
    for (let i = 0; i <= READ_URL_MAX_REDIRECTS; i++) {
      routes[`https://example.com/${i}`] = {
        status: 302,
        headers: { location: `/${i + 1}` },
      };
    }
    let { fetch, requested } = fakeFetch(routes);

    let result = await executeReadUrl('https://example.com/0', {
      fetch,
    });

    assert.false(result.ok);
    assert.ok(!result.ok && result.error.includes('redirected more than'));
    assert.true(
      requested.every((r) => r.init.redirect === 'manual'),
      'the fetch never follows redirects itself',
    );
  });

  test('non-http schemes and credentials in the URL are refused', async () => {
    let { fetch } = fakeFetch({});
    let fileRead = await executeReadUrl('file:///etc/passwd', { fetch });
    assert.ok(!fileRead.ok && fileRead.error.includes('http and https'));
    let credentialed = await executeReadUrl('https://user:pw@example.com/', {
      fetch,
    });
    assert.ok(!credentialed.ok && credentialed.error.includes('credentials'));
  });

  test('a body over its limit is refused', async () => {
    let { fetch } = fakeFetch({
      'https://example.com/huge.png': {
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array(READ_URL_MAX_MEDIA_BYTES + 1),
      },
      'https://example.com/huge.txt': {
        headers: { 'content-type': 'text/plain' },
        body: 'x'.repeat(READ_URL_MAX_TEXT_BYTES + 1),
      },
    });

    for (let url of [
      'https://example.com/huge.png',
      'https://example.com/huge.txt',
    ]) {
      let result = await executeReadUrl(url, {
        fetch,
      });
      assert.ok(!result.ok && result.error.includes('is larger than'), url);
    }
  });

  test('a long page is truncated with a note', async () => {
    let { fetch } = fakeFetch({
      'https://example.com/long': {
        headers: { 'content-type': 'text/plain' },
        body: 'y'.repeat(READ_URL_MAX_CONTENT_CHARS * 2),
      },
    });

    let result = await executeReadUrl('https://example.com/long', {
      fetch,
    });

    assert.true(result.ok);
    if (!result.ok || result.kind !== 'text') {
      return;
    }
    assert.ok(result.content.includes('[Truncated: showing the first'));
    assert.ok(result.content.length < READ_URL_MAX_CONTENT_CHARS + 200);
  });

  test('unsupported content types and error statuses are reported', async () => {
    let { fetch } = fakeFetch({
      'https://example.com/app.zip': {
        headers: { 'content-type': 'application/zip' },
        body: 'PK',
      },
      'https://example.com/missing': { status: 404 },
    });

    let zip = await executeReadUrl('https://example.com/app.zip', {
      fetch,
    });
    assert.ok(!zip.ok && zip.error.includes('application/zip'));
    let missing = await executeReadUrl('https://example.com/missing', {
      fetch,
    });
    assert.ok(!missing.ok && missing.error.includes('404'));
  });

  test('JSON and other text files come back as text', async () => {
    let { fetch } = fakeFetch({
      'https://example.com/data.json': {
        headers: { 'content-type': 'application/json' },
        body: '{"hello":"world"}',
      },
    });

    let result = await executeReadUrl('https://example.com/data.json', {
      fetch,
    });

    assert.ok(
      result.ok &&
        result.kind === 'text' &&
        result.content.includes('{"hello":"world"}'),
    );
  });
});

module('processHtml', () => {
  test('block wrappers leave a line break so neighboring text stays apart', () => {
    let page = processHtml(
      '<div>first</div><div>second</div><span>in</span><span>line</span>',
      new URL('https://example.com/'),
    );
    assert.strictEqual(page.html, 'first\nsecond\ninline');
  });

  test('lists the srcset candidates of a picture source', () => {
    let page = processHtml(
      `<picture><source srcset="hero.avif 1x, hero@2x.avif 2x" type="image/avif">
       <img src="hero.jpg" alt="Hero"></picture>`,
      new URL('https://example.com/page/'),
    );
    assert.deepEqual(page.images, [
      'https://example.com/page/hero.avif',
      'https://example.com/page/hero@2x.avif',
      'https://example.com/page/hero.jpg',
    ]);
  });

  test('honors <base> when resolving URLs and drops nested dropped content', () => {
    let page = processHtml(
      `<base href="https://cdn.example/assets/">
       <svg><script>x()</script><text>drawn</text></svg>
       <img src="a.png"><a href="javascript:evil()">bad</a><a href="b">good</a>`,
      new URL('https://example.com/page'),
    );
    assert.deepEqual(page.images, ['https://cdn.example/assets/a.png']);
    assert.ok(
      page.html.includes('<a href="https://cdn.example/assets/b">good</a>'),
      'links resolve against <base>',
    );
    assert.notOk(page.html.includes('drawn'), 'svg content is dropped');
    assert.notOk(page.html.includes('javascript:'), 'script URLs are dropped');
  });
});

module('readUrl helpers', () => {
  test('knownRealmOrigins collects realm origins from human message context', () => {
    let history = [
      {
        type: 'm.room.message',
        sender: '@user:localhost',
        content: {
          data: JSON.stringify({
            context: {
              realmUrl: 'http://localhost:4201/user/jane/realm/',
              workspaces: [{ url: 'https://app.example.com/user/jane/other/' }],
              openCardIds: ['https://cards.example/catalog/Thing/1'],
              codeMode: { currentFile: 'http://localhost:4201/x.gts' },
            },
          }),
        },
      },
      {
        type: 'm.room.message',
        sender: '@aibot:localhost',
        content: {
          data: { context: { realmUrl: 'https://ignored.example/' } },
        },
      },
    ] as unknown as DiscreteMatrixEvent[];

    assert.deepEqual(
      [...knownRealmOrigins(history, '@aibot:localhost')].sort(),
      [
        'http://localhost:4201',
        'https://app.example.com',
        'https://cards.example',
      ],
    );
  });

  test('urlFromReadUrlArguments recovers the url from cut-off arguments', () => {
    assert.strictEqual(
      urlFromReadUrlArguments('{"url":"https://example.com/a"}'),
      'https://example.com/a',
    );
    assert.strictEqual(
      urlFromReadUrlArguments('{"url":"https://example.com/b", "desc'),
      'https://example.com/b',
    );
    assert.strictEqual(urlFromReadUrlArguments('{}'), undefined);
  });

  test('readUrlLabel shows the full URL', () => {
    assert.strictEqual(
      readUrlLabel('https://example.com/docs/page?x=1'),
      'Read web page: https://example.com/docs/page?x=1',
    );
    assert.strictEqual(readUrlLabel(undefined), 'Read web page');
  });
});
