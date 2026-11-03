import QUnit from 'qunit';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { ensureLocalPublicRealmReads } from '../lib/local-public-realms.ts';

QUnit.module('local-public-realms-test.ts', function () {
  QUnit.test(
    'bootstrap seeds system owners and public read only without changing private realms',
    async function (assert) {
      const connection = {
        host: process.env.PGHOST ?? 'localhost',
        port: Number(process.env.PGPORT ?? 5435),
        database: process.env.PGDATABASE ?? 'boxel',
        password: process.env.PGPASSWORD ?? '',
      };
      const db = new Client({ ...connection, user: 'postgres' });
      const prefix = `http://local-bootstrap-${randomUUID()}.localhost/`;
      const base = `${prefix}base/`;
      const catalog = `${prefix}catalog/`;
      const privateRealm = `${prefix}private/`;
      await db.connect();
      try {
        await db.query(
          `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ($1, '*', false, false, false), ($2, '*', true, true, true)`,
          [privateRealm, base],
        );
        for (let attempt = 0; attempt < 2; attempt++) {
          await ensureLocalPublicRealmReads({
            ...connection,
            realmURLs: [base, catalog],
            realmOwners: {
              [base]: '@base_realm:localhost',
              [catalog]: '@catalog_realm:localhost',
            },
          });
        }
        const { rows } = await db.query(
          `SELECT realm_url, username, read, write, realm_owner FROM realm_user_permissions WHERE realm_url = ANY($1) ORDER BY realm_url, username`,
          [[base, catalog, privateRealm]],
        );
        assert.deepEqual(rows, [
          {
            realm_url: base,
            username: '*',
            read: true,
            write: false,
            realm_owner: false,
          },
          {
            realm_url: base,
            username: '@base_realm:localhost',
            read: true,
            write: true,
            realm_owner: true,
          },
          {
            realm_url: catalog,
            username: '*',
            read: true,
            write: false,
            realm_owner: false,
          },
          {
            realm_url: catalog,
            username: '@catalog_realm:localhost',
            read: true,
            write: true,
            realm_owner: true,
          },
          {
            realm_url: privateRealm,
            username: '*',
            read: false,
            write: false,
            realm_owner: false,
          },
        ]);
      } finally {
        await db.query(
          'DELETE FROM realm_user_permissions WHERE realm_url = ANY($1)',
          [[base, catalog, privateRealm]],
        );
        await db.end();
      }
    },
  );
});
