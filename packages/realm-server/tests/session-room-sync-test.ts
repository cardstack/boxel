import { module, test } from 'qunit';
import { basename } from 'path';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { setupPermissionedRealm, realmSecretSeed } from './helpers';
import { getSessionRoom } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { MatrixConfig } from '@cardstack/runtime-common';

module(basename(__filename), function (hooks) {
  const importUserId = '@import-sync:localhost';
  const importRoomId = '!import-sync-room:localhost';
  let dbAdapter: PgAdapter;
  let matrixConfigUsed: MatrixConfig | undefined;

  setupPermissionedRealm(hooks, {
    permissions: {
      '*': ['read'],
    },
    beforeStart: async ({ dbAdapter: adapter, matrixConfig }) => {
      matrixConfigUsed = matrixConfig;
      await seedAccountData(matrixConfig);
      // sanity check: no DB entry before startup
      let existing = await getSessionRoom(adapter, importUserId);
      if (existing) {
        throw new Error('expected no pre-existing session room record');
      }
    },
    onRealmSetup({ dbAdapter: adapter }) {
      dbAdapter = adapter;
    },
  });

  hooks.afterEach(async function () {
    if (matrixConfigUsed) {
      await writeAccountData(matrixConfigUsed, {});
    }
  });

  test('imports legacy session rooms from Matrix account data on startup', async function (assert) {
    let roomId = await getSessionRoom(dbAdapter, importUserId);
    assert.strictEqual(
      roomId,
      importRoomId,
      'boot-time sync imports account-data entries into the database',
    );
  });

  async function seedAccountData(matrixConfig?: MatrixConfig) {
    await writeAccountData(matrixConfig, { [importUserId]: importRoomId });
  }

  async function writeAccountData(
    matrixConfig: MatrixConfig | undefined,
    accountData: Record<string, string>,
  ) {
    let config = matrixConfig ?? {
      url: new URL('http://localhost:8008'),
      username: 'node-test_realm',
    };
    let matrixClient = new MatrixClient({
      matrixURL: config.url,
      username: config.username,
      seed: realmSecretSeed,
    });
    await matrixClient.login();
    await matrixClient.setAccountData('boxel.session-rooms', accountData);
  }
});
