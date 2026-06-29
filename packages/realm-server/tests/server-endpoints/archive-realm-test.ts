import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  FROM_SCRATCH_JOB_TIMEOUT_SEC,
  insertPermissions,
  isRealmArchived,
  systemInitiatedPriority,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { realmSecretSeed } from '../helpers/index.ts';
import {
  insertSourceRealmInRegistry,
  upsertPublishedRealmInRegistry,
} from '../../lib/realm-registry-writes.ts';
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

    // Seed a source realm: a realm_registry row (the source of truth for
    // existence) plus its permissions.
    async function seedSourceRealm(
      realmURL: string,
      permissions: RealmPermissions,
    ) {
      await insertSourceRealmInRegistry(context.dbAdapter, {
        url: realmURL,
        diskId: uuidv4(),
        ownerUsername: '@archive-owner:localhost',
      });
      await insertPermissions(
        context.dbAdapter,
        new URL(realmURL),
        permissions,
      );
    }

    test('POST /_archive-realm lets an owner archive a realm', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      await seedSourceRealm(realmURL, {
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
      await seedSourceRealm(realmURL, {
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

    test('POST /_archive-realm cancels pending indexing jobs for the realm', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      await seedSourceRealm(realmURL, {
        [owner]: ['read', 'write', 'realm-owner'],
      });

      let pending = await context.publisher.publish<void>({
        jobType: 'from-scratch-index',
        concurrencyGroup: `indexing:${realmURL}`,
        timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
        priority: systemInitiatedPriority,
        args: {
          realmURL,
          realmUsername: 'archive-owner',
          clearLastModified: false,
        },
      });

      let response = await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));
      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      let rows = (await context.dbAdapter.execute(
        `SELECT status FROM jobs WHERE id = $1`,
        { bind: [pending.id] },
      )) as { status: string }[];
      assert.strictEqual(
        rows[0]?.status,
        'rejected',
        'the pending indexing job is marked rejected',
      );
    });

    test('POST /_archive-realm returns 403 for a non-owner', async function (assert) {
      const owner = '@archive-owner:localhost';
      const intruder = '@intruder:localhost';
      const realmURL = makeRealmURL();
      await seedSourceRealm(realmURL, {
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
      await seedSourceRealm(realmURL, {
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

    test('POST /_archive-realm returns 404 when no source realm_registry row exists, even with an owner permission', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      // Permission row exists but the realm was never registered — a stale or
      // manual grant must not be enough to archive an arbitrary URL.
      await insertPermissions(context.dbAdapter, new URL(realmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
      });

      let response = await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
      assert.false(
        await isRealmArchived(context.dbAdapter, new URL(realmURL)),
        'unregistered realm is not archived',
      );
    });

    test('POST /_archive-realm rejects a published realm', async function (assert) {
      const owner = '@archive-owner:localhost';
      const sourceRealmURL = makeRealmURL();
      const publishedRealmURL = makeRealmURL();
      await seedSourceRealm(sourceRealmURL, {
        [owner]: ['read', 'write', 'realm-owner'],
      });
      await upsertPublishedRealmInRegistry(context.dbAdapter, {
        publishedRealmURL,
        publishedRealmId: uuidv4(),
        ownerUsername: owner,
        sourceRealmURL,
        lastPublishedAt: Date.now(),
      });
      await insertPermissions(context.dbAdapter, new URL(publishedRealmURL), {
        [owner]: ['read', 'realm-owner'],
      });

      let response = await context.request
        .post('/_archive-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set('Authorization', authHeader(owner))
        .send(
          JSON.stringify({ data: { type: 'realm', id: publishedRealmURL } }),
        );

      assert.strictEqual(response.status, 422, 'HTTP 422 status');
      assert.false(
        await isRealmArchived(context.dbAdapter, new URL(publishedRealmURL)),
        'published realm is not archived',
      );
    });
  });
});
