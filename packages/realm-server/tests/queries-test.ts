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

    test('excludes archived realms by default; includeArchived re-includes them', async function (assert) {
      const ownerUserId = '@owner:localhost';
      const activeOwned = 'http://example.com/active-owned/';
      const archivedOwned = 'http://example.com/archived-owned/';
      const activePublic = 'http://example.com/active-public/';
      const archivedPublic = 'http://example.com/archived-public/';

      await insertPermissions(dbAdapter, new URL(activeOwned), {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      });
      await insertPermissions(dbAdapter, new URL(archivedOwned), {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      });
      // Archiving via the endpoint is forbidden for public realms, but the
      // helper itself doesn't enforce that — directly seed an archived
      // public realm to exercise the public-read arm of the UNION too.
      await insertPermissions(dbAdapter, new URL(activePublic), {
        '*': ['read'],
      });
      await insertPermissions(dbAdapter, new URL(archivedPublic), {
        '*': ['read'],
      });
      await archiveRealm(dbAdapter, new URL(archivedOwned));
      await archiveRealm(dbAdapter, new URL(archivedPublic));

      // Seed migrations grant '*: read' to system realms (boxel-homepage,
      // catalog, openrouter, …), which the public-read arm of
      // fetchUserPermissions surfaces for every user. Filter to the URLs
      // this test seeded so the assertion isn't coupled to that fixture.
      const testRealms = (urls: string[]) =>
        urls.filter((u) => u.startsWith('http://example.com/')).sort();

      let active = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
      });
      assert.deepEqual(
        testRealms(Object.keys(active)),
        [activeOwned, activePublic].sort(),
        'default enumeration excludes archived realms in both UNION arms',
      );

      let withArchived = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
        includeArchived: true,
      });
      assert.deepEqual(
        testRealms(Object.keys(withArchived)),
        [activeOwned, activePublic, archivedOwned, archivedPublic].sort(),
        'includeArchived re-includes archived realms in both arms',
      );

      let activeOwnersOnly = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
        onlyOwnRealms: true,
      });
      assert.deepEqual(
        testRealms(Object.keys(activeOwnersOnly)),
        [activeOwned].sort(),
        'onlyOwnRealms also excludes archived realms by default',
      );

      let ownersWithArchived = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
        onlyOwnRealms: true,
        includeArchived: true,
      });
      assert.deepEqual(
        testRealms(Object.keys(ownersWithArchived)),
        [activeOwned, archivedOwned].sort(),
        'onlyOwnRealms + includeArchived returns the owner archived realm too',
      );
    });

    test('an unarchived realm is enumerated again', async function (assert) {
      const ownerUserId = '@owner:localhost';
      const realmURL = 'http://example.com/restored/';

      await insertPermissions(dbAdapter, new URL(realmURL), {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      });
      await archiveRealm(dbAdapter, new URL(realmURL));

      let archivedView = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
      });
      assert.false(
        realmURL in archivedView,
        'archived realm is not enumerated',
      );

      await unarchiveRealm(dbAdapter, new URL(realmURL));
      let restoredView = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
      });
      assert.deepEqual(
        restoredView[realmURL],
        ['read', 'write', 'realm-owner'],
        'unarchived realm is enumerated again',
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
        archived,
        [archivedOwned],
        'returns only realms that are both archived and owned by the user',
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
        archived,
        [sourceRealmURL],
        'published snapshots are omitted even when archived and owned',
      );
    });
  });
});
