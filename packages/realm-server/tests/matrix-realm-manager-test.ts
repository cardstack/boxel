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
import { join } from 'path';
import { removeSync, readJSONSync } from 'fs-extra';
import { MatrixRealmManager } from '../matrix-realm-manager';

const matrixServerURL = 'http://localhost:8008';
const roomsFile = join(__dirname, 'data', 'rooms.json');
process.env.INDEX_USER_SECRET = `shh! it's a secret`;
process.env.ROOMS_FILE = roomsFile;

module('Matrix Realm Manager', function (hooks) {
  let synapse: SynapseInstance;
  let user: Credentials;
  let manager: MatrixRealmManager;

  // TODO set rooms file to a test version and cleanup in between each test
  hooks.beforeEach(async () => {
    removeSync(roomsFile);
    synapse = await synapseStart();
    process.env.MATRIX_REGISTRATION_SECRET = synapse.registrationSecret;
    user = await registerUser(synapse, 'user', 'pass');
  });

  hooks.afterEach(async () => {
    manager?.shutdown();
    await synapseStop(synapse.synapseId);
  });

  test('it can add a new room', async function (assert) {
    manager = new MatrixRealmManager(matrixServerURL);
    await manager.ready;

    let { roomId, realm, indexUserId } = await manager.createPrivateRoom(
      user.accessToken,
      'Room 1'
    );
    // TODO figure out better assertions
    assert.ok(roomId, "it didn't blow up");
    assert.ok(realm, "it didn't blow up");

    assert.deepEqual(readJSONSync(roomsFile), {
      [roomId]: {
        userId: indexUserId,
      },
    });
  });

  // TODO: START HERE ON TUES need to backtrack a bit--this test shows that we can only have one
  // matrix client sync per node process
  QUnit.only('it can add a multiple rooms', async function (assert) {
    manager = new MatrixRealmManager(matrixServerURL);
    await manager.ready;

    let {
      roomId: room1Id,
      realm: realm1,
      indexUserId: room1UserId,
    } = await manager.createPrivateRoom(user.accessToken, 'Room 1');
    // TODO figure out better assertions
    assert.ok(realm1, "it didn't blow up");

    let {
      roomId: room2Id,
      realm: realm2,
      indexUserId: room2UserId,
    } = await manager.createPrivateRoom(user.accessToken, 'Room 2');
    // TODO figure out better assertions
    assert.ok(realm2, "it didn't blow up");

    assert.deepEqual(readJSONSync(roomsFile), {
      [room1Id]: {
        userId: room1UserId,
      },
      [room2Id]: {
        userId: room2UserId,
      },
    });
  });

  QUnit.skip('it start indexing previously created rooms');
});
