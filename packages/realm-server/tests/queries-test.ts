import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';

import type { PgAdapter } from '@cardstack/postgres';
import {
  archiveRealm,
  fetchAllRealmsWithOwners,
  fetchArchivedRealmsForOwner,
  fetchUserPermissions,
  insertPermissions,
  isRealmArchived,
  unarchiveRealm,
} from '@cardstack/runtime-common';

import { upsertPublishedRealmInRegistry } from '../lib/realm-registry-writes.ts';
import { setupDB } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('fetchUserPermissions', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (
        _dbAdapter: PgAdapter,
        _publisher,
        _runner,
      ): Promise<void> => {
        dbAdapter = _dbAdapter;
      },
    });

    async function insertPublishedRealm({
      sourceRealmURL,
      publishedRealmURL,
      ownerUsername = '@realm/published-owner',
    }: {
      sourceRealmURL: string;
      publishedRealmURL: string;
      ownerUsername?: string;
    }) {
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL,
        publishedRealmId: uuidv4(),
        ownerUsername,
        sourceRealmURL,
        lastPublishedAt: Date.now(),
      });
    }

    test('can fetch only own realms, filtering out public and published realms', async function (assert) {
      const ownerUserId = '@owner:localhost';
      const sourceRealmURL = 'http://example.com/source/';
      const publishedRealmURL = 'http://example.com/published/';
      const publicRealmURL = 'http://example.com/public/';

      await insertPermissions(dbAdapter, new URL(sourceRealmURL), {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      });

      await insertPermissions(dbAdapter, new URL(publicRealmURL), {
        '*': ['read'],
      });

      await insertPublishedRealm({ sourceRealmURL, publishedRealmURL });
      await insertPermissions(dbAdapter, new URL(publishedRealmURL), {
        [ownerUserId]: ['read', 'realm-owner'],
        '*': ['read'],
      });

      let permissions = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
        onlyOwnRealms: true,
      });

      assert.deepEqual(
        permissions[sourceRealmURL],
        ['read', 'write', 'realm-owner'],
        'includes owner realm permissions',
      );
      assert.false(
        publicRealmURL in permissions,
        'filters out public realms when onlyOwnRealms is true',
      );
      assert.false(
        publishedRealmURL in permissions,
        'filters out published realms for owner',
      );
    });

    test('can fetch own and public realms together while filtering published realms', async function (assert) {
      const ownerUserId = '@owner:localhost';
      const sourceRealmURL = 'http://example.com/source/';
      const publicRealmURL = 'http://example.com/public/';
      const publishedRealmURL = 'http://example.com/published/';
      const sourceRealmPublicURL = 'http://example.com/source-public/';

      await insertPermissions(dbAdapter, new URL(sourceRealmURL), {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      });

      await insertPermissions(dbAdapter, new URL(sourceRealmPublicURL), {
        [ownerUserId]: ['read'],
      });

      await insertPermissions(dbAdapter, new URL(publicRealmURL), {
        '*': ['read'],
      });

      await insertPublishedRealm({
        sourceRealmURL,
        publishedRealmURL,
      });
      await insertPermissions(dbAdapter, new URL(publishedRealmURL), {
        [ownerUserId]: ['read', 'realm-owner'],
        '*': ['read'],
      });

      let permissions = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
      });

      assert.deepEqual(
        permissions[sourceRealmURL],
        ['read', 'write', 'realm-owner'],
        'includes owner realm with full permissions',
      );
      assert.deepEqual(
        permissions[publicRealmURL],
        ['read'],
        'includes public realm permissions',
      );
      assert.deepEqual(
        permissions[sourceRealmPublicURL],
        ['read'],
        'includes direct read permissions for owned realm without write access',
      );
      assert.false(
        publishedRealmURL in permissions,
        'filters out published realms when fetching all permissions',
      );
    });
  });

  module('fetchAllRealmsWithOwners', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (
        _dbAdapter: PgAdapter,
        _publisher,
        _runner,
      ): Promise<void> => {
        dbAdapter = _dbAdapter;
      },
    });

    async function insertPublishedRealm({
      sourceRealmURL,
      publishedRealmURL,
      ownerUsername = '@realm/published-owner',
    }: {
      sourceRealmURL: string;
      publishedRealmURL: string;
      ownerUsername?: string;
    }) {
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL,
        publishedRealmId: uuidv4(),
        ownerUsername,
        sourceRealmURL,
        lastPublishedAt: Date.now(),
      });
    }

    test('uses source realm owner when published realm permissions are missing', async function (assert) {
      const ownerUserId = '@owner:localhost';
      const sourceRealmURL = 'http://example.com/source/';
      const publishedRealmURL = 'http://example.com/published/';

      await insertPermissions(dbAdapter, new URL(sourceRealmURL), {
        [ownerUserId]: ['read', 'realm-owner'],
      });

      await insertPublishedRealm({ sourceRealmURL, publishedRealmURL });

      let owners = await fetchAllRealmsWithOwners(dbAdapter);
      let ownerByRealm = new Map(
        owners.map((owner) => [owner.realm_url, owner.owner_username]),
      );

      assert.strictEqual(
        ownerByRealm.get(sourceRealmURL),
        'owner',
        'returns source realm owner',
      );
      assert.strictEqual(
        ownerByRealm.get(publishedRealmURL),
        'owner',
        'falls back to source realm owner for published realms',
      );
    });

    test('falls back to published realm owner when source owner is missing', async function (assert) {
      const sourceRealmURL = 'http://example.com/missing-source/';
      const publishedRealmURL = 'http://example.com/published-only/';
      const publishedOwner = '@realm/published-only';

      await insertPublishedRealm({
        sourceRealmURL,
        publishedRealmURL,
        ownerUsername: publishedOwner,
      });

      let owners = await fetchAllRealmsWithOwners(dbAdapter);
      let ownerByRealm = new Map(
        owners.map((owner) => [owner.realm_url, owner.owner_username]),
      );

      assert.strictEqual(
        ownerByRealm.get(publishedRealmURL),
        'realm/published-only',
        'uses published realm owner when source owner is missing',
      );
    });
  });

  module('realm archive helpers', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (
        _dbAdapter: PgAdapter,
        _publisher,
        _runner,
      ): Promise<void> => {
        dbAdapter = _dbAdapter;
      },
    });

    test('archiveRealm marks a realm archived and isRealmArchived reflects it', async function (assert) {
      const realmURL = new URL('http://example.com/archive-me/');

      assert.false(
        await isRealmArchived(dbAdapter, realmURL),
        'a realm with no metadata row is not archived',
      );

      await archiveRealm(dbAdapter, realmURL);

      assert.true(
        await isRealmArchived(dbAdapter, realmURL),
        'realm is archived after archiveRealm',
      );
    });

    test('unarchiveRealm clears the flag and returns the realm to active', async function (assert) {
      const realmURL = new URL('http://example.com/restore-me/');

      await archiveRealm(dbAdapter, realmURL);
      assert.true(await isRealmArchived(dbAdapter, realmURL));

      await unarchiveRealm(dbAdapter, realmURL);
      assert.false(
        await isRealmArchived(dbAdapter, realmURL),
        'realm is active after unarchiveRealm',
      );
    });

    test('unarchiveRealm is idempotent when no metadata row exists', async function (assert) {
      const realmURL = new URL('http://example.com/never-archived/');

      await unarchiveRealm(dbAdapter, realmURL);
      assert.false(
        await isRealmArchived(dbAdapter, realmURL),
        'realm remains active',
      );
    });

    test("fetchArchivedRealmsForOwner returns only the owner's archived realms", async function (assert) {
      const owner = '@owner:localhost';
      const otherOwner = '@other:localhost';

      const archivedOwned = 'http://example.com/owned-archived/';
      const activeOwned = 'http://example.com/owned-active/';
      const archivedOtherOwner = 'http://example.com/other-archived/';
      const archivedReadOnly = 'http://example.com/read-only-archived/';

      await insertPermissions(dbAdapter, new URL(archivedOwned), {
        [owner]: ['read', 'write', 'realm-owner'],
      });
      await insertPermissions(dbAdapter, new URL(activeOwned), {
        [owner]: ['read', 'write', 'realm-owner'],
      });
      await insertPermissions(dbAdapter, new URL(archivedOtherOwner), {
        [otherOwner]: ['read', 'write', 'realm-owner'],
      });
      // owner can read this realm but is not its owner
      await insertPermissions(dbAdapter, new URL(archivedReadOnly), {
        [owner]: ['read'],
        [otherOwner]: ['read', 'write', 'realm-owner'],
      });

      await archiveRealm(dbAdapter, new URL(archivedOwned));
      await archiveRealm(dbAdapter, new URL(archivedOtherOwner));
      await archiveRealm(dbAdapter, new URL(archivedReadOnly));

      let archived = await fetchArchivedRealmsForOwner(dbAdapter, owner);

      assert.deepEqual(
        archived.map((r) => r.url),
        [archivedOwned],
        'returns only realms that are both archived and owned by the user',
      );
      assert.ok(
        archived[0]?.archivedAt,
        'each archived realm carries its archived_at timestamp',
      );
    });

    test('fetchArchivedRealmsForOwner excludes archived published snapshots', async function (assert) {
      const owner = '@owner:localhost';
      const sourceRealmURL = 'http://example.com/source/';
      const publishedRealmURL = 'http://example.com/published/';

      await insertPermissions(dbAdapter, new URL(sourceRealmURL), {
        [owner]: ['read', 'write', 'realm-owner'],
      });
      // Publishing grants the owner realm-owner on the published URL too.
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL,
        publishedRealmId: uuidv4(),
        ownerUsername: owner,
        sourceRealmURL,
        lastPublishedAt: Date.now(),
      });
      await insertPermissions(dbAdapter, new URL(publishedRealmURL), {
        [owner]: ['read', 'realm-owner'],
        '*': ['read'],
      });

      await archiveRealm(dbAdapter, new URL(sourceRealmURL));
      await archiveRealm(dbAdapter, new URL(publishedRealmURL));

      let archived = await fetchArchivedRealmsForOwner(dbAdapter, owner);

      assert.deepEqual(
        archived.map((r) => r.url),
        [sourceRealmURL],
        'published snapshots are omitted even when archived and owned',
      );
    });
  });
});
