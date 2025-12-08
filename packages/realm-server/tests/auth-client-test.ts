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

    assert.beforeEach(function () {
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
          return {
            access_token: 'matrix-openid-token',
            expires_in: 3600,
            matrix_server_name: 'synapse',
            token_type: 'Bearer',
          };
        },
      } as RealmAuthMatrixClientInterface;

      let virtualNetwork = new VirtualNetwork();

      client = new RealmAuthClient(
        new URL('http://testrealm.com/'),
        mockMatrixClient,
        virtualNetwork.fetch,
      ) as any;

      // [] notation is a hack to make TS happy so we can set private properties with mocks
      client['initiateSessionRequest'] = async function (): Promise<Response> {
        return new Response(null, {
          status: 201,
          headers: {
            Authorization: createJWT('1h', { sessionRoom: 'room' }),
          },
        });
      };
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
  });
});
