import { module, test } from 'qunit';

import '@cardstack/runtime-common/helpers/code-equality-assertion';
import {
  RealmAuthClient,
  type RealmAuthMatrixClientInterface,
} from '@cardstack/runtime-common/realm-auth-client';
import { Loader, VirtualNetwork } from '@cardstack/runtime-common';
import jwt from 'jsonwebtoken';

function createJWT(expiresIn: string | number) {
  return jwt.sign({}, 'secret', { expiresIn });
}

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
    } as RealmAuthMatrixClientInterface;

    let virtualNetwork = new VirtualNetwork();
    let loader = new Loader(virtualNetwork.fetch);

    client = new RealmAuthClient(
      new URL('http://testrealm.com/'),
      mockMatrixClient,
      loader,
    ) as any;

    // [] notation is a hack to make TS happy so we can set private properties with mocks
    client['initiateSessionRequest'] = async function (): Promise<Response> {
      return {
        status: 401,
        json() {
          return Promise.resolve({
            room: 'room',
            challenge: 'challenge',
          });
        },
      } as Response;
    };
    client['challengeRequest'] = async function (): Promise<Response> {
      return {
        headers: {
          get() {
            return createJWT('1h');
          },
        },
      } as unknown as Response;
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
    client['jwt'] = jwtFromClient;
    assert.notEqual(jwtFromClient, await client.getJWT(), 'jwt got refreshed');
  });

  test('it refreshes the jwt if it expired in the client', async function (assert) {
    let jwtFromClient = createJWT(-1); // Expired 1 second ago
    client['jwt'] = jwtFromClient;
    assert.notEqual(jwtFromClient, await client.getJWT(), 'jwt got refreshed');
  });
});
