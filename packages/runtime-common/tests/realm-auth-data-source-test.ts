import QUnit from 'qunit';
const { module, test } = QUnit;

import { RealmAuthDataSource } from '../realm-auth-data-source.ts';

function matrixClient() {
  return {
    isLoggedIn: () => true,
    getUserId: () => '@realm_server:localhost',
    getJoinedRooms: async () => ({ joined_rooms: [] }),
    joinRoom: async () => {},
    sendEvent: async () => {},
    hashMessageWithSecret: async () => '',
    getAccountDataFromServer: async () => null,
    setAccountData: async () => {},
    getOpenIdToken: async () => ({
      access_token: 'openid',
      expires_in: 300,
      matrix_server_name: 'localhost',
      token_type: 'Bearer',
    }),
  };
}

module('realm auth data source', function () {
  test('realm-server workers create sessions through _server-session', async function (assert) {
    let requestedURL: string | undefined;
    let source = new RealmAuthDataSource(
      matrixClient() as any,
      () => async (input) => {
        requestedURL = input instanceof Request ? input.url : input.toString();
        return new Response(null, {
          headers: {
            Authorization: 'eyJhbGciOiJub25lIn0.eyJzZXNzaW9uUm9vbSI6IiJ9.',
          },
        });
      },
      { authWithRealmServer: true },
    );

    await source.reauthenticate('https://realm.example/pretui/');

    assert.strictEqual(requestedURL, 'https://realm.example/_server-session');
  });
});
