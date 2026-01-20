import { module, test } from 'qunit';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';

import type { PgAdapter } from '@cardstack/postgres';
import {
  asExpressions,
  fetchAllRealmsWithOwners,
  fetchUserPermissions,
  insert,
  insertPermissions,
  query,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers';

module(basename(__filename), function () {
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
      let publishedRealmId = uuidv4();
      let { nameExpressions, valueExpressions } = asExpressions({
        id: publishedRealmId,
        owner_username: ownerUsername,
        source_realm_url: sourceRealmURL,
        published_realm_url: publishedRealmURL,
        last_published_at: Date.now().toString(),
      });
      await query(
        dbAdapter,
        insert('published_realms', nameExpressions, valueExpressions),
      );
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
      let publishedRealmId = uuidv4();
      let { nameExpressions, valueExpressions } = asExpressions({
        id: publishedRealmId,
        owner_username: ownerUsername,
        source_realm_url: sourceRealmURL,
        published_realm_url: publishedRealmURL,
        last_published_at: Date.now().toString(),
      });
      await query(
        dbAdapter,
        insert('published_realms', nameExpressions, valueExpressions),
      );
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
});
