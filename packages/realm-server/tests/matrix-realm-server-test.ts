import { module, test } from 'qunit';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '@cardstack/matrix/docker/synapse';
import { MatrixRealm } from '../matrix-realm';

const matrixServerURL = 'http://localhost:8008';

module('Matrix Realm Server', function (hooks) {
  let synapse: SynapseInstance;
  let realm: MatrixRealm;

  hooks.beforeEach(async () => {
    synapse = await synapseStart();
    let { accessToken, deviceId, userId } = await registerUser(
      synapse,
      'admin',
      'pass'
    );
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
  test('it can start a matrix realm', async function (assert) {
    assert.ok(realm, "realm didn't blow up being instantiated");
  });
});
