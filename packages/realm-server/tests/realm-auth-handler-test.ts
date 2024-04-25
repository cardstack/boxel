import { Loader, RealmAuthHandler } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { module, test } from 'qunit';

module('realm-auth-handler-test', function () {
  test('it does not run auth for requests that do not need it', async function (assert) {
    let matrixClient = {
      isLoggedIn() {
        return true;
      },
    } as MatrixClient;

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

    let request1 = new Request('http://localhost/test-realm/_session', {
      method: 'POST',
    });
    await realmAuthHandler.fetchWithAuth(request1);
    assert.false(request1.headers.has('Authorization'));

    let request2 = new Request('http://localhost/test-realm/card', {
      method: 'HEAD',
    });
    await realmAuthHandler.fetchWithAuth(request2);
    assert.false(request2.headers.has('Authorization'));

    let request3 = new Request('http://localhost/test-realm/card', {
      headers: { Authorization: 'Bearer token_1' },
    });
    await realmAuthHandler.fetchWithAuth(request3);
    assert.strictEqual(request3.headers.get('Authorization'), 'Bearer token_1'); // authorization header is not changed (it shouldn't be what realm auth client mock is returning above)
  });

  test('it adds authorization header to the request for realms that are not publicly readable', async function (assert) {
    let matrixClient = {
      isLoggedIn() {
        return true;
      },
    } as MatrixClient;

    let realmInfoFetchCount = 0;
    let loader = {
      fetch: async () => {
        // Used for fething realm info
        realmInfoFetchCount++;
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

    (realmAuthHandler as any).buildRealmAuthClient = () => {
      return {
        getJWT: () => 'Bearer token_3',
      };
    };

    let request = new Request('http://another-test-realm/card');

    await realmAuthHandler.fetchWithAuth(request);

    assert.strictEqual(request!.headers.get('Authorization'), 'Bearer token_3'); // Authorization header gets added as a result from getJWT
    assert.strictEqual(realmInfoFetchCount, 1);

    // Now test caching–the visited realms: cache should be used to avoid re-fetching the realm URL
    await realmAuthHandler.fetchWithAuth(request);
    assert.strictEqual(request!.headers.get('Authorization'), 'Bearer token_3');
    assert.strictEqual(realmInfoFetchCount, 1); // fetch count should not increase since the realm info is cached
  });
});
