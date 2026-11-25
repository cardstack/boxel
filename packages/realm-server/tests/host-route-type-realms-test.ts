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

// A site whose field-match routes name types in its own realm, in the base
// realm, and in two other users' workspaces on the same server: one that
// anyone may read and one that only its owner may read.
const SITE = 'http://127.0.0.1:4444/site/';
const SHARED = 'http://127.0.0.1:4444/shared/';
const PRIVATE = 'http://127.0.0.1:4444/private/';
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
            {
              path: '/base/:slug',
              type: { module: '@cardstack/base/card-api', name: 'CardDef' },
              match: { cardTitle: ':slug' },
            },
            // Reaches the shared workspace by a relative path.
            route('/escape/:slug', '../shared/post', 'Post'),
            route('/shared/:slug', `${SHARED}post`, 'Post'),
            route('/private/:slug', `${PRIVATE}secret`, 'Secret'),
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
      realms: [
        {
          realmURL: new URL(SHARED),
          fileSystem: { 'post.gts': postModule('Post') },
          permissions: { '*': ['read'], [OTHER_USER]: ['read', 'write'] },
        },
        {
          realmURL: new URL(PRIVATE),
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
    warnings: readonly {
      path: string;
      code: string;
      dropped: boolean;
      message: string;
    }[],
    path: string,
  ) {
    return warnings.find((warning) => warning.path === path);
  }

  function assertDropped(assert: Assert, path: string, module: string) {
    assert.notOk(
      routes.some((r) => r.fullPath === path),
      `${path} is dropped`,
    );
    let warning = warningFor(warnings, path);
    assert.strictEqual(warning?.code, 'type-outside-realm');
    assert.true(warning?.dropped);
    assert.true(
      warning?.message.includes(module),
      `the warning names ${module}`,
    );
  }

  let routes: Awaited<ReturnType<Realm['getHostRoutes']>>['routes'];
  let warnings: Awaited<ReturnType<Realm['getHostRoutes']>>['warnings'];
  hooks.beforeEach(async function () {
    ({ routes, warnings } = await site.getHostRoutes());
  });

  test("a relative type module that stays in the realm names the realm's own type", async function (assert) {
    let local = routes.find((r) => r.fullPath === '/local/:slug');
    assert.strictEqual(local?.kind, 'field-match', 'the route is kept');
    assert.strictEqual(
      local?.kind === 'field-match' ? local.type.module : undefined,
      `${SITE}site`,
    );
    assert.strictEqual(warningFor(warnings, '/local/:slug'), undefined);
  });

  test('a type in the base realm is kept', async function (assert) {
    let base = routes.find((r) => r.fullPath === '/base/:slug');
    assert.strictEqual(base?.kind, 'field-match', 'the route is kept');
    assert.notStrictEqual(
      warningFor(warnings, '/base/:slug')?.code,
      'type-outside-realm',
    );
  });

  test('a relative type module that leaves the realm is resolved to its full URL, and its route is dropped', async function (assert) {
    assertDropped(assert, '/escape/:slug', `${SHARED}post`);
  });

  test("a type in another user's workspace is dropped, also when anyone may read that workspace", async function (assert) {
    assertDropped(assert, '/shared/:slug', `${SHARED}post`);
    assertDropped(assert, '/private/:slug', `${PRIVATE}secret`);
  });
});
