import { module, test, only } from 'qunit';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '@cardstack/matrix/docker/synapse';
import supertest, { Test, SuperTest } from 'supertest';

const matrixServer = 'http://localhost:8008';

module.only('Append-only Realm Server', function (hooks) {
  let synapse: SynapseInstance;

  hooks.beforeEach(async () => {
    synapse = await synapseStart();
    await registerUser(synapse, 'admin', 'pass');
  });

  hooks.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('smoke test', async function (assert) {
    let response = await fetch(`${matrixServer}/.well-known/matrix/client`);
    assert.strictEqual(response.status, 200);
    let json = await response.json();
    assert.ok(json['m.homeserver'].base_url, 'Matrix API is working');
  });
});
