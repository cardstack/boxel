import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';

// A site whose field-match routes name types in four places: its own realm,
// a realm anyone may read, a realm only the site's owner may read, and a
// realm the site's owner can't read. All four are on one realm server, so
// the site's index reaches the other three.
const SITE = 'http://127.0.0.1:4444/site/';
const SHARED = 'http://127.0.0.1:4444/shared/';
const PRIVATE = 'http://127.0.0.1:4444/private/';
const STRANGER = 'http://127.0.0.1:4444/stranger/';
const OWNER = '@owner:localhost';
const OTHER_USER = '@other-user:localhost';

function postModule(name: string) {
  return `
    import { CardDef, field, contains } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    export class ${name} extends CardDef {
      @field slug = contains(StringField);
    }
  `;
}

function route(path: string, module: string, name: string) {
  return { path, type: { module, name }, match: { slug: ':slug' } };
}

function siteFiles() {
  return {
    'site.gts': postModule('Post'),
    'realm.json': JSON.stringify({
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Site' },
          hostRoutingRules: [
            // Leaves the realm and comes back to its own module.
            route('/local/:slug', './sub/../site', 'Post'),
            // Reaches the shared realm by a relative path.
            route('/escape/:slug', '../shared/post', 'Post'),
            route('/private/:slug', `${PRIVATE}secret`, 'Secret'),
            route('/stranger/:slug', `${STRANGER}secret`, 'Secret'),
            route('/shared/:slug', `${SHARED}post`, 'Post'),
          ],
        },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    }),
  };
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server;
  let site: Realm;
  let realms: Realm[] = [];
  let db: PgAdapter;

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      // The shared and the private realm come first, so the site's index
      // finds their modules served.
      realms: [
        {
          realmURL: new URL(SHARED),
          fileSystem: { 'post.gts': postModule('Post') },
          permissions: { '*': ['read'], [OWNER]: ['read', 'write'] },
        },
        {
          realmURL: new URL(PRIVATE),
          fileSystem: { 'secret.gts': postModule('Secret') },
          permissions: { [OWNER]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(STRANGER),
          fileSystem: { 'secret.gts': postModule('Secret') },
          permissions: { [OTHER_USER]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(SITE),
          fileSystem: siteFiles(),
          permissions: { [OWNER]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    db = dbAdapter;
    server = result.testRealmHttpServer;
    realms = result.realms;
    site = realms.find((realm) => realm.url === SITE)!;
  }

  async function stop() {
    for (let realm of realms) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: stop,
  });

  function warningFor(
    warnings: readonly { path: string; code: string; dropped: boolean }[],
    path: string,
  ) {
    return warnings.find((warning) => warning.path === path);
  }

  test("a relative type module that stays in the realm names the realm's own type", async function (assert) {
    let { routes, warnings } = await site.getHostRoutes();
    let local = routes.find((r) => r.fullPath === '/local/:slug');
    assert.strictEqual(local?.kind, 'field-match', 'the route is kept');
    assert.strictEqual(
      local?.kind === 'field-match' ? local.type.module : undefined,
      `${SITE}site`,
    );
    assert.strictEqual(warningFor(warnings, '/local/:slug'), undefined);
  });

  test('a relative type module that leaves the realm drops its route, even to a public realm', async function (assert) {
    let { routes, warnings } = await site.getHostRoutes();
    assert.notOk(
      routes.some((r) => r.fullPath === '/escape/:slug'),
      'the route is dropped',
    );
    let warning = warningFor(warnings, '/escape/:slug');
    assert.strictEqual(warning?.code, 'cross-realm-type-path');
    assert.true(warning?.dropped);
  });

  test("a type in a realm that a visitor who isn't signed in can't read drops its route", async function (assert) {
    let { routes, warnings } = await site.getHostRoutes();
    assert.notOk(
      routes.some((r) => r.fullPath === '/private/:slug'),
      "the route is dropped, though the site's owner can read the type",
    );
    let warning = warningFor(warnings, '/private/:slug');
    assert.strictEqual(warning?.code, 'non-public-type');
    assert.true(warning?.dropped);
  });

  test("a type in a realm that the site's owner can't read drops its route as not public", async function (assert) {
    let { routes, warnings } = await site.getHostRoutes();
    assert.notOk(routes.some((r) => r.fullPath === '/stranger/:slug'));
    let warning = warningFor(warnings, '/stranger/:slug');
    assert.strictEqual(
      warning?.code,
      'non-public-type',
      'not type-unavailable, so its paths answer 404, not 503',
    );
    assert.true(warning?.dropped);
  });

  // Stores the site's tree with one more route, on the private realm's
  // type, as an index would have stored it when that realm was public, or
  // before the index held types to public realms (without the mark).
  async function storeRouteOnPrivateType({ marked }: { marked: boolean }) {
    let [row] = (await db.execute(
      `SELECT rm.value FROM realm_meta rm
       JOIN realm_generations rg
         ON rg.realm_url = rm.realm_url
        AND rg.current_generation = rm.generation
       WHERE rm.realm_url = $1`,
      { bind: [SITE] },
    )) as { value: unknown }[];
    let value = (
      typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value
    ) as { hostRoutes: Record<string, any> };
    let { typeRealmsChecked, ...hostRoutes } = value.hostRoutes;
    let shared = hostRoutes.routes.find(
      (r: { fullPath: string }) => r.fullPath === '/shared/:slug',
    );
    hostRoutes.routes = [
      ...hostRoutes.routes,
      {
        ...shared,
        path: '/private/:slug',
        fullPath: '/private/:slug',
        position: [hostRoutes.routes.length + 10],
        type: { module: `${PRIVATE}secret`, name: 'Secret' },
      },
    ];
    hostRoutes.warnings = hostRoutes.warnings.filter(
      (w: { path: string }) => w.path !== '/private/:slug',
    );
    await db.execute(
      `UPDATE realm_meta SET value = jsonb_set(value, '{hostRoutes}', $2::jsonb) WHERE realm_url = $1`,
      {
        bind: [
          SITE,
          JSON.stringify(
            marked ? { ...hostRoutes, typeRealmsChecked } : hostRoutes,
          ),
        ],
      },
    );
    site.clearRealmIndexCaches();
  }

  async function assertPrivateRouteDropped(assert: Assert) {
    let { routes, warnings } = await site.getHostRoutes();
    assert.notOk(
      routes.some((r) => r.fullPath === '/private/:slug'),
      'the route is not served',
    );
    let warning = warningFor(warnings, '/private/:slug');
    assert.strictEqual(warning?.code, 'non-public-type');
    assert.true(warning?.dropped);
    assert.true(
      routes.some((r) => r.fullPath === '/shared/:slug'),
      'a route on a public type is still served',
    );
  }

  test('a stored route on a type whose realm is no longer public is not served', async function (assert) {
    await storeRouteOnPrivateType({ marked: true });
    await assertPrivateRouteDropped(assert);
  });

  test('a tree stored before types were held to public realms does not serve a route on a type in a realm that is not public', async function (assert) {
    await storeRouteOnPrivateType({ marked: false });
    await assertPrivateRouteDropped(assert);
  });

  test('a type in a realm anyone may read, named by its full URL, is kept', async function (assert) {
    let { routes, warnings } = await site.getHostRoutes();
    let shared = routes.find((r) => r.fullPath === '/shared/:slug');
    assert.strictEqual(shared?.kind, 'field-match', 'the route is kept');
    assert.strictEqual(
      shared?.kind === 'field-match' ? shared.type.module : undefined,
      `${SHARED}post`,
    );
    assert.strictEqual(warningFor(warnings, '/shared/:slug'), undefined);
  });
});
