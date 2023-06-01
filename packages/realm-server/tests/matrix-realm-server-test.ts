import { module, test } from 'qunit';
import {
  synapseStart,
  synapseStop,
  registerUser,
  createPrivateRoom,
  sendMessage,
  type SynapseInstance,
  type Credentials,
} from '@cardstack/matrix/docker/synapse';
import { MatrixRealm } from '../matrix-realm';

const matrixServerURL = 'http://localhost:8008';

module('Matrix Realm Server', function (hooks) {
  let synapse: SynapseInstance;
  let realm: MatrixRealm;
  let admin: Credentials;

  hooks.beforeEach(async () => {
    synapse = await synapseStart();
    admin = await registerUser(synapse, 'admin', 'pass');

    let { accessToken, deviceId, userId } = admin;
    realm = new MatrixRealm({
      matrixServerURL,
      accessToken,
      userId,
      deviceId,
    });
    await realm.ready;
  });

  hooks.afterEach(async () => {
    realm.shutdown();
    await synapseStop(synapse.synapseId);
  });

  // remove this after we have more tests that show this is working
  test('smoke test', async function (assert) {
    let response = await fetch(`${matrixServerURL}/.well-known/matrix/client`);
    assert.strictEqual(response.status, 200);
    let json = await response.json();
    assert.ok(json['m.homeserver'].base_url, 'Matrix API is working');
  });

  // remove this after we have more tests that show this is working
  QUnit.only('it can index a matrix message', async function (assert) {
    let roomId = await createPrivateRoom(admin.accessToken, 'Room 1');
    await sendMessage(admin.accessToken, roomId, 'Hello World');
    await realm.flushMessages();
    assert.ok(realm, "realm didn't blow up being instantiated");

    // TODO read the message from the index
  });
});
