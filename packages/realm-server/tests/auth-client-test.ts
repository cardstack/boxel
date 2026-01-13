import { module, test } from 'qunit';

import '@cardstack/runtime-common/helpers/code-equality-assertion';
import {
  RealmAuthClient,
  type RealmAuthMatrixClientInterface,
} from '@cardstack/runtime-common/realm-auth-client';
import { VirtualNetwork } from '@cardstack/runtime-common';
import jwt from 'jsonwebtoken';
import { basename } from 'path';

function createJWT(
  expiresIn: string | number,
  payload: Record<string, unknown> = {},
) {
  return jwt.sign(payload, 'secret', { expiresIn });
}

module(basename(__filename), function () {
  module('realm-auth-client', function (assert) {
    let client: RealmAuthClient;
    let sessionHandler: (request: Request) => Promise<Response>;
    let openIdToken: {
      access_token: string;
      expires_in: number;
      matrix_server_name: string;
      token_type: string;
    };

    assert.beforeEach(function () {
      openIdToken = {
        access_token: 'matrix-openid-token',
        expires_in: 3600,
        matrix_server_name: 'synapse',
        token_type: 'Bearer',
      };

      let mockMatrixClient = {
        isLoggedIn() {
          return true;
        },
        getUserId() {
          return 'userId';
        },
        async getJoinedRooms() {
          return Promise.resolve({ joined_rooms: [] });
        },
        async joinRoom() {
          return Promise.resolve();
        },
        async sendEvent() {
          return Promise.resolve();
        },
        async hashMessageWithSecret(_message: string): Promise<string> {
          throw new Error('Method not implemented.');
        },
        async getAccountDataFromServer() {
          return {};
        },
        async setAccountData() {
          return Promise.resolve();
        },
        async getOpenIdToken() {
          return openIdToken;
        },
      } as RealmAuthMatrixClientInterface;

      let virtualNetwork = new VirtualNetwork();
      sessionHandler = async () =>
        new Response(null, {
          status: 201,
          headers: {
            Authorization: createJWT('1h', {
              sessionRoom: 'room',
              realmServerURL: 'http://testrealm.com/',
            }),
          },
        });

      virtualNetwork.mount(async (request) => {
        if (request.url === 'http://testrealm.com/_session') {
          return sessionHandler(request);
        }
        return null;
      });

      client = new RealmAuthClient(
        new URL('http://testrealm.com/'),
        mockMatrixClient,
        virtualNetwork.fetch,
      ) as any;
    });

    test('it authenticates and caches the jwt until it expires', async function (assert) {
      let jwtFromClient = await client.getJWT();

      assert.strictEqual(
        jwtFromClient.split('.').length,
        3,
        'jwtFromClient looks like a jwt',
      );

      assert.strictEqual(
        jwtFromClient,
        await client.getJWT(),
        'jwt is the same which means it is cached until it is about to expire',
      );
    });

    test('it refreshes the jwt if it is about to expire in the client', async function (assert) {
      let jwtFromClient = createJWT('10s'); // Expires very soon, so the client will first refresh it
      client['_jwt'] = jwtFromClient;
      assert.notEqual(
        jwtFromClient,
        await client.getJWT(),
        'jwt got refreshed',
      );
    });

    test('it refreshes the jwt if it expired in the client', async function (assert) {
      let jwtFromClient = createJWT(-1); // Expired 1 second ago
      client['_jwt'] = jwtFromClient;
      assert.notEqual(
        jwtFromClient,
        await client.getJWT(),
        'jwt got refreshed',
      );
    });

    test('it includes the realm server url in the jwt claims', async function (assert) {
      let jwtFromClient = await client.getJWT();
      let [_header, payload] = jwtFromClient.split('.');
      let claims = JSON.parse(atob(payload)) as {
        realmServerURL: string;
      };

      assert.strictEqual(
        claims.realmServerURL,
        'http://testrealm.com/',
        'realmServerURL is included in the jwt claims',
      );
    });

    test('it sends the openid token when requesting a realm session', async function (assert) {
      assert.expect(2);
      sessionHandler = async (request) => {
        let requestToken = await request.json();
        assert.deepEqual(
          requestToken,
          openIdToken,
          'matrix openid token was forwarded to the realm session endpoint',
        );
        return new Response(null, {
          status: 201,
          headers: {
            Authorization: createJWT('1h', {
              sessionRoom: 'room',
              realmServerURL: 'http://testrealm.com/',
            }),
          },
        });
      };

      let jwtFromClient = await client.getJWT();
      assert.ok(jwtFromClient, 'received jwt after verifying openid token');
    });

    test('it throws when the openid token cannot be verified by the realm', async function (assert) {
      sessionHandler = async () => {
        return new Response(JSON.stringify({ errors: ['invalid token'] }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await assert.rejects(
        client.getJWT(),
        /expected 'Authorization' header/,
        'missing Authorization header indicates verification failure',
      );
    });
  });
});
