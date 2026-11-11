import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'node:path';
import { query, param, insertPermissions } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';
import {
  parsePublishedProxyPolicies,
  publishedProxyOwner,
} from '../lib/published-proxy-policy.ts';

const source = 'http://realm.default.boxel.localhost:4242/alice/geography/';
const published =
  'http://realm.default.boxel.localhost:4242/sites/alice/randomslug2345678/';
const owner = '@alice:default.boxel.localhost';
const url = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const policies = parsePublishedProxyPolicies({
  [source]: {
    ownerUserId: owner,
    destinations: [
      { url: 'https://tile.googleapis.com/v1/3dtiles/', methods: ['GET'] },
    ],
  },
});

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      await query(db, [
        `INSERT INTO realm_registry(url, kind, disk_id, owner_username, source_url, last_published_at) VALUES (`,
        param(published),
        `, 'published', 'aabbccdd', 'alice', `,
        param(source),
        `, 1)`,
      ]);
      await insertPermissions(db, new URL(source), {
        [owner]: ['read', 'write', 'realm-owner'],
      });
      await insertPermissions(db, new URL(published), { '*': ['read'] });
    },
  });
  QUnit.test(
    'only a configured source owner can sponsor its public published resources',
    async function (assert) {
      assert.strictEqual(
        await publishedProxyOwner(db, published, url, 'GET', policies),
        owner,
      );
      for (let [realm, target, method] of [
        [source, url, 'GET'],
        [published, 'https://attacker.test/?url=' + url, 'GET'],
        [
          published,
          'https://tile.googleapis.com/v1/3dtiles-evil/root.json',
          'GET',
        ],
        [published, url, 'POST'],
        [published, 'https://tile.googleapis.com/v1/streetview/tiles', 'GET'],
      ]) {
        assert.strictEqual(
          await publishedProxyOwner(db, realm!, target!, method!, policies),
          null,
        );
      }
      assert.strictEqual(
        await publishedProxyOwner(
          db,
          published,
          url,
          'GET',
          parsePublishedProxyPolicies({
            [source]: {
              ownerUserId: '@other:localhost',
              destinations: policies[source]!.destinations,
            },
          }),
        ),
        null,
      );
      assert.strictEqual(
        await publishedProxyOwner(db, published, url, 'GET', {}),
        null,
      );
    },
  );
  QUnit.test(
    'unpublish or removal of public reads revokes the resource grant',
    async function (assert) {
      await query(db, [
        `UPDATE realm_user_permissions SET read = false WHERE realm_url = `,
        param(published),
      ]);
      assert.strictEqual(
        await publishedProxyOwner(db, published, url, 'GET', policies),
        null,
      );
      await insertPermissions(db, new URL(published), { '*': ['read'] });
      await query(db, [
        `UPDATE realm_registry SET last_published_at = NULL WHERE url = `,
        param(published),
      ]);
      assert.strictEqual(
        await publishedProxyOwner(db, published, url, 'GET', policies),
        null,
      );
    },
  );
  QUnit.test(
    'policy configuration rejects credential URLs, insecure transport and write methods',
    function (assert) {
      for (let endpoint of [
        'http://maps.example.test/',
        'https://user:password@maps.example.test/',
        'https://maps.example.test/?key=value',
        'https://maps.example.test/#fragment',
      ])
        assert.throws(() =>
          parsePublishedProxyPolicies({
            [source]: {
              ownerUserId: owner,
              destinations: [{ url: endpoint, methods: ['GET'] }],
            },
          }),
        );
      assert.throws(() =>
        parsePublishedProxyPolicies({
          [source]: {
            ownerUserId: owner,
            destinations: [{ url, methods: ['DELETE'] }],
          },
        }),
      );
    },
  );
});
