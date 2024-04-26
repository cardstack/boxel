import { Loader, RealmAuthHandler } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
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

    (realmAuthHandler as any).buildRealmAuthClient = () => {
      return {
        getJWT: () => 'Bearer token_2',
      };
    };

    // Case 1: POST request to _session which is for creating a session
    let request1 = new Request('http://localhost/test-realm/_session', {
      method: 'POST',
    });
    await realmAuthHandler.fetchWithAuth(request1);
    assert.false(request1.headers.has('Authorization'));

    // Case 2: HEAD request which is for getting realm info
    let request2 = new Request('http://localhost/test-realm/card', {
      method: 'HEAD',
    });
    await realmAuthHandler.fetchWithAuth(request2);
    assert.false(request2.headers.has('Authorization'));

    // Case 3: Request with Authorization header already set
    let request3 = new Request('http://localhost/test-realm/card', {
      headers: { Authorization: 'Bearer token_1' },
    });
    await realmAuthHandler.fetchWithAuth(request3);
    assert.strictEqual(request3.headers.get('Authorization'), 'Bearer token_1'); // authorization header is not changed (it shouldn't be what realm auth client mock is returning above)
  });

  test('it adds authorization header to the request for target realms that are not publicly readable', async function (assert) {
    let realmInfoFetchCount = 0; // for testing how many times realm info is fetched (to test if realm info caching works)
    let loader = {
      // fetch is used in the handler for fething realm info
      fetch: async () => {
        realmInfoFetchCount++;
        return new Response(null, {
          status: 200,
          headers: {
            'x-boxel-realm-url': 'http://another-test-realm/',
            // x-boxel-realm-public-readable is not set, so the realm is not publicly readable
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
        getJWT: () => 'Bearer token_3',
      };
    };

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    assert.strictEqual(request!.headers.get('Authorization'), 'Bearer token_3'); // Authorization header gets added as a result from getJWT
    assert.strictEqual(realmInfoFetchCount, 1);

    // Now test caching the visited realms: cache should be used to avoid re-fetching the realm URL
    await realmAuthHandler.fetchWithAuth(request);
    assert.strictEqual(request!.headers.get('Authorization'), 'Bearer token_3');
    assert.strictEqual(realmInfoFetchCount, 1); // fetch count should not increase because the realm info should be read from the cache
  });

  test('it does not add authorization header to the request for target realms that are publicly readable', async function (assert) {
    let loader = {
      // fetch is used in the handler for fething realm info
      fetch: async () => {
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

    (realmAuthHandler as any).buildRealmAuthClient = () => {
      return {
        getJWT: () => 'Bearer token_4',
      };
    };

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    assert.false(request!.headers.has('Authorization')); // Authorization header does not get added because the realm is publicly readable
  });

  test('it does not add authorization header to the request when the realm is making requests to itself', async function (assert) {
    let realmURL = 'http://test-realm/';

    let loader = {
      // fetch is used in the handler for fething realm info
      fetch: async () => {
        return new Response(null, {
          status: 200,
          headers: {
            'x-boxel-realm-url': realmURL,
            'x-boxel-realm-public-readable': 'true',
          },
        });
      },
    } as unknown as Loader;

    let realmAuthHandler = new RealmAuthHandler(matrixClient, loader, realmURL);

    (realmAuthHandler as any).buildRealmAuthClient = () => {
      return {
        getJWT: () => 'Bearer token_5',
      };
    };

    let request = new Request(`${realmURL}/card`);
    await realmAuthHandler.fetchWithAuth(request);

    assert.false(request!.headers.has('Authorization')); // Authorization header does not get added because the realm is making a request to itself
  });
});
