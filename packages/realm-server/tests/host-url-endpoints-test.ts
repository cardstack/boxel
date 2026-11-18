import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import {
  DEFAULT_PERMISSIONS,
  param,
  query,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { insertPermissions } from '@cardstack/runtime-common/db-queries/realm-permission-queries';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertUser,
  realmConfigCardJSON,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testRealmURL,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// The test realm server's Space and site domains are both `localhost`, so a
// Boxel Space host URL is `http://<owner>.localhost/<realm name>/` and a site
// name is `http://<name>.localhost/`.
const OWNER = '@mango:localhost';
const WRITER = '@kiwi:localhost';
const READER = '@fig:localhost';
const OTHER = '@lime:localhost';
const REALM_URL = new URL('test/', testRealmURL).href;
const SPACE_URL = 'http://mango.localhost/test/';
const CUSTOM_DOMAIN = 'shop.example.test';

const HOME_MODULE = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Home extends CardDef {
    @field headline = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    };
  }
`;

module(basename(import.meta.filename), function () {
  module('host URL endpoints', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let realmId: string;
    let previousOverrides: string | undefined;

    // The server reads the custom domains it allows when it starts.
    hooks.before(function () {
      previousOverrides = process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES;
      process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES = JSON.stringify({
        [REALM_URL]: CUSTOM_DOMAIN,
      });
    });

    hooks.after(function () {
      if (previousOverrides === undefined) {
        delete process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES;
      } else {
        process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES = previousOverrides;
      }
    });

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL(REALM_URL),
      permissions: {
        '*': ['read'],
        [OWNER]: DEFAULT_PERMISSIONS,
        [WRITER]: ['read', 'write'],
        [READER]: ['read'],
      },
      fileSystem: {
        'realm.json': realmConfigCardJSON({ name: 'Test' }),
        'home.gts': HOME_MODULE,
        'index.json': JSON.stringify({
          data: {
            type: 'card',
            attributes: { headline: 'Welcome' },
            meta: { adoptsFrom: { module: './home', name: 'Home' } },
          },
        }),
        'hello.txt': 'hello from the realm',
      },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    hooks.beforeEach(async function () {
      realmId = await register(testRealm.url, 'test-realm');
    });

    // A registry row for a realm URL. Returns the row's id.
    async function register(url: string, diskId: string): Promise<string> {
      let rows = (await query(dbAdapter, [
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username) VALUES (`,
        param(url),
        `, 'source', `,
        param(diskId),
        `, 'mango') ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url RETURNING id`,
      ])) as { id: string }[];
      return rows[0].id;
    }

    function auth(user: string) {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      )}`;
    }

    function mount(url: string, user = OWNER, realmURL = REALM_URL) {
      return request
        .post('/_host-urls')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('Authorization', auth(user))
        .send(
          JSON.stringify({
            data: { type: 'host-url', attributes: { realmURL, url } },
          }),
        );
    }

    function list(user = OWNER) {
      return request
        .get(`/_host-urls?realm=${encodeURIComponent(REALM_URL)}`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', auth(user));
    }

    function setCanonical(id: string, user = OWNER) {
      return request
        .patch(`/_host-urls/${id}`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('Authorization', auth(user))
        .send(
          JSON.stringify({
            data: { type: 'host-url', id, attributes: { isCanonical: true } },
          }),
        );
    }

    function unmount(id: string, user = OWNER) {
      return request
        .delete(`/_host-urls/${id}`)
        .set('Authorization', auth(user));
    }

    function getOnHost(host: string, path: string) {
      return request
        .get(path)
        .set('Host', host)
        .set('Accept', SupportedMimeType.CardSource);
    }

    async function claimSiteName(
      matrixUserId: string,
      hostname: string,
    ): Promise<void> {
      // The realm's setup already made a row for its owner.
      let [existing] = (await query(dbAdapter, [
        `SELECT id FROM users WHERE matrix_user_id =`,
        param(matrixUserId),
      ])) as { id: string }[];
      let user =
        existing ??
        (await insertUser(
          dbAdapter,
          matrixUserId,
          `cus_${matrixUserId}`,
          `${matrixUserId}@example.com`,
        ));
      await query(dbAdapter, [
        `INSERT INTO claimed_domains_for_sites (user_id, hostname, source_realm_url, claimed_at) VALUES (`,
        param(user.id),
        `,`,
        param(hostname),
        `, 'http://elsewhere.test/realm/',`,
        param(Math.floor(Date.now() / 1000)),
        `)`,
      ]);
    }

    async function claimOf(hostname: string) {
      let [claim] = (await query(dbAdapter, [
        `SELECT realm_id, removed_at FROM claimed_domains_for_sites WHERE hostname =`,
        param(hostname),
      ])) as { realm_id: string | null; removed_at: number | null }[];
      return claim;
    }

    test('mounts a realm in its owner’s Boxel Space, at once and as canonical', async function (assert) {
      let response = await mount(SPACE_URL);

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      assert.strictEqual(response.body.data.type, 'host-url');
      assert.deepEqual(response.body.data.attributes, {
        realmURL: REALM_URL,
        url: SPACE_URL,
        kind: 'boxel-space',
        isCanonical: true,
      });

      let served = await getOnHost('mango.localhost', '/test/hello.txt');
      assert.strictEqual(served.status, 200, 'the host URL serves at once');
      assert.strictEqual(served.text, 'hello from the realm');
    });

    test('a later host URL is not canonical until it is marked canonical', async function (assert) {
      let first = (await mount(SPACE_URL)).body.data;
      let second = await mount(`http://${CUSTOM_DOMAIN}/`);
      assert.strictEqual(second.status, 201, 'HTTP 201 status');
      assert.strictEqual(second.body.data.attributes.kind, 'custom-domain');
      assert.false(second.body.data.attributes.isCanonical);

      let marked = await setCanonical(second.body.data.id);
      assert.strictEqual(marked.status, 200, 'HTTP 200 status');
      assert.true(marked.body.data.attributes.isCanonical);

      let listed = await list();
      assert.strictEqual(listed.status, 200, 'HTTP 200 status');
      let canonicalById = Object.fromEntries(
        listed.body.data.map(
          (hostURL: { id: string; attributes: { isCanonical: boolean } }) => [
            hostURL.id,
            hostURL.attributes.isCanonical,
          ],
        ),
      );
      assert.deepEqual(canonicalById, {
        [first.id]: false,
        [second.body.data.id]: true,
      });
    });

    test('refuses to unmount the canonical host URL while the realm has others', async function (assert) {
      let first = (await mount(SPACE_URL)).body.data;
      let second = (await mount(`http://${CUSTOM_DOMAIN}/`)).body.data;

      let refused = await unmount(first.id);
      assert.strictEqual(refused.status, 422, 'HTTP 422 status');
      assert.true(refused.body.errors[0].includes('canonical'));

      let removed = await unmount(second.id);
      assert.strictEqual(removed.status, 204, 'HTTP 204 status');
      let gone = await getOnHost(CUSTOM_DOMAIN, '/hello.txt');
      assert.strictEqual(gone.status, 404, 'the host URL answers 404 at once');

      let last = await unmount(first.id);
      assert.strictEqual(
        last.status,
        204,
        'the canonical host URL can go once it is the only one',
      );
      assert.strictEqual((await list()).body.data.length, 0);
    });

    test('a Boxel Space host URL must be the realm’s name in its owner’s Space', async function (assert) {
      let otherSpace = await mount('http://kiwi.localhost/test/');
      assert.strictEqual(otherSpace.status, 422, 'not another user’s Space');
      assert.true(otherSpace.body.errors[0].includes('mango'));

      let otherPath = await mount('http://mango.localhost/elsewhere/');
      assert.strictEqual(otherPath.status, 422, 'not another path');
      assert.true(otherPath.body.errors[0].includes('/test/'));
    });

    test('a host URL must be on a domain the deployment allows', async function (assert) {
      let response = await mount('http://mango.example.org/test/');
      assert.strictEqual(response.status, 422, 'HTTP 422 status');
      assert.true(response.body.errors[0].includes('localhost'));
    });

    test('mounting at a site name the caller claimed binds the claim, and unmounting frees it', async function (assert) {
      await claimSiteName(OWNER, 'my-site.localhost');

      let mounted = await mount('http://my-site.localhost/');
      assert.strictEqual(mounted.status, 201, 'HTTP 201 status');
      assert.strictEqual(mounted.body.data.attributes.kind, 'site-name');
      assert.strictEqual(
        (await claimOf('my-site.localhost')).realm_id,
        realmId,
        'the claim names the realm',
      );

      let removed = await unmount(mounted.body.data.id);
      assert.strictEqual(removed.status, 204, 'HTTP 204 status');
      assert.notStrictEqual(
        (await claimOf('my-site.localhost')).removed_at,
        null,
        'the site name is free to claim again',
      );
    });

    test('a mounted site name’s claim can’t be released until the site name is unmounted', async function (assert) {
      await claimSiteName(OWNER, 'kept.localhost');
      let mounted = (await mount('http://kept.localhost/')).body.data;
      let [claim] = (await query(dbAdapter, [
        `SELECT id FROM claimed_domains_for_sites WHERE hostname = 'kept.localhost'`,
      ])) as { id: string }[];

      let refused = await request
        .delete(`/_boxel-claimed-domains/${claim.id}`)
        .set('Authorization', auth(OWNER));
      assert.strictEqual(refused.status, 409, 'HTTP 409 status');
      assert.true(refused.body.errors[0].includes('Unmount'));
      assert.strictEqual(
        (await claimOf('kept.localhost')).removed_at,
        null,
        'the claim stays',
      );
      let served = await getOnHost('kept.localhost', '/hello.txt');
      assert.strictEqual(served.status, 200, 'the site name still serves');

      assert.strictEqual((await unmount(mounted.id)).status, 204);
      assert.notStrictEqual(
        (await claimOf('kept.localhost')).removed_at,
        null,
        'unmounting frees the site name',
      );
    });

    test('unmounting a site name releases only the claim bound to the realm', async function (assert) {
      // A host URL whose site name is claimed by another user for another
      // realm.
      await claimSiteName(OTHER, 'stale.localhost');
      let [row] = (await query(dbAdapter, [
        `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
        param(realmId),
        `, 'site-name', 'stale.localhost', '/', true,`,
        param(OWNER),
        `) RETURNING id`,
      ])) as { id: string }[];

      assert.strictEqual((await unmount(row.id)).status, 204);
      assert.strictEqual(
        (await claimOf('stale.localhost')).removed_at,
        null,
        'the other user’s claim stays',
      );
    });

    test('a mount that loses to another realm’s host URL leaves the claim unbound', async function (assert) {
      let otherId = await register(
        new URL('mango/taken/', testRealmURL).href,
        'taken-realm',
      );
      await query(dbAdapter, [
        `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
        param(otherId),
        `, 'site-name', 'taken.localhost', '/', true,`,
        param(OWNER),
        `)`,
      ]);
      await claimSiteName(OWNER, 'taken.localhost');

      let response = await mount('http://taken.localhost/');
      assert.strictEqual(response.status, 409, 'HTTP 409 status');
      assert.strictEqual(
        (await claimOf('taken.localhost')).realm_id,
        null,
        'the claim is not bound to the realm that lost',
      );
    });

    test('refuses a site name nobody claimed, or another user claimed', async function (assert) {
      let unclaimed = await mount('http://nobody.localhost/');
      assert.strictEqual(unclaimed.status, 422, 'HTTP 422 status');
      assert.true(unclaimed.body.errors[0].includes('not claimed'));

      await claimSiteName(OTHER, 'theirs.localhost');
      let theirs = await mount('http://theirs.localhost/');
      assert.strictEqual(theirs.status, 422, 'HTTP 422 status');
      assert.true(theirs.body.errors[0].includes('another user'));
    });

    test('a site name already bound to the realm can be mounted by another administrator', async function (assert) {
      await claimSiteName(OWNER, 'shared.localhost');
      await query(dbAdapter, [
        `UPDATE claimed_domains_for_sites SET realm_id =`,
        param(realmId),
        `WHERE hostname = 'shared.localhost'`,
      ]);

      let response = await mount('http://shared.localhost/', WRITER);
      assert.strictEqual(response.status, 201, 'HTTP 201 status');
    });

    test('only a direct writer of the realm may manage its host URLs', async function (assert) {
      let byWriter = await mount(SPACE_URL, WRITER);
      assert.strictEqual(byWriter.status, 201, 'a direct writer may mount');

      let byReader = await mount(`http://${CUSTOM_DOMAIN}/`, READER);
      assert.strictEqual(byReader.status, 403, 'a reader may not mount');
      assert.strictEqual((await list(READER)).status, 403);
      assert.strictEqual(
        (await setCanonical(byWriter.body.data.id, READER)).status,
        403,
      );
      assert.strictEqual(
        (await unmount(byWriter.body.data.id, READER)).status,
        403,
      );
    });

    test('a custom domain is allowed only for the realm the deployment names', async function (assert) {
      let otherRealmURL = new URL('mango/other/', testRealmURL).href;
      await register(otherRealmURL, 'other-realm');
      await insertPermissions(dbAdapter, new URL(otherRealmURL), {
        [OWNER]: DEFAULT_PERMISSIONS,
      });

      let response = await mount(
        `http://${CUSTOM_DOMAIN}/`,
        OWNER,
        otherRealmURL,
      );
      assert.strictEqual(response.status, 422, 'HTTP 422 status');
      assert.true(response.body.errors[0].includes('not allowed'));
    });

    test('refuses a second mount at the same host URL', async function (assert) {
      assert.strictEqual((await mount(SPACE_URL)).status, 201);
      let again = await mount(SPACE_URL);
      assert.strictEqual(again.status, 409, 'HTTP 409 status');
    });

    test('refuses a realm whose home page a visitor who is not signed in can’t read, naming it', async function (assert) {
      await query(dbAdapter, [
        `DELETE FROM realm_user_permissions WHERE username = '*' AND realm_url =`,
        param(REALM_URL),
      ]);

      let response = await mount(SPACE_URL);
      assert.strictEqual(response.status, 422, 'HTTP 422 status');
      assert.true(
        response.body.errors[0].includes(`${REALM_URL}index`),
        'the error names the home card',
      );
      assert.strictEqual((await list()).body.data.length, 0);
    });

    test('deleting a realm removes its host URLs and frees their site names', async function (assert) {
      let doomedURL = new URL('mango/doomed/', testRealmURL).href;
      let doomedId = await register(doomedURL, 'doomed-realm');
      await insertPermissions(dbAdapter, new URL(doomedURL), {
        [OWNER]: DEFAULT_PERMISSIONS,
      });
      await claimSiteName(OWNER, 'doomed.localhost');
      await query(dbAdapter, [
        `UPDATE claimed_domains_for_sites SET realm_id =`,
        param(doomedId),
        `WHERE hostname = 'doomed.localhost'`,
      ]);
      await query(dbAdapter, [
        `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
        param(doomedId),
        `, 'site-name', 'doomed.localhost', '/', true,`,
        param(OWNER),
        `)`,
      ]);

      let response = await request
        .delete('/_delete-realm')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('Authorization', auth(OWNER))
        .send(JSON.stringify({ data: { type: 'realm', id: doomedURL } }));
      assert.strictEqual(response.status, 204, 'HTTP 204 status');

      let rows = await query(dbAdapter, [
        `SELECT 1 FROM realm_host_urls WHERE realm_id =`,
        param(doomedId),
      ]);
      assert.strictEqual(rows.length, 0, 'the host URLs are gone');
      assert.notStrictEqual(
        (await claimOf('doomed.localhost')).removed_at,
        null,
        'the site name is free to claim again',
      );
    });
  });
});
