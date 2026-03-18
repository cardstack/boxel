import { module, test } from 'qunit';
import { basename, join } from 'path';
import { existsSync } from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

import {
  asExpressions,
  insert,
  insertPermissions,
  PUBLISHED_DIRECTORY_NAME,
  query,
} from '@cardstack/runtime-common';

import { insertJob, insertUser, realmSecretSeed } from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { setupServerEndpointsTest } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function (hooks) {
  let context = setupServerEndpointsTest(hooks);

  async function createRealmFor(ownerUserId: string) {
    let endpoint = `delete-me-${uuidv4()}`;
    let response = await context.request
      .post('/_create-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            attributes: {
              name: 'Delete Me Realm',
              endpoint,
            },
          },
        }),
      );

    if (response.status !== 201) {
      throw new Error(
        `/_create-realm failed: ${JSON.stringify(response.body)}`,
      );
    }

    return response.body.data.id as string;
  }

  async function insertIndexEntry(args: {
    table: 'boxel_index' | 'boxel_index_working';
    realmURL: string;
    url: string;
  }) {
    let { nameExpressions, valueExpressions } = asExpressions({
      url: args.url,
      file_alias: args.url,
      type: 'instance',
      realm_version: 1,
      realm_url: args.realmURL,
    });
    await query(
      context.dbAdapter,
      insert(args.table, nameExpressions, valueExpressions),
    );
  }

  async function insertModuleEntry(realmURL: string, url: string) {
    let { nameExpressions, valueExpressions } = asExpressions({
      url,
      cache_scope: 'public',
      auth_user_id: '',
      resolved_realm_url: realmURL,
    });
    await query(
      context.dbAdapter,
      insert('modules', nameExpressions, valueExpressions),
    );
  }

  async function insertRealmFileMeta(realmURL: string, filePath: string) {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: realmURL,
      file_path: filePath,
      created_at: Math.floor(Date.now() / 1000),
    });
    await query(
      context.dbAdapter,
      insert('realm_file_meta', nameExpressions, valueExpressions),
    );
  }

  test('DELETE /_delete-realm removes a created realm, its published copies, and related domain claims', async function (assert) {
    let owner = `mango-${uuidv4()}`;
    let ownerUserId = `@${owner}:localhost`;
    let realmURL = await createRealmFor(ownerUserId);
    let realmPath = new URL(realmURL).pathname.split('/').filter(Boolean);
    let publishedRealmURL = `http://${owner}.localhost:4445/published-${uuidv4()}/`;
    let unrelatedRealmURL = `http://papaya.localhost:4445/unrelated-${uuidv4()}/`;

    let user = await insertUser(
      context.dbAdapter,
      ownerUserId,
      'cus_delete_realm',
      'mango@example.com',
    );

    let publishResponse = await context.request
      .post('/_publish-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          sourceRealmURL: realmURL,
          publishedRealmURL,
        }),
      );

    assert.strictEqual(publishResponse.status, 201, 'published realm created');
    let publishedRealmId = publishResponse.body.data.id as string;

    let sourceIndexURL = `${realmURL}cleanup-${uuidv4()}.json`;
    let publishedIndexURL = `${publishedRealmURL}cleanup-${uuidv4()}.json`;
    let unrelatedIndexURL = `${unrelatedRealmURL}cleanup-${uuidv4()}.json`;
    let sourceWorkingIndexURL = `${realmURL}working-${uuidv4()}.json`;
    let publishedWorkingIndexURL = `${publishedRealmURL}working-${uuidv4()}.json`;
    let unrelatedWorkingIndexURL = `${unrelatedRealmURL}working-${uuidv4()}.json`;
    let sourceModuleURL = `${realmURL}person`;
    let publishedModuleURL = `${publishedRealmURL}person`;
    let unrelatedModuleURL = `${unrelatedRealmURL}person`;
    let sourceFileMetaPath = `cleanup-${uuidv4()}.json`;
    let publishedFileMetaPath = `cleanup-${uuidv4()}.json`;
    let unrelatedFileMetaPath = `cleanup-${uuidv4()}.json`;

    await insertIndexEntry({
      table: 'boxel_index',
      realmURL,
      url: sourceIndexURL,
    });
    await insertIndexEntry({
      table: 'boxel_index',
      realmURL: publishedRealmURL,
      url: publishedIndexURL,
    });
    await insertIndexEntry({
      table: 'boxel_index',
      realmURL: unrelatedRealmURL,
      url: unrelatedIndexURL,
    });

    await insertIndexEntry({
      table: 'boxel_index_working',
      realmURL,
      url: sourceWorkingIndexURL,
    });
    await insertIndexEntry({
      table: 'boxel_index_working',
      realmURL: publishedRealmURL,
      url: publishedWorkingIndexURL,
    });
    await insertIndexEntry({
      table: 'boxel_index_working',
      realmURL: unrelatedRealmURL,
      url: unrelatedWorkingIndexURL,
    });

    await insertModuleEntry(realmURL, sourceModuleURL);
    await insertModuleEntry(publishedRealmURL, publishedModuleURL);
    await insertModuleEntry(unrelatedRealmURL, unrelatedModuleURL);
    await insertRealmFileMeta(realmURL, sourceFileMetaPath);
    await insertRealmFileMeta(publishedRealmURL, publishedFileMetaPath);
    await insertRealmFileMeta(unrelatedRealmURL, unrelatedFileMetaPath);

    let existingSourceRealmVersionRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_versions WHERE realm_url = '${realmURL}'`,
    );
    let existingPublishedRealmVersionRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_versions WHERE realm_url = '${publishedRealmURL}'`,
    );
    assert.ok(
      existingSourceRealmVersionRows.length > 0,
      'source realm rows exist in realm_versions before deletion',
    );
    assert.ok(
      existingPublishedRealmVersionRows.length > 0,
      'published realm rows exist in realm_versions before deletion',
    );

    let {
      nameExpressions: realmVersionNames,
      valueExpressions: realmVersionValues,
    } = asExpressions({
      realm_url: unrelatedRealmURL,
      current_version: 77,
    });
    await query(
      context.dbAdapter,
      insert('realm_versions', realmVersionNames, realmVersionValues),
    );

    for (let [cleanupRealmURL, realmVersion] of [
      [realmURL, 91],
      [publishedRealmURL, 92],
      [unrelatedRealmURL, 93],
    ] as const) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          realm_url: cleanupRealmURL,
          realm_version: realmVersion,
          value: {
            scopedCssLinks: [],
            types: {},
            adoptsFromMap: {},
          },
        },
        {
          jsonFields: ['value'],
        },
      );
      await query(
        context.dbAdapter,
        insert('realm_meta', nameExpressions, valueExpressions),
      );
    }

    let runningSourceJob = await insertJob(context.dbAdapter, {
      job_type: 'from-scratch-index',
      concurrency_group: `indexing:${realmURL}`,
    });
    let runningPublishedJob = await insertJob(context.dbAdapter, {
      job_type: 'from-scratch-index',
      concurrency_group: `indexing:${publishedRealmURL}`,
    });
    let unrelatedJob = await insertJob(context.dbAdapter, {
      job_type: 'from-scratch-index',
      concurrency_group: `indexing:${unrelatedRealmURL}`,
    });
    await context.dbAdapter.execute(`INSERT INTO job_reservations
      (job_id, locked_until, worker_id)
      VALUES (${runningSourceJob.id}, NOW() + INTERVAL '5 minutes', 'worker-source')`);
    await context.dbAdapter.execute(`INSERT INTO job_reservations
      (job_id, locked_until, worker_id)
      VALUES (${runningPublishedJob.id}, NOW() + INTERVAL '5 minutes', 'worker-published')`);
    await context.dbAdapter.execute(`INSERT INTO job_reservations
      (job_id, locked_until, worker_id)
      VALUES (${unrelatedJob.id}, NOW() + INTERVAL '5 minutes', 'worker-unrelated')`);
    await context.dbAdapter.execute(`INSERT INTO session_rooms
      (realm_url, matrix_user_id, room_id)
      VALUES ('${realmURL}', '${ownerUserId}', 'source-room')`);
    await context.dbAdapter.execute(`INSERT INTO session_rooms
      (realm_url, matrix_user_id, room_id)
      VALUES ('${publishedRealmURL}', '@published:localhost', 'published-room')`);
    await context.dbAdapter.execute(`INSERT INTO session_rooms
      (realm_url, matrix_user_id, room_id)
      VALUES ('${unrelatedRealmURL}', '@unrelated:localhost', 'unrelated-room')`);

    let { valueExpressions, nameExpressions } = asExpressions({
      user_id: user.id,
      source_realm_url: realmURL,
      hostname: 'delete-me.boxel.site',
      claimed_at: Math.floor(Date.now() / 1000),
    });
    await query(
      context.dbAdapter,
      insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
    );

    let deleteResponse = await context.request
      .delete('/_delete-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            id: realmURL,
          },
        }),
      );

    assert.strictEqual(deleteResponse.status, 204, 'realm deleted');
    assert.false(
      existsSync(
        join(context.dir.name, 'realm_server_2', realmPath[0]!, realmPath[1]!),
      ),
      'source realm directory was removed after realm deletion',
    );
    assert.false(
      existsSync(
        join(
          context.dir.name,
          'realm_server_2',
          '_published',
          publishedRealmId,
        ),
      ),
      'published realm directory was removed after realm deletion',
    );

    let remainingPermissions = await context.dbAdapter.execute(
      `SELECT * FROM realm_user_permissions WHERE realm_url = '${realmURL}'`,
    );
    assert.strictEqual(
      remainingPermissions.length,
      0,
      'source realm permissions are removed',
    );

    let remainingPublishedRows = await context.dbAdapter.execute(
      `SELECT * FROM published_realms WHERE source_realm_url = '${realmURL}'`,
    );
    assert.strictEqual(
      remainingPublishedRows.length,
      0,
      'published realm records are removed',
    );

    let sourceIndexRows = await context.dbAdapter.execute(
      `SELECT * FROM boxel_index WHERE realm_url = '${realmURL}'`,
    );
    let publishedIndexRows = await context.dbAdapter.execute(
      `SELECT * FROM boxel_index WHERE realm_url = '${publishedRealmURL}'`,
    );
    let unrelatedIndexRows = await context.dbAdapter.execute(
      `SELECT * FROM boxel_index WHERE realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      sourceIndexRows.length,
      0,
      'source realm rows are removed from boxel_index',
    );
    assert.strictEqual(
      publishedIndexRows.length,
      0,
      'published realm rows are removed from boxel_index',
    );
    assert.ok(
      unrelatedIndexRows.length > 0,
      'unrelated realm rows remain in boxel_index',
    );

    let sourceWorkingRows = await context.dbAdapter.execute(
      `SELECT * FROM boxel_index_working WHERE realm_url = '${realmURL}'`,
    );
    let publishedWorkingRows = await context.dbAdapter.execute(
      `SELECT * FROM boxel_index_working WHERE realm_url = '${publishedRealmURL}'`,
    );
    let unrelatedWorkingRows = await context.dbAdapter.execute(
      `SELECT * FROM boxel_index_working WHERE realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      sourceWorkingRows.length,
      0,
      'source realm rows are removed from boxel_index_working',
    );
    assert.strictEqual(
      publishedWorkingRows.length,
      0,
      'published realm rows are removed from boxel_index_working',
    );
    assert.ok(
      unrelatedWorkingRows.length > 0,
      'unrelated realm rows remain in boxel_index_working',
    );

    let sourceModuleRows = await context.dbAdapter.execute(
      `SELECT * FROM modules WHERE resolved_realm_url = '${realmURL}'`,
    );
    let publishedModuleRows = await context.dbAdapter.execute(
      `SELECT * FROM modules WHERE resolved_realm_url = '${publishedRealmURL}'`,
    );
    let unrelatedModuleRows = await context.dbAdapter.execute(
      `SELECT * FROM modules WHERE resolved_realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      sourceModuleRows.length,
      0,
      'source realm rows are removed from modules',
    );
    assert.strictEqual(
      publishedModuleRows.length,
      0,
      'published realm rows are removed from modules',
    );
    assert.strictEqual(
      unrelatedModuleRows.length,
      1,
      'unrelated realm rows remain in modules',
    );

    let remainingSourceRealmVersionRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_versions WHERE realm_url = '${realmURL}'`,
    );
    let remainingPublishedRealmVersionRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_versions WHERE realm_url = '${publishedRealmURL}'`,
    );
    let remainingUnrelatedRealmVersionRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_versions WHERE realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      remainingSourceRealmVersionRows.length,
      0,
      'source realm rows are removed from realm_versions',
    );
    assert.strictEqual(
      remainingPublishedRealmVersionRows.length,
      0,
      'published realm rows are removed from realm_versions',
    );
    assert.strictEqual(
      remainingUnrelatedRealmVersionRows.length,
      1,
      'unrelated realm rows remain in realm_versions',
    );

    let sourceRealmMetaRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_meta WHERE realm_url = '${realmURL}'`,
    );
    let publishedRealmMetaRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_meta WHERE realm_url = '${publishedRealmURL}'`,
    );
    let unrelatedRealmMetaRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_meta WHERE realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      sourceRealmMetaRows.length,
      0,
      'source realm rows are removed from realm_meta',
    );
    assert.strictEqual(
      publishedRealmMetaRows.length,
      0,
      'published realm rows are removed from realm_meta',
    );
    assert.strictEqual(
      unrelatedRealmMetaRows.length,
      1,
      'unrelated realm rows remain in realm_meta',
    );

    let sourceRealmFileMetaRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_file_meta WHERE realm_url = '${realmURL}'`,
    );
    let publishedRealmFileMetaRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_file_meta WHERE realm_url = '${publishedRealmURL}'`,
    );
    let unrelatedRealmFileMetaRows = await context.dbAdapter.execute(
      `SELECT * FROM realm_file_meta WHERE realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      sourceRealmFileMetaRows.length,
      0,
      'source realm rows are removed from realm_file_meta',
    );
    assert.strictEqual(
      publishedRealmFileMetaRows.length,
      0,
      'published realm rows are removed from realm_file_meta',
    );
    assert.strictEqual(
      unrelatedRealmFileMetaRows.length,
      1,
      'unrelated realm rows remain in realm_file_meta',
    );

    let sourceSessionRooms = await context.dbAdapter.execute(
      `SELECT * FROM session_rooms WHERE realm_url = '${realmURL}'`,
    );
    let publishedSessionRooms = await context.dbAdapter.execute(
      `SELECT * FROM session_rooms WHERE realm_url = '${publishedRealmURL}'`,
    );
    let unrelatedSessionRooms = await context.dbAdapter.execute(
      `SELECT * FROM session_rooms WHERE realm_url = '${unrelatedRealmURL}'`,
    );
    assert.strictEqual(
      sourceSessionRooms.length,
      0,
      'source realm rows are removed from session_rooms',
    );
    assert.strictEqual(
      publishedSessionRooms.length,
      0,
      'published realm rows are removed from session_rooms',
    );
    assert.strictEqual(
      unrelatedSessionRooms.length,
      1,
      'unrelated realm rows remain in session_rooms',
    );

    let pendingSourceJobs = await context.dbAdapter.execute(
      `SELECT * FROM jobs WHERE concurrency_group = 'indexing:${realmURL}' AND status = 'unfulfilled'`,
    );
    let pendingPublishedJobs = await context.dbAdapter.execute(
      `SELECT * FROM jobs WHERE concurrency_group = 'indexing:${publishedRealmURL}' AND status = 'unfulfilled'`,
    );
    let pendingUnrelatedJobs = await context.dbAdapter.execute(
      `SELECT * FROM jobs WHERE concurrency_group = 'indexing:${unrelatedRealmURL}' AND status = 'unfulfilled'`,
    );
    assert.strictEqual(
      pendingSourceJobs.length,
      0,
      'pending source realm jobs are removed',
    );
    assert.strictEqual(
      pendingPublishedJobs.length,
      0,
      'pending published realm jobs are removed',
    );
    assert.strictEqual(
      pendingUnrelatedJobs.length,
      1,
      'unrelated pending jobs remain',
    );

    let [sourceJobAfterDelete] = await context.dbAdapter.execute(
      `SELECT status, result, finished_at FROM jobs WHERE id = ${runningSourceJob.id}`,
    );
    let [publishedJobAfterDelete] = await context.dbAdapter.execute(
      `SELECT status, result, finished_at FROM jobs WHERE id = ${runningPublishedJob.id}`,
    );
    assert.strictEqual(
      sourceJobAfterDelete.status,
      'rejected',
      'running source realm job is canceled before cleanup',
    );
    assert.deepEqual(
      sourceJobAfterDelete.result,
      {
        status: 418,
        message: 'User initiated job cancellation',
      },
      'source realm running job gets the cancellation result',
    );
    assert.ok(
      sourceJobAfterDelete.finished_at,
      'source realm running job is marked finished',
    );
    assert.strictEqual(
      publishedJobAfterDelete.status,
      'rejected',
      'running published realm job is canceled before cleanup',
    );
    assert.deepEqual(
      publishedJobAfterDelete.result,
      {
        status: 418,
        message: 'User initiated job cancellation',
      },
      'published realm running job gets the cancellation result',
    );
    assert.ok(
      publishedJobAfterDelete.finished_at,
      'published realm running job is marked finished',
    );

    let sourceReservations = await context.dbAdapter.execute(
      `SELECT * FROM job_reservations WHERE job_id = ${runningSourceJob.id} AND completed_at IS NULL`,
    );
    let publishedReservations = await context.dbAdapter.execute(
      `SELECT * FROM job_reservations WHERE job_id = ${runningPublishedJob.id} AND completed_at IS NULL`,
    );
    let unrelatedReservations = await context.dbAdapter.execute(
      `SELECT * FROM job_reservations WHERE job_id = ${unrelatedJob.id} AND completed_at IS NULL`,
    );
    assert.strictEqual(
      sourceReservations.length,
      0,
      'source realm running job reservations are completed',
    );
    assert.strictEqual(
      publishedReservations.length,
      0,
      'published realm running job reservations are completed',
    );
    assert.strictEqual(
      unrelatedReservations.length,
      1,
      'unrelated job reservations remain',
    );

    let claimedDomains = (await context.dbAdapter.execute(
      `SELECT removed_at FROM claimed_domains_for_sites WHERE source_realm_url = '${realmURL}'`,
    )) as { removed_at: number | null }[];
    assert.ok(
      claimedDomains.every((row) => row.removed_at != null),
      'claimed domains are soft deleted',
    );

    assert.notOk(
      context.testRealmServer.testingOnlyRealms.find(
        (realm) => realm.url === realmURL,
      ),
      'source realm is unmounted',
    );
    assert.notOk(
      context.testRealmServer.testingOnlyRealms.find(
        (realm) => realm.url === publishedRealmURL,
      ),
      'published realm is unmounted',
    );
  });

  test('DELETE /_delete-realm still deletes a realm when a published copy is no longer mounted', async function (assert) {
    let owner = `mango-${uuidv4()}`;
    let ownerUserId = `@${owner}:localhost`;
    let realmURL = await createRealmFor(ownerUserId);
    let publishedRealmURL = `http://${owner}.localhost:4445/published-${uuidv4()}/`;

    await insertUser(
      context.dbAdapter,
      ownerUserId,
      'cus_delete_realm_unmounted',
      'mango@example.com',
    );

    let publishResponse = await context.request
      .post('/_publish-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          sourceRealmURL: realmURL,
          publishedRealmURL,
        }),
      );

    assert.strictEqual(publishResponse.status, 201, 'published realm created');
    let publishedRealmId = publishResponse.body.data.id as string;
    let publishedRealmPath = join(
      context.dir.name,
      'realm_server_2',
      PUBLISHED_DIRECTORY_NAME,
      publishedRealmId,
    );
    assert.true(
      existsSync(publishedRealmPath),
      'published realm directory exists',
    );

    let mountedPublishedRealm = context.testRealmServer.testingOnlyRealms.find(
      (realm) => realm.url === publishedRealmURL,
    );
    if (!mountedPublishedRealm) {
      throw new Error('expected published realm to be mounted');
    }
    context.virtualNetwork.unmount(mountedPublishedRealm.handle);

    let mountedRealms = (
      context.testRealmServer as unknown as { realms: { url: string }[] }
    ).realms;
    let publishedRealmIndex = mountedRealms.findIndex(
      (realm) => realm.url === publishedRealmURL,
    );
    assert.notStrictEqual(
      publishedRealmIndex,
      -1,
      'published realm is present in server realm list',
    );
    mountedRealms.splice(publishedRealmIndex, 1);

    let deleteResponse = await context.request
      .delete('/_delete-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            id: realmURL,
          },
        }),
      );

    assert.strictEqual(deleteResponse.status, 204, 'realm deleted');
    assert.false(
      existsSync(publishedRealmPath),
      'published realm directory is removed even when unmounted',
    );

    let remainingPublishedRows = await context.dbAdapter.execute(
      `SELECT * FROM published_realms WHERE source_realm_url = '${realmURL}'`,
    );
    assert.strictEqual(
      remainingPublishedRows.length,
      0,
      'published realm records are removed',
    );
    assert.notOk(
      context.testRealmServer.testingOnlyRealms.find(
        (realm) => realm.url === realmURL,
      ),
      'source realm is unmounted',
    );
  });

  test('DELETE /_delete-realm rejects deleting a realm outside the current user namespace', async function (assert) {
    let ownerUserId = `@mango-${uuidv4()}:localhost`;
    let foreignOwnerUserId = `@papaya-${uuidv4()}:localhost`;
    let foreignRealmURL = await createRealmFor(foreignOwnerUserId);
    await insertPermissions(context.dbAdapter, new URL(foreignRealmURL), {
      [foreignOwnerUserId]: ['read', 'write', 'realm-owner'],
      [ownerUserId]: ['read', 'write', 'realm-owner'],
    });

    let response = await context.request
      .delete('/_delete-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            id: foreignRealmURL,
          },
        }),
      );

    assert.strictEqual(response.status, 403, 'deletion is forbidden');
    assert.ok(
      response.body.errors?.[0]?.includes(
        'You can only delete realms that you created',
      ),
      'returns a namespace ownership error',
    );
  });

  test('DELETE /_delete-realm rejects an invalid realm URL', async function (assert) {
    let ownerUserId = `@mango-${uuidv4()}:localhost`;

    let response = await context.request
      .delete('/_delete-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            id: 'not-a-valid-url',
          },
        }),
      );

    assert.strictEqual(response.status, 400, 'invalid realm URL is rejected');
    assert.ok(
      response.body.errors?.[0]?.includes('Invalid realm URL supplied'),
      'returns an invalid URL error',
    );
  });
});
