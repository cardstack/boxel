import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import { checkAnonymousHomePage } from '../lib/anonymous-home-page.ts';
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

// Four realms that serve the same home page, each opening it differently to
// visitors who aren't signed in:
// - Open: everyone may read the whole realm.
// - Closed: only its owner may.
// - Governed: only its owner may, and its policy, in the Org realm, opens the
//   home card to visitors who aren't signed in but not the source of its
//   module.
// - Routed: everyone may read it, and a routing rule serves a card other than
//   its index card at its root.
const OPEN = 'http://127.0.0.1:4444/open-site/';
const CLOSED = 'http://127.0.0.1:4444/closed-site/';
const GOVERNED = 'http://127.0.0.1:4444/governed-site/';
const ROUTED = 'http://127.0.0.1:4444/routed-site/';
const ORG = 'http://127.0.0.1:4444/org/';
const GOVERNED_POLICY = `${ORG}policies/governed-site`;
const OWNER = '@owner:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const GREETING_MODULE = `
  export const greeting = 'Welcome';
`;

// A module nothing imports. A test lists it among the home card's render
// deps, as a module only the card's HTML render loaded.
const RENDER_ONLY_MODULE = `
  export const footnote = 'Rendered only';
`;

const HOME_MODULE = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { greeting } from "./greeting";
  export class Home extends CardDef {
    @field headline = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      get greeting() {
        return greeting;
      }
      <template>
        <p>{{this.greeting}}</p>
        <h1><@fields.headline /></h1>
      </template>
    };
  }
`;

function home(headline: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { headline },
      meta: { adoptsFrom: { module: './home', name: 'Home' } },
    },
  });
}

function siteFiles(name: string, realmJSON = realmConfigCardJSON({ name })) {
  return {
    'realm.json': realmJSON,
    'greeting.ts': GREETING_MODULE,
    'home.gts': HOME_MODULE,
    'render-only.ts': RENDER_ONLY_MODULE,
    'index.json': home(`${name} home`),
  };
}

// Opens the governed site's home card to visitors who aren't signed in, and
// grants them nothing else: no `readSource`, so its module stays closed.
const GOVERNED_POLICY_CARD = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        {
          targetType: { module: `${GOVERNED}home`, name: 'Home' },
          grants: [{ operation: 'read', where: 'actor() == "anonymous"' }],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
});

// A realm config whose routing rule for `/` serves the landing card.
const ROUTED_REALM_CONFIG = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Routed' },
      hostRoutingRules: [{ path: '/' }],
    },
    relationships: {
      'hostRoutingRules.0.instance': { links: { self: './landing' } },
    },
    meta: {
      adoptsFrom: {
        module: rri('@cardstack/base/realm-config'),
        name: 'RealmConfig',
      },
    },
  },
});

module(basename(import.meta.filename), function (hooks) {
  let realms: Realm[] = [];
  let server: Server;
  let db: PgAdapter;

  setupCatalogTestSubset(hooks);

  function realm(url: string): Realm {
    return realms.find((candidate) => candidate.url === url)!;
  }

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let ownerOnly: RealmPermissions = {
      [OWNER]: ['read', 'write', 'realm-owner'],
    };
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(OPEN),
          fileSystem: siteFiles('Open'),
          permissions: { '*': ['read'], ...ownerOnly },
        },
        {
          realmURL: new URL(CLOSED),
          fileSystem: siteFiles('Closed'),
          permissions: { ...ownerOnly },
        },
        {
          realmURL: new URL(GOVERNED),
          fileSystem: siteFiles(
            'Governed',
            realmConfigCardJSON({ name: 'Governed', policy: GOVERNED_POLICY }),
          ),
          permissions: { ...ownerOnly },
        },
        {
          realmURL: new URL(ROUTED),
          fileSystem: {
            ...siteFiles('Routed', ROUTED_REALM_CONFIG),
            'landing.json': home('Routed landing'),
          },
          permissions: { '*': ['read'], ...ownerOnly },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/governed-site.json': GOVERNED_POLICY_CARD,
          },
          permissions: { ...ownerOnly },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    realms = result.realms;
  }

  async function stop() {
    for (let each of realms) {
      each.__testOnlyClearCaches();
      each.unsubscribe();
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
      db = dbAdapter;
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: stop,
  });

  test('a realm everyone may read passes', async function (assert) {
    let report = await checkAnonymousHomePage(realm(OPEN));

    assert.strictEqual(
      report.homeCardId,
      `${OPEN}index`,
      'the home card is the index card',
    );
    assert.true(report.homeCardReadable, 'the home card is readable');
    assert.deepEqual(
      report.unloadableModules,
      [],
      'every module of the home card loads',
    );
    assert.true(report.anonymousCanView, 'the realm passes');
  });

  test('a realm only its owner may read fails', async function (assert) {
    let report = await checkAnonymousHomePage(realm(CLOSED));

    assert.strictEqual(report.homeCardId, `${CLOSED}index`);
    assert.false(report.homeCardReadable, 'the home card is not readable');
    assert.notStrictEqual(report.homeCardStatus, 200);
    assert.true(
      report.unloadableModules.some(({ url }) => url === `${CLOSED}home`),
      `the home card's module is named as unloadable (${JSON.stringify(
        report.unloadableModules,
      )})`,
    );
    assert.false(report.anonymousCanView, 'the realm fails');
  });

  test("a policy that opens the home card but not its module's source fails, naming the module", async function (assert) {
    let report = await checkAnonymousHomePage(realm(GOVERNED));

    assert.strictEqual(report.homeCardId, `${GOVERNED}index`);
    assert.true(
      report.homeCardReadable,
      'the policy lets a visitor who is not signed in read the home card',
    );
    let urls = report.unloadableModules.map(({ url }) => url);
    assert.true(
      urls.includes(`${GOVERNED}home`),
      `the home card's module is named as unloadable (${JSON.stringify(
        report.unloadableModules,
      )})`,
    );
    assert.true(
      urls.every((url) => url.startsWith(GOVERNED)),
      'only modules from the realm itself are named',
    );
    assert.false(report.anonymousCanView, 'the realm fails');
  });

  test("a module only the home card's HTML render loaded is checked too", async function (assert) {
    let renderOnly = `${GOVERNED}render-only`;
    await db.execute(
      `UPDATE prerendered_html
       SET deps = COALESCE(deps, '[]'::jsonb) || jsonb_build_array($1::text)
       WHERE url = $2 AND type = 'instance'`,
      { bind: [renderOnly, `${GOVERNED}index.json`] },
    );
    let rows = (await db.execute(
      `SELECT 1 FROM prerendered_html
       WHERE url = $1 AND type = 'instance' AND deps @> jsonb_build_array($2::text)`,
      { bind: [`${GOVERNED}index.json`, renderOnly] },
    )) as unknown[];
    assert.strictEqual(rows.length, 1, "the home card's render deps name it");

    let report = await checkAnonymousHomePage(realm(GOVERNED));

    assert.true(
      report.unloadableModules.some(({ url }) => url === renderOnly),
      `the render-only module is named as unloadable (${JSON.stringify(
        report.unloadableModules,
      )})`,
    );
  });

  test('a routing rule for the root makes its card the one checked', async function (assert) {
    let report = await checkAnonymousHomePage(realm(ROUTED));

    assert.strictEqual(
      report.homeCardId,
      `${ROUTED}landing`,
      'the card the rule for `/` names is the home card',
    );
    assert.true(report.homeCardReadable, 'the landing card is readable');
    assert.true(report.anonymousCanView, 'the realm passes');
  });
});
