import { module, test } from 'qunit';

// Test the auth service worker's fetch interception logic by simulating
// the SW environment. The actual SW is at public/auth-service-worker.js.
//
// We duplicate the core logic here (token matching, fetch interception)
// to test it in a standard QUnit context where service workers aren't available.

function createServiceWorkerEnv() {
  const realmTokens = new Map<string, string>();

  let processMessage = (data: any) => {
    if (!data || !data.type) return;
    switch (data.type) {
      case 'set-realm-token':
        if (data.realmURL && data.token) {
          realmTokens.set(data.realmURL, data.token);
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
            }
          }
        }
        break;
    }
  };

  let processFetch = (request: Request): Request | null => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null; // pass through
    }
    if (request.headers.get('Authorization')) {
      return null; // pass through
    }

    let url = request.url;
    let matchedRealmURL: string | null = null;
    let matchedToken: string | null = null;
    for (let [realmURL, token] of realmTokens) {
      if (url.startsWith(realmURL)) {
        if (!matchedRealmURL || realmURL.length > matchedRealmURL.length) {
          matchedRealmURL = realmURL;
          matchedToken = token;
        }
      }
    }

    if (!matchedToken) {
      return null; // pass through
    }

    let headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${matchedToken}`);
    return new Request(request, { headers });
  };

  return { processMessage, processFetch, realmTokens };
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
  });

  module('fetch interception', function () {
    test('injects Authorization header for matching realm URL', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request(
        'http://localhost:4201/user/realm/images/photo.png',
      );
      let result = sw.processFetch(request);

      assert.ok(result, 'request was intercepted');
      assert.strictEqual(
        result!.headers.get('Authorization'),
        'Bearer my-jwt-token',
      );
    });

    test('passes through requests to non-realm URLs', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request('https://cdn.example.com/image.png');
      let result = sw.processFetch(request);

      assert.strictEqual(result, null, 'request was not intercepted');
    });

    test('passes through POST requests even for realm URLs', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request('http://localhost:4201/user/realm/card.json', {
        method: 'POST',
      });
      let result = sw.processFetch(request);

      assert.strictEqual(result, null, 'POST request was not intercepted');
    });

    test('passes through requests that already have Authorization header', function (assert) {
      let sw = createServiceWorkerEnv();

      sw.processMessage({
        type: 'set-realm-token',
        realmURL: 'http://localhost:4201/user/realm/',
        token: 'my-jwt-token',
      });

      let request = new Request('http://localhost:4201/user/realm/card.json', {
        headers: { Authorization: 'Bearer existing-token' },
      });
      let result = sw.processFetch(request);

      assert.strictEqual(
        result,
        null,
        'request with existing auth was not intercepted',
      );
    });

    test('uses longest-prefix match when multiple realms match', function (assert) {
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
      let result = sw.processFetch(request);

      assert.ok(result, 'request was intercepted');
      assert.strictEqual(
        result!.headers.get('Authorization'),
        'Bearer realm-specific-token',
        'used the more specific realm token',
      );
    });

    test('intercepts HEAD requests', function (assert) {
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
      let result = sw.processFetch(request);

      assert.ok(result, 'HEAD request was intercepted');
      assert.strictEqual(
        result!.headers.get('Authorization'),
        'Bearer my-jwt-token',
      );
    });

    test('returns null when no tokens are set', function (assert) {
      let sw = createServiceWorkerEnv();

      let request = new Request('http://localhost:4201/user/realm/image.png');
      let result = sw.processFetch(request);

      assert.strictEqual(result, null, 'no interception without tokens');
    });
  });
});
