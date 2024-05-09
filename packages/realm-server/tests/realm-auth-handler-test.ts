import { Loader, RealmAuthHandler } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { AuthenticationErrorMessages } from '@cardstack/runtime-common/router';
import { module, test } from 'qunit';

module('realm-auth-handler-test', function () {
  let matrixClient = {
    isLoggedIn() {
      return true;
    },
  } as MatrixClient;

  test('it does not run auth for requests that do not need it', async function (assert) {
    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      {
        fetch: async () => {
          return new Response(null, {
            status: 200,
            headers: {
              'x-boxel-realm-url': 'http://another-test-realm/',
            },
          });
        },
      } as unknown as Loader,
      'http://test-realm/',
    );

    // Case 1: POST request to _session which is for creating a session
    let request1 = new Request('http://localhost/test-realm/_session', {
      method: 'POST',
    });
    let response1 = await realmAuthHandler.fetchWithAuth(request1);
    assert.strictEqual(response1, null);

    // Case 2: HEAD request which is for getting realm info
    let request2 = new Request('http://localhost/test-realm/card', {
      method: 'HEAD',
    });
    let response2 = await realmAuthHandler.fetchWithAuth(request2);
    assert.strictEqual(response2, null);

    // Case 3: Request with Authorization header already set
    let request3 = new Request('http://localhost/test-realm/card', {
      headers: { Authorization: 'Bearer token_1' },
    });
    let response3 = await realmAuthHandler.fetchWithAuth(request3);
    assert.strictEqual(response3, null);
  });

  test('it adds authorization header to the request for target realms that are not publicly readable', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(null, {
          status: 200,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    (realmAuthHandler as any).createRealmAuthClient = () => {
      return {
        getJWT: () => 'Bearer token_1',
      };
    };

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);
    assert.strictEqual(requestsMade.length, 2); // one for realm info, one for the actual request
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);
    assert.strictEqual(requestsMade[1].method, 'GET');
    assert.strictEqual(
      requestsMade[1].headers.get('Authorization'),
      'Bearer token_1',
    );

    // Now test caching the visited realms: cache should be used to avoid re-fetching the realm URL
    requestsMade = [];
    request.headers.delete('Authorization');
    await realmAuthHandler.fetchWithAuth(request);
    assert.strictEqual(requestsMade.length, 1); // Only the actual request should be made, and not the realm info request (the one with HEAD method) because realm info should be cached at this point
    assert.strictEqual(
      requestsMade[0].headers.get('Authorization'),
      'Bearer token_1',
    );
  });

  test('it does not add authorization header to the request for target realms that are publicly readable', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(null, {
          status: 200,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
            'x-boxel-realm-public-readable': 'true',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    // Fetch with autorization header should not be made because the realm is publicly readable
    assert.strictEqual(requestsMade.length, 1);
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);
  });

  test('it does not add authorization header to the request when the realm is making requests to itself', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(null, {
          status: 200,
          headers: {
            'x-boxel-realm-url': 'http://test-realm/',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    let request = new Request('http://test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    // Fetch with autorization header should not be made because the realm is making requests to itself
    assert.strictEqual(requestsMade.length, 1);
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);
  });

  test('retries once when the permissions in the token are outdated (could happen if the user permissions were changed during the life of the JWT)', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(AuthenticationErrorMessages.PermissionMismatch, {
          status: 401,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    let bearerToken = 'Bearer token_1';
    (realmAuthHandler as any).createRealmAuthClient = () => {
      return {
        getJWT: () => {
          let token = bearerToken;
          bearerToken = 'Bearer new_token_for_retry'; // Simulate a new token when this gets called again on retry
          return token;
        },
      };
    };

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    assert.strictEqual(requestsMade.length, 3); // realm info request, actual request, and the retry
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);

    assert.strictEqual(requestsMade[1].method, 'GET');
    assert.strictEqual(
      requestsMade[1].headers.get('Authorization'),
      'Bearer token_1',
    );

    assert.strictEqual(requestsMade.length, 3);
    assert.strictEqual(requestsMade[2].method, 'GET');
    assert.strictEqual(
      requestsMade[2].headers.get('Authorization'),
      'Bearer new_token_for_retry',
    ); // It generated a new token for the retry
  });

  test('retries once when the token expired', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(AuthenticationErrorMessages.TokenExpired, {
          status: 401,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    let bearerToken = 'Bearer token_1';
    (realmAuthHandler as any).createRealmAuthClient = () => {
      return {
        getJWT: () => {
          let token = bearerToken;
          bearerToken = 'Bearer new_token_for_retry'; // Simulate a new token when this gets called again on retry
          return token;
        },
      };
    };

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    // Fetch with autorization header should not be made because the realm is making requests to itself
    assert.strictEqual(requestsMade.length, 3); // realm info request, actual request, and the retry
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);

    assert.strictEqual(requestsMade[1].method, 'GET');
    assert.strictEqual(
      requestsMade[1].headers.get('Authorization'),
      'Bearer token_1',
    );

    assert.strictEqual(requestsMade.length, 3);
    assert.strictEqual(requestsMade[2].method, 'GET');
    assert.strictEqual(
      requestsMade[2].headers.get('Authorization'),
      'Bearer new_token_for_retry',
    ); // It generated a new token for the retry
  });

  test('does not retry on 401 error when the token is invalid', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(AuthenticationErrorMessages.TokenInvalid, {
          status: 401,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    let bearerToken = 'Bearer token_1';
    (realmAuthHandler as any).createRealmAuthClient = () => {
      return {
        getJWT: () => {
          let token = bearerToken;
          bearerToken = 'Bearer new_token_for_retry'; // Simulate a new token when this gets called again on retry
          return token;
        },
      };
    };

    let request = new Request('http://another-test-realm/card');

    let response = await realmAuthHandler.fetchWithAuth(request);

    assert.strictEqual(requestsMade.length, 2); // realm info request and the actual request, but no retry (2 requests made)
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);

    assert.strictEqual(requestsMade[1].method, 'GET');
    assert.strictEqual(
      requestsMade[1].headers.get('Authorization'),
      'Bearer token_1',
    );

    assert.strictEqual(response!.status, 401);
  });

  test('does not retry on 401 error when the auth header is missing', async function (assert) {
    let requestsMade: Request[] = [];
    let loader = {
      fetch: async (request: Request, init?: RequestInit) => {
        request = new Request(request, init);
        requestsMade.push(request);

        return new Response(AuthenticationErrorMessages.MissingAuthHeader, {
          status: 401,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(
      matrixClient,
      loader,
      'http://test-realm/',
    );

    let bearerToken = 'Bearer token_1';
    (realmAuthHandler as any).createRealmAuthClient = () => {
      return {
        getJWT: () => {
          let token = bearerToken;
          bearerToken = 'Bearer new_token_for_retry'; // Simulate a new token when this gets called again on retry
          return token;
        },
      };
    };

    let request = new Request('http://another-test-realm/card');

    let response = await realmAuthHandler.fetchWithAuth(request);

    assert.strictEqual(requestsMade.length, 2); // realm info request and the actual request, but no retry (2 requests made)
    assert.strictEqual(requestsMade[0].method, 'HEAD');
    assert.strictEqual(requestsMade[0].headers.get('Authorization'), null);

    assert.strictEqual(requestsMade[1].method, 'GET');
    assert.strictEqual(
      requestsMade[1].headers.get('Authorization'),
      'Bearer token_1',
    );

    assert.strictEqual(response!.status, 401);
  });
});
