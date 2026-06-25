import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { insertPermissions, isRealmArchived } from '@cardstack/runtime-common';
import { realmSecretSeed } from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';

function authHeader(user: string) {
  return `Bearer ${createRealmServerJWT(
    { user, sessionRoom: 'session-room-test' },
    realmSecretSeed,
  )}`;
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('archive / unarchive realm endpoints', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    // A fresh private realm URL, isolated per test.
    function makeRealmURL() {
      return `${testRealmURL.origin}/archive-${uuidv4()}/`;
    }

    test('POST /_archive-realm lets an owner archive a realm', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      await insertPermissions(context.dbAdapter, new URL(realmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
      });

      let response = await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body.data, {
        type: 'realm',
        id: realmURL,
        attributes: { archived: true },
      });
      assert.true(
        await isRealmArchived(context.dbAdapter, new URL(realmURL)),
        'realm is archived in the database',
      );
    });

    test('POST /_unarchive-realm lets an owner restore a realm and enqueues a full reindex', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      await insertPermissions(context.dbAdapter, new URL(realmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
      });

      await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));

      let response = await context.request
        .post('/_unarchive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body.data, {
        type: 'realm',
        id: realmURL,
        attributes: { archived: false },
      });
      assert.false(
        await isRealmArchived(context.dbAdapter, new URL(realmURL)),
        'realm is active again in the database',
      );

      let reindexJobs = await context.dbAdapter.execute(
        `SELECT args FROM jobs WHERE job_type = 'full-reindex'`,
      );
      assert.ok(
        reindexJobs.some((row: any) => {
          let args = row.args as { realmUrls?: string[] };
          return args?.realmUrls?.includes(realmURL);
        }),
        'a full-reindex job was enqueued for the restored realm',
      );
    });

    test('POST /_archive-realm returns 403 for a non-owner', async function (assert) {
      const owner = '@archive-owner:localhost';
      const intruder = '@intruder:localhost';
      const realmURL = makeRealmURL();
      await insertPermissions(context.dbAdapter, new URL(realmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
        [intruder]: ['read'],
      });

      let response = await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(intruder))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.false(
        await isRealmArchived(context.dbAdapter, new URL(realmURL)),
        'realm is not archived',
      );
    });

    test('POST /_archive-realm rejects a public/catalog realm', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      await insertPermissions(context.dbAdapter, new URL(realmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
        '*': ['read'],
      });

      let response = await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));

      assert.strictEqual(response.status, 422, 'HTTP 422 status');
      assert.false(
        await isRealmArchived(context.dbAdapter, new URL(realmURL)),
        'public realm is not archived',
      );
    });
  });
});
