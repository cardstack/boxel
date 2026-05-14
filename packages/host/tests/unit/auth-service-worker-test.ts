import { module, test } from 'qunit';

// Test the auth service worker's fetch interception logic by simulating
// the SW environment. The actual SW is at public/auth-service-worker.js.
//
// We duplicate the core logic here (token matching, fetch interception,
// on-miss client fallback) to test it in a standard QUnit context where
// service workers aren't available.

function createServiceWorkerEnv(
  opts: {
    // Simulates the response the controlling client would send when the SW
    // requests a token via MessageChannel. Returns `undefined` to indicate
    // the page has no token for that request URL.
    clientTokenLookup?: (
      requestURL: string,
    ) => Promise<{ realmURL: string; token: string } | undefined>;
    // Mirrors the SW's TOKEN_REQUEST_TIMEOUT_MS. When `clientTokenLookup`
    // does not settle within this timeout, the scaffold resolves to
    // `undefined` just like the real SW would.
    tokenRequestTimeoutMs?: number;
  } = {},
) {
  const realmTokens = new Map<string, string>();
  const realmHosts = new Set<string>();
  const inflightTokenRequests = new Map<string, Promise<string | undefined>>();

  function recordRealmHost(realmURL: string) {
    try {
      realmHosts.add(new URL(realmURL).origin);
    } catch {
      /* ignore */
    }
  }

  let processMessage = (data: any) => {
    if (!data || !data.type) return;
    switch (data.type) {
      case 'set-realm-token':
        if (data.realmURL && data.token) {
          realmTokens.set(data.realmURL, data.token);
          recordRealmHost(data.realmURL);
        }
        break;
      case 'remove-realm-token':
        if (data.realmURL) {
          realmTokens.delete(data.realmURL);
        }
        break;
      case 'clear-tokens':
        realmTokens.clear();
        break;
      case 'sync-tokens':
        realmTokens.clear();
        if (data.tokens) {
          for (let [realmURL, token] of Object.entries(data.tokens)) {
            if (token) {
              realmTokens.set(realmURL, token as string);
              recordRealmHost(realmURL);
            }
          }
        }
        break;
    }
  };

  function lookupToken(url: string): string | undefined {
    let bestRealmURL: string | undefined;
    let bestToken: string | undefined;
    for (let [realmURL, token] of realmTokens) {
      if (url.startsWith(realmURL)) {
        if (!bestRealmURL || realmURL.length > bestRealmURL.length) {
          bestRealmURL = realmURL;
          bestToken = token;
        }
      }
    }
    return bestToken;
  }

  async function requestTokenFromClient(
    requestURL: string,
  ): Promise<string | undefined> {
    let existing = inflightTokenRequests.get(requestURL);
    if (existing) return existing;
    let promise = (async () => {
      if (!opts.clientTokenLookup) return undefined;
      let lookup = opts.clientTokenLookup(requestURL);
      let reply: { realmURL: string; token: string } | undefined;
      if (typeof opts.tokenRequestTimeoutMs === 'number') {
        reply = await Promise.race([
          lookup,
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), opts.tokenRequestTimeoutMs),
          ),
        ]);
      } else {
        reply = await lookup;
      }
      if (reply && reply.realmURL && reply.token) {
        realmTokens.set(reply.realmURL, reply.token);
        recordRealmHost(reply.realmURL);
        return reply.token;
      }
      return undefined;
    })();
    inflightTokenRequests.set(requestURL, promise);
    promise.finally(() => inflightTokenRequests.delete(requestURL));
    return promise;
  }

  function buildAuthedRequest(request: Request, token: string): Request {
    let headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return new Request(request, { headers, mode: 'cors' });
  }

  // Returns:
  //   - Request: the SW would respondWith fetch of this authed Request
  //   - 'pass-through': the SW would not intercept (returns from fetch handler)
  //   - 'fallthrough-fetch': the SW called respondWith but with the original
  //     request (client had no token); will hit the network unauth'd
  let processFetch = async (
    request: Request,
  ): Promise<Request | 'pass-through' | 'fallthrough-fetch'> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return 'pass-through';
    }
    if (request.headers.get('Authorization')) {
      return 'pass-through';
    }

    let url = request.url;
    let matchedToken = lookupToken(url);
    if (matchedToken) {
      return buildAuthedRequest(request, matchedToken);
    }

    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return 'pass-through';
    }
    if (realmHosts.size > 0 && !realmHosts.has(origin)) {
      return 'pass-through';
    }

    let token = await requestTokenFromClient(url);
    if (token) {
      return buildAuthedRequest(request, token);
    }
    return 'fallthrough-fetch';
  };

  return {
    processMessage,
    processFetch,
    realmTokens,
    realmHosts,
    inflightTokenRequests,
  };
}

