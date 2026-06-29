import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  archiveRealm,
  insertPermissions,
  isRealmArchived,
  param,
  query,
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

  module('GET /_archived-realms', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    function makeRealmURL() {
      return `${testRealmURL.origin}/archived-${uuidv4()}/`;
    }

    // Seed an archived realm owned by `owner`: a realm_registry row, its
    // permissions, and the archive flag.
    async function seedArchivedRealm(
      realmURL: string,
      owner: string,
      extraPermissions: RealmPermissions = {},
    ) {
      await insertSourceRealmInRegistry(context.dbAdapter, {
        url: realmURL,
        diskId: uuidv4(),
        ownerUsername: owner,
      });
      await insertPermissions(context.dbAdapter, new URL(realmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
        ...extraPermissions,
      });
      await archiveRealm(context.dbAdapter, new URL(realmURL));
    }

    // Insert an indexed RealmConfig card (at `<realmURL>realm`) so the
    // endpoint can read display metadata the way it does for a real realm.
    async function seedRealmConfigInIndex(
      realmURL: string,
      attributes: {
        name?: string;
        iconURL?: string | null;
        backgroundURL?: string | null;
      },
    ) {
      let configURL = `${realmURL}realm`;
      let pristineDoc = {
        id: configURL,
        type: 'card',
        attributes: {
          cardInfo: attributes.name ? { name: attributes.name } : {},
          ...(attributes.iconURL !== undefined
            ? { iconURL: attributes.iconURL }
            : {}),
          ...(attributes.backgroundURL !== undefined
            ? { backgroundURL: attributes.backgroundURL }
            : {}),
        },
      };
      await query(context.dbAdapter, [
        `INSERT INTO boxel_index (url, file_alias, realm_url, realm_version, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at) VALUES (`,
        param(configURL),
        `,`,
        param(configURL),
        `,`,
        param(realmURL),
        `,`,
        param(1),
        `,`,
        param('instance'),
        `,`,
        param(JSON.stringify(pristineDoc)),
        `::jsonb,`,
        param(JSON.stringify({})),
        `::jsonb,`,
        `'[]'::jsonb,`,
        `'[]'::jsonb,`,
        param(false),
        `,`,
        param(false),
        `,`,
        param(Date.now()),
        `)`,
      ]);
    }

    function findEntry(body: any, realmURL: string) {
      return (body.data as any[]).find((d) => d.id === realmURL);
    }

    test("returns the caller's archived realms with display metadata", async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = makeRealmURL();
      await seedArchivedRealm(realmURL, owner);
      await seedRealmConfigInIndex(realmURL, {
        name: 'My Archived Workspace',
        iconURL: 'https://example.com/icon.png',
        backgroundURL: 'https://example.com/bg.jpg',
      });

      let response = await context.request
        .get('/_archived-realms')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', authHeader(owner));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let entry = findEntry(response.body, realmURL);
      assert.ok(entry, 'the archived realm is present');
      assert.strictEqual(entry.type, 'realm');
      assert.strictEqual(
        entry.attributes.name,
        'My Archived Workspace',
        'name comes from the indexed RealmConfig',
      );
      assert.strictEqual(
        entry.attributes.iconURL,
        'https://example.com/icon.png',
        'iconURL comes from the indexed RealmConfig',
      );
      assert.strictEqual(
        entry.attributes.backgroundURL,
        'https://example.com/bg.jpg',
        'backgroundURL comes from the indexed RealmConfig',
      );
      assert.ok(
        entry.attributes.archivedAt,
        'archivedAt timestamp is included',
      );
    });

    test('does not leak archived realms the caller does not own', async function (assert) {
      const owner = '@archive-owner:localhost';
      const otherOwner = '@other-owner:localhost';
      const ownedURL = makeRealmURL();
      const otherURL = makeRealmURL();
      await seedArchivedRealm(ownedURL, owner);
      // owner can read otherURL but is not its owner
      await seedArchivedRealm(otherURL, otherOwner, {
        [owner]: ['read'],
      });

      let response = await context.request
        .get('/_archived-realms')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', authHeader(owner));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(findEntry(response.body, ownedURL), 'owned realm is present');
      assert.notOk(
        findEntry(response.body, otherURL),
        "another owner's archived realm is not leaked",
      );
    });

    test("excludes the caller's non-archived realms", async function (assert) {
      const owner = '@archive-owner:localhost';
      const archivedURL = makeRealmURL();
      const activeURL = makeRealmURL();
      await seedArchivedRealm(archivedURL, owner);
      // An owned but never-archived realm.
      await insertSourceRealmInRegistry(context.dbAdapter, {
        url: activeURL,
        diskId: uuidv4(),
        ownerUsername: owner,
      });
      await insertPermissions(context.dbAdapter, new URL(activeURL), {
        [owner]: ['read', 'write', 'realm-owner'],
      });

      let response = await context.request
        .get('/_archived-realms')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', authHeader(owner));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(
        findEntry(response.body, archivedURL),
        'archived realm is present',
      );
      assert.notOk(
        findEntry(response.body, activeURL),
        'active (non-archived) realm is excluded',
      );
    });

    test('falls back to a URL-derived name when no RealmConfig is indexed', async function (assert) {
      const owner = '@archive-owner:localhost';
      const realmURL = `${testRealmURL.origin}/no-config-realm/`;
      await seedArchivedRealm(realmURL, owner);

      let response = await context.request
        .get('/_archived-realms')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', authHeader(owner));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let entry = findEntry(response.body, realmURL);
      assert.ok(entry, 'the archived realm is present');
      assert.strictEqual(
        entry.attributes.name,
        'no-config-realm',
        'name falls back to the last URL path segment',
      );
    });

    test('returns an empty list when the caller has no archived realms', async function (assert) {
      const owner = '@no-archives-owner:localhost';

      let response = await context.request
        .get('/_archived-realms')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', authHeader(owner));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body.data, [], 'data is an empty array');
    });
  });
});
