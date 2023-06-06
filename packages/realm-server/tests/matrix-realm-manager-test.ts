import { module, test } from 'qunit';
import {
  synapseStart,
  synapseStop,
  registerUser,
  joinedRooms,
  sendMessage,
  type SynapseInstance,
  type Credentials,
} from '@cardstack/matrix/docker/synapse';
import { MatrixRealmManager } from '../matrix-realm-manager';

const matrixServerURL = 'http://localhost:8008';

module('Matrix Realm Manager', function (hooks) {
  let synapse: SynapseInstance;
  let indexer: Credentials;
  let user: Credentials;
  let manager: MatrixRealmManager;

  hooks.beforeEach(async () => {
    synapse = await synapseStart();
    indexer = await registerUser(synapse, 'indexer', 'pass');
    process.env.MATRIX_INDEX_USERID = indexer.userId;
    process.env.MATRIX_INDEX_PASSWORD = 'pass';
    user = await registerUser(synapse, 'user', 'pass');
  });

  hooks.afterEach(async () => {
    await manager?.shutdown();
    await synapseStop(synapse.synapseId);
  });

  test('it can add a new room', async function (assert) {
    manager = new MatrixRealmManager(matrixServerURL);
    await manager.ready();

    let realm = await manager.createPrivateRoom(user.accessToken, 'Room 1');
    let userRooms = await joinedRooms(synapse, user.accessToken);
    let indexerRooms = await joinedRooms(synapse, indexer.accessToken);
    assert.strictEqual(userRooms.length, 1);
    assert.deepEqual(userRooms, indexerRooms);
    assert.strictEqual(realm.roomId, indexerRooms[0]);

    assert.strictEqual(manager.realms.size, 1);
    assert.ok(manager.realms.has(indexerRooms[0]));
  });

  test('it can add a multiple rooms', async function (assert) {
    manager = new MatrixRealmManager(matrixServerURL);
    await manager.ready();

    let realm1 = await manager.createPrivateRoom(user.accessToken, 'Room 1');
    let realm2 = await manager.createPrivateRoom(user.accessToken, 'Room 2');

    let userRooms = await joinedRooms(synapse, user.accessToken);
    let indexerRooms = await joinedRooms(synapse, indexer.accessToken);
    assert.strictEqual(userRooms.length, 2);
    assert.deepEqual(userRooms, indexerRooms);
    assert.strictEqual(realm1.roomId, indexerRooms[0]);
    assert.strictEqual(realm2.roomId, indexerRooms[1]);

    assert.strictEqual(manager.realms.size, 2);
    assert.deepEqual([...manager.realms.keys()], indexerRooms);
  });

  // TODO HASSAN START HERE ON WED
  QUnit.skip('it start indexing previously created rooms');
  QUnit.skip('it can index a matrix message');
  QUnit.skip('it can index thru a paginated series of message events'); // TODO we should include a ready promise for this too...
});