module('Unit | auth-service-worker', function () {
  module('token management via messages', function () {
    test('set-realm-token stores a token', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'jwt-token-123',
      });

      assert.strictEqual(sw.realmTokens.size, 1);
      assert.strictEqual(
        sw.realmTokens.get('http://localhost:4201/user/realm/'),
        'jwt-token-123',
      );
    });

    test('remove-realm-token deletes a token', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'jwt-token-123',
      });
      sw.processMessage({
        type: 'remove-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
      });

      assert.strictEqual(sw.realmTokens.size, 0);
    });

    test('clear-tokens removes all tokens', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/realm-a/',
        token: 'token-a',
      });
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/realm-b/',
        token: 'token-b',
      });
      sw.processMessage({ type: 'clear-tokens' });

      assert.strictEqual(sw.realmTokens.size, 0);
    });

    test('sync-tokens replaces all tokens', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/old-realm/',
        token: 'old-token',
      });

      sw.processMessage({
        type: 'sync-tokens',
        tokens: {
          'http://localhost:4201/realm-a/': 'token-a',
          'http://localhost:4201/realm-b/': 'token-b',
        },
      });

      assert.strictEqual(sw.realmTokens.size, 2);
      assert.strictEqual(
        sw.realmTokens.get('http://localhost:4201/realm-a/'),
        'token-a',
      );
      assert.strictEqual(
        sw.realmTokens.get('http://localhost:4201/realm-b/'),
        'token-b',
      );
      assert.strictEqual(
        sw.realmTokens.get('http://localhost:4201/old-realm/'),
        undefined,
        'old token was replaced',
      );
    });

    test('ignores messages with missing type', function (assert) {
      let sw = createServiceWorkerEnv();
      sw.processMessage({});
      sw.processMessage(null);
      sw.processMessage({ realmURL: 'http://example.com/', token: 'x' });
      assert.strictEqual(sw.realmTokens.size, 0);
    });

    test('realmHosts is populated on token sync', function (assert) {
      let sw = createServiceWorkerEnv();
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 't',
      });
      assert.true(sw.realmHosts.has('http://localhost:4201'));

      sw.processMessage({
        type: 'sync-tokens',
        tokens: { 'https://app.boxel.ai/user/realm/': 't2' },
      });
      assert.true(sw.realmHosts.has('https://app.boxel.ai'));
    });
  });

  module('fetch interception', function () {
    test('injects Authorization header for matching realm URL', async function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request(
        'http://localhost:4201/user/realm/images/photo.png',
      );
      let result = await sw.processFetch(request);

      assert.ok(result instanceof Request, 'request was intercepted');
      assert.strictEqual(
        (result as Request).headers.get('Authorization'),
        'Bearer my-jwt-token',
      );
    });

    test('passes through requests to non-realm hosts (no message round-trip)', async function (assert) {
      let sw = createServiceWorkerEnv({
        clientTokenLookup: async () => {
          assert.notOk(true, 'should not ask the client for unknown hosts');
          return undefined;
        },
      });

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request('https://cdn.example.com/image.png');
      let result = await sw.processFetch(request);

      assert.strictEqual(result, 'pass-through');
    });

    test('passes through POST requests even for realm URLs', async function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request('http://localhost:4201/user/realm/card.json', {
        method: 'POST',
      });
      let result = await sw.processFetch(request);

      assert.strictEqual(result, 'pass-through');
    });

    test('passes through requests that already have Authorization header', async function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request('http://localhost:4201/user/realm/card.json', {
        headers: { Authorization: 'Bearer existing-token' },
      });
      let result = await sw.processFetch(request);

      assert.strictEqual(result, 'pass-through');
    });

    test('uses longest-prefix match when multiple realms match', async function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/',
        token: 'server-token',
      });
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'realm-specific-token',
      });

      let request = new Request(
        'http://localhost:4201/user/realm/images/photo.png',
      );
      let result = await sw.processFetch(request);

      assert.ok(result instanceof Request);
      assert.strictEqual(
        (result as Request).headers.get('Authorization'),
        'Bearer realm-specific-token',
      );
    });

    test('intercepts HEAD requests', async function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request(
        'http://localhost:4201/user/realm/images/photo.png',
        { method: 'HEAD' },
      );
      let result = await sw.processFetch(request);

      assert.ok(result instanceof Request);
      assert.strictEqual(
        (result as Request).headers.get('Authorization'),
        'Bearer my-jwt-token',
      );
    });

    test('upgrades request mode to cors for intercepted requests', async function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request(
        'http://localhost:4201/user/realm/images/photo.png',
        { mode: 'no-cors' },
      );
      let result = await sw.processFetch(request);

      assert.ok(result instanceof Request);
      assert.strictEqual((result as Request).mode, 'cors');
      assert.strictEqual(
        (result as Request).headers.get('Authorization'),
        'Bearer my-jwt-token',
      );
    });

    test('falls through (does not pass-through) at cold start with no client available', async function (assert) {
      // realmHosts is empty so the SW does not know which origins are realm
      // hosts and must try the on-miss client lookup. With no client and no
      // token, the SW lands in the unauthed-refetch path rather than
      // skipping interception entirely.
      let sw = createServiceWorkerEnv();

      let request = new Request('http://localhost:4201/user/realm/image.png');
      let result = await sw.processFetch(request);

      assert.strictEqual(result, 'fallthrough-fetch');
    });
  });

  module('on-miss client fallback', function () {
    test('asks the client for a token when the host is known but no token matches', async function (assert) {
      let askCount = 0;
      let sw = createServiceWorkerEnv({
        clientTokenLookup: async (requestURL) => {
          askCount += 1;
          assert.strictEqual(
            requestURL,
            'http://localhost:4201/other-realm/image.png',
          );
          return {
            realmURL: 'http://localhost:4201/other-realm/',
            token: 'late-arriving-token',
          };
        },
      });

      // Seed realmHosts via a prior token for a different realm on the same host.
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'existing-token',
      });

      let request = new Request('http://localhost:4201/other-realm/image.png');
      let result = await sw.processFetch(request);

      assert.strictEqual(askCount, 1, 'client was asked exactly once');
      assert.ok(result instanceof Request, 'request was retried with auth');
      assert.strictEqual(
        (result as Request).headers.get('Authorization'),
        'Bearer late-arriving-token',
      );
      // Token is now cached in the SW for next time.
      assert.strictEqual(
        sw.realmTokens.get('http://localhost:4201/other-realm/'),
        'late-arriving-token',
      );
    });

    test('single-flights concurrent miss requests for the same URL', async function (assert) {
      let askCount = 0;
      let release: () => void;
      let releaseSignal = new Promise<void>((resolve) => {
        release = resolve;
      });
      let sw = createServiceWorkerEnv({
        clientTokenLookup: async () => {
          askCount += 1;
          await releaseSignal;
          return {
            realmURL: 'http://localhost:4201/r/',
            token: 'tok',
          };
        },
      });
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/seed/',
        token: 'seed',
      });

      // Fire two concurrent requests for the same URL before the first
      // ask resolves.
      let p1 = sw.processFetch(
        new Request('http://localhost:4201/r/image.png'),
      );
      let p2 = sw.processFetch(
        new Request('http://localhost:4201/r/image.png'),
      );

      // The client should only have been asked once even though two requests
      // are in flight.
      release!();
      await Promise.all([p1, p2]);
      assert.strictEqual(askCount, 1, 'client asked exactly once');
    });

    test('falls through to unauthed fetch when client has no token', async function (assert) {
      let sw = createServiceWorkerEnv({
        clientTokenLookup: async () => undefined,
      });
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/seed/',
        token: 'seed',
      });

      let result = await sw.processFetch(
        new Request('http://localhost:4201/unknown/image.png'),
      );
      assert.strictEqual(result, 'fallthrough-fetch');
    });

    test('asks the client at cold start when realmHosts is empty', async function (assert) {
      // SW just activated, page has not synced yet: realmHosts is empty.
      // The page may still hold valid tokens in localStorage, so the SW
      // must reach out instead of silently passing through.
      let sw = createServiceWorkerEnv({
        clientTokenLookup: async (requestURL) => {
          assert.strictEqual(
            requestURL,
            'http://localhost:4201/realm/image.png',
          );
          return {
            realmURL: 'http://localhost:4201/realm/',
            token: 'late-synced-token',
          };
        },
      });

      let result = await sw.processFetch(
        new Request('http://localhost:4201/realm/image.png'),
      );

      assert.ok(result instanceof Request);
      assert.strictEqual(
        (result as Request).headers.get('Authorization'),
        'Bearer late-synced-token',
      );
      assert.true(
        sw.realmHosts.has('http://localhost:4201'),
        'realmHosts is populated after the cold-start lookup',
      );
    });

    test('times out and falls through when the client never replies', async function (assert) {
      // Simulates an old controlled tab that has no request-realm-token
      // listener installed. The SW must not hang waiting for it.
      let sw = createServiceWorkerEnv({
        tokenRequestTimeoutMs: 10,
        clientTokenLookup: () => new Promise(() => {}),
      });
      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/seed/',
        token: 'seed',
      });

      let result = await sw.processFetch(
        new Request('http://localhost:4201/r/image.png'),
      );
      assert.strictEqual(result, 'fallthrough-fetch');
    });
  });
});
