import { module } from 'qunit';
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

// TODO absorb this in the matrix-realm-manager-test module

module('Matrix Realm', function (hooks) {
  let synapse: SynapseInstance;
  let realm: MatrixRealm;
  let user: Credentials;

  hooks.beforeEach(async () => {
    synapse = await synapseStart();
    user = await registerUser(synapse, 'user', 'pass');

    let { accessToken, deviceId, userId } = user;
    realm = new MatrixRealm({
      matrixServerURL,
      accessToken,
      userId,
      deviceId,
    });
  });

  hooks.afterEach(async () => {
    realm.shutdown();
    await synapseStop(synapse.synapseId);
  });

  // remove this after we have more tests that show this is working
  QUnit.skip('smoke test', async function (assert) {
    let response = await fetch(`${matrixServerURL}/.well-known/matrix/client`);
    assert.strictEqual(response.status, 200);
    let json = await response.json();
    assert.ok(json['m.homeserver'].base_url, 'Matrix API is working');
  });

  // remove this after we have more tests that show this is working
  QUnit.skip('it can index a matrix message', async function (assert) {
    let roomId = await createPrivateRoom(synapse, user.accessToken, 'Room 1');
    await sendMessage(synapse, user.accessToken, roomId, 'Hello World');
    await realm.flushMessages();
    assert.ok(realm, "realm didn't blow up being instantiated");

    // TODO read the message from the index
  });

  QUnit.skip(
    'it can paginate thru the timeline events when performing from scratch indexing'
  );
});
