import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
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
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A site realm anyone may read routes two paths to cards a store realm holds.
// The store realm is private: no one but its owner is on its ACL. Its policy
// opens one of the two cards to visitors who aren't signed in, and the site
// card opts in to serving the store's own prerender (ADR 016). The page at the
// opened card's path is the store's; the other path is served as if unrouted.
const SITE = 'http://127.0.0.1:4444/site/';
const STORE = 'http://127.0.0.1:4444/store/';
const ORG = 'http://127.0.0.1:4444/org/';
const STORE_POLICY = `${ORG}policies/store`;
const OWNER = '@owner:localhost';
const ORG_ADMIN = '@org-admin:localhost';
// A caller's address from the range reserved for documentation.
const VISITOR = '192.0.2.10';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const PAGE = { module: `${STORE}page`, name: 'Page' };

const PAGE_MODULE = `
  import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
  import BooleanField from '@cardstack/base/boolean';
  import StringField from '@cardstack/base/string';
  export class Page extends CardDef {
    @field label = contains(StringField);
    @field open = contains(BooleanField);
    static isolated = class extends Component<typeof Page> {
      <template><p>Store page {{@model.label}}</p></template>
    };
  }
`;

const SITE_MODULE = `
  import { CardDef, contains, field } from '@cardstack/base/card-api';
  import BooleanField from '@cardstack/base/boolean';
  export class TestSite extends CardDef {
    @field serveSourcePrerender = contains(BooleanField);
  }
`;

function page(label: string, open: boolean) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { label, open },
      meta: { adoptsFrom: { module: '../page', name: 'Page' } },
    },
  });
}

function siteRealmConfig() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name: 'Site' },
        site: './Site/main',
        hostRoutingRules: [{ path: '/opened' }, { path: '/closed' }],
      },
      relationships: {
        'hostRoutingRules.0.instance': {
          links: { self: `${STORE}pages/opened` },
        },
        'hostRoutingRules.1.instance': {
          links: { self: `${STORE}pages/closed` },
        },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/realm-config',
          name: 'RealmConfig',
        },
      },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let site: Realm;
  let store: Realm;
  let org: Realm;
  let server: Server;
  let request: SuperTest<Test>;

  setupCatalogTestSubset(hooks);

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
      clientAddress: { trustedProxyHops: 1, infraAddresses: [] },
      realms: [
        {
          realmURL: new URL(SITE),
          fileSystem: {
            'realm.json': siteRealmConfig(),
            'site.gts': SITE_MODULE,
            'Site/main.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: { serveSourcePrerender: true },
                meta: { adoptsFrom: { module: '../site', name: 'TestSite' } },
              },
            }),
          },
          permissions: {
            '*': ['read'],
            [OWNER]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(STORE),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Store',
              policy: STORE_POLICY,
            }),
            'page.gts': PAGE_MODULE,
            'pages/opened.json': page('opened', true),
            'pages/closed.json': page('closed', false),
          },
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
            [ORG_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/store.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {
                  rules: [
                    {
                      targetType: PAGE,
                      grants: [
                        {
                          operation: 'read',
                          where: 'actor() == "anonymous" and .open == true',
                        },
                      ],
                    },
                  ],
                },
                meta: { adoptsFrom: REALM_POLICY },
              },
            }),
          },
          permissions: { [ORG_ADMIN]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    site = result.realms.find((realm) => realm.url === SITE)!;
    store = result.realms.find((realm) => realm.url === STORE)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [site, store, org]) {
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

  function visit(path: string) {
    return request
      .get(`${new URL(SITE).pathname}${path}`)
      .set('Accept', 'text/html')
      .set('X-Forwarded-For', VISITOR);
  }

  test('a card the store’s policy opens to visitors is served as the store prerendered it', async function (assert) {
    let response = await visit('opened');
    assert.strictEqual(response.status, 200, '/opened serves');
    assert.true(
      response.text.includes('Store page opened'),
      'the page carries the HTML the store prerendered',
    );
  });

  test('a card the store’s policy keeps from visitors is not served', async function (assert) {
    let response = await visit('closed');
    assert.false(
      response.text.includes('Store page closed'),
      'the store’s HTML for a card visitors may not read never reaches the path',
    );
  });
});
