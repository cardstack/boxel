import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { param, query, rri } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
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

// Pages served on host URLs, from two realms:
// - Governed: only its owner may read it, and its policy, in the Org realm,
//   opens its Home cards to visitors who aren't signed in, and nothing else.
//   A routing rule serves its About card at `/about`, and a card id route
//   serves the cards under `docs/` at `/docs/:id`. It is served at the root of
//   one host.
// - Open: everyone may read it. It is served at the root of its canonical
//   host, and under a path prefix on another host.
const GOVERNED = 'http://127.0.0.1:4444/governed-site/';
const OPEN = 'http://127.0.0.1:4444/open-site/';
const ORG = 'http://127.0.0.1:4444/org/';
const GOVERNED_POLICY = `${ORG}policies/governed-site`;
const OWNER = '@owner:localhost';

const GOVERNED_HOST = 'governed.localhost';
const OPEN_HOST = 'open.localhost';
const SPACE_HOST = 'space.localhost';
const SPACE_PREFIX = '/shop/';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const HOME_MODULE = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Home extends CardDef {
    @field headline = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <h1 data-headline><@fields.headline /></h1>
      </template>
    };
  }
`;

const SECRET_MODULE = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Secret extends CardDef {
    @field note = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <p data-note><@fields.note /></p>
      </template>
    };
  }
`;

function card(module: string, name: string, attributes: object) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module, name } },
    },
  });
}

// Opens the governed site's Home cards to visitors who aren't signed in.
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

// The governed site's config: its policy, a routing rule that serves the
// About card at `/about`, and a card id route for the cards under `docs/`.
function governedRealmConfig() {
  let doc = JSON.parse(
    realmConfigCardJSON({ name: 'Governed', policy: GOVERNED_POLICY }),
  );
  doc.data.attributes.hostRoutingRules = [
    { path: '/about' },
    { path: '/docs/:id', card: './docs/:id' },
  ];
  doc.data.relationships = {
    'hostRoutingRules.0.instance': { links: { self: './about' } },
  };
  return JSON.stringify(doc);
}

// The placeholder the prerenderer stores for a default index card it does not
// render in full.
const DEFAULT_INDEX_PLACEHOLDER = `<section data-prerender><div class="boxel-realm-index-shell" data-boxel-realm-index aria-busy="true">Placeholder</div></section>`;

function attr(html: string, tagPattern: RegExp, name: string) {
  let tag = html.match(tagPattern)?.[0];
  return tag?.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function hostConfig(html: string): Record<string, any> {
  let content = html.match(
    /<meta name="@cardstack\/host\/config\/environment" content="([^"]*)"/,
  )?.[1];
  return JSON.parse(decodeURIComponent(content ?? '{}'));
}

module(basename(import.meta.filename), function (hooks) {
  let realms: Realm[] = [];
  let server: Server;
  let request: SuperTest<Test>;
  let db: PgAdapter;

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
    let ownerOnly: RealmPermissions = {
      [OWNER]: ['read', 'write', 'realm-owner'],
    };
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(GOVERNED),
          fileSystem: {
            'realm.json': governedRealmConfig(),
            'home.gts': HOME_MODULE,
            'secret.gts': SECRET_MODULE,
            'index.json': card('./home', 'Home', {
              headline: 'Governed home',
            }),
            'about.json': card('./home', 'Home', { headline: 'About us' }),
            'secret.json': card('./secret', 'Secret', { note: 'Top secret' }),
            'docs/private.json': card('../secret', 'Secret', {
              note: 'Private doc',
            }),
            'notes/release-2.0.json': card('../home', 'Home', {
              headline: 'Release notes',
            }),
          },
          permissions: { ...ownerOnly },
        },
        {
          realmURL: new URL(OPEN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Open' }),
            'home.gts': HOME_MODULE,
            'index.json': card('./home', 'Home', { headline: 'Open home' }),
            'landing.json': card('./home', 'Home', {
              headline: 'Open landing',
            }),
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
    request = supertest(server);
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

  async function realmIdFor(realmURL: string): Promise<string> {
    let rows = (await query(db, [
      `SELECT id FROM realm_registry WHERE url =`,
      param(realmURL),
    ])) as { id: string }[];
    if (rows[0]) {
      return rows[0].id;
    }
    rows = (await query(db, [
      `INSERT INTO realm_registry (url, kind, disk_id, owner_username) VALUES (`,
      param(realmURL),
      `, 'source', `,
      param(`test/${realmURL}`),
      `, 'owner') RETURNING id`,
    ])) as { id: string }[];
    return rows[0].id;
  }

  async function addHostURL(
    realmURL: string,
    host: string,
    pathPrefix: string,
    isCanonical: boolean,
  ) {
    await query(db, [
      `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
      param(await realmIdFor(realmURL)),
      `, 'site-name', `,
      param(host),
      `, `,
      param(pathPrefix),
      `, `,
      param(isCanonical),
      `, `,
      param(OWNER),
      `)`,
    ]);
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
      await addHostURL(GOVERNED, GOVERNED_HOST, '/', true);
      await addHostURL(OPEN, OPEN_HOST, '/', true);
      await addHostURL(OPEN, SPACE_HOST, SPACE_PREFIX, false);
    },
    afterEach: stop,
  });

  function page(path: string, host: string, accept = 'text/html') {
    return request.get(path).set('Host', host).set('Accept', accept);
  }

  test("a page whose card the realm's policy opens to visitors is server-rendered", async function (assert) {
    let response = await page('/', GOVERNED_HOST);

    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.true(
      /<h1 data-headline[^>]*>[\s\S]*Governed home/.test(response.text),
      "the home card's stored HTML is served",
    );
    assert.false(
      response.text.includes(GOVERNED),
      'the page names no realm URL',
    );
  });

  test("a page whose card the realm's policy does not open renders in the browser", async function (assert) {
    let response = await page('/secret', GOVERNED_HOST);

    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.false(
      response.text.includes('Top secret'),
      "the card's stored HTML is not served",
    );
    assert.false(
      response.text.includes('data-boxel-scoped-css'),
      "the card's scoped CSS is not served",
    );
    assert.true(
      response.text.includes('<title>Boxel</title>'),
      "the card's head is not served",
    );
  });

  test("a card's scoped CSS is served on a host URL only where a visitor may read the card, whether or not its row holds isolated markup", async function (assert) {
    let cssDep = (card: string, css: string) =>
      `${GOVERNED}${card}.gts.${Buffer.from(css, 'utf8').toString('base64')}.glimmer-scoped.css`;
    // The Secret card's row holds scoped CSS and no isolated markup, as a row
    // can after a failed render. The Home card's row holds both.
    await db.execute(
      `UPDATE prerendered_html SET isolated_html = NULL, deps = $1::jsonb
       WHERE url = $2 AND type = 'instance'`,
      {
        bind: [
          JSON.stringify([cssDep('secret', '.secret-marker { top: 0; }')]),
          `${GOVERNED}secret.json`,
        ],
      },
    );
    await db.execute(
      `UPDATE prerendered_html SET deps = $1::jsonb
       WHERE url = $2 AND type = 'instance'`,
      {
        bind: [
          JSON.stringify([cssDep('home', '.home-marker { top: 0; }')]),
          `${GOVERNED}index.json`,
        ],
      },
    );

    let refused = await page('/secret', GOVERNED_HOST);
    assert.strictEqual(refused.status, 200, refused.text.slice(0, 300));
    assert.false(
      refused.text.includes('secret-marker'),
      'the scoped CSS of a card visitors may not read is not served',
    );

    let admitted = await page('/', GOVERNED_HOST);
    assert.strictEqual(admitted.status, 200, admitted.text.slice(0, 300));
    assert.true(
      admitted.text.includes('home-marker'),
      'the scoped CSS of a card visitors may read is served',
    );
  });

  test("a card whose id looks like it has an extension is server-rendered when the realm's policy opens it", async function (assert) {
    let response = await page('/notes/release-2.0', GOVERNED_HOST);

    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.true(
      /<h1 data-headline[^>]*>[\s\S]*Release notes/.test(response.text),
      "the card's stored HTML is served",
    );
  });

  test('a generic Accept request on a host URL answers a card visitors may not read as it answers a path that holds nothing', async function (assert) {
    let privateCard = await page('/docs/private', GOVERNED_HOST, '*/*');
    let nothing = await page('/docs/missing', GOVERNED_HOST, '*/*');

    assert.strictEqual(privateCard.status, nothing.status, privateCard.text);
    assert.false(
      (privateCard.headers['content-type'] ?? '').startsWith('text/html'),
      'the private card is not served as a page',
    );
    assert.false(privateCard.text.includes('Private doc'));
  });

  test('a dynamic route on a host URL answers a card visitors may not read as not found, as it answers a path that holds nothing', async function (assert) {
    let privateCard = await page('/docs/private', GOVERNED_HOST);
    let nothing = await page('/docs/missing', GOVERNED_HOST);

    assert.strictEqual(nothing.status, 404, nothing.text.slice(0, 300));
    assert.strictEqual(privateCard.status, 404, privateCard.text.slice(0, 300));
    assert.false(privateCard.text.includes('Private doc'));
  });

  test("the realm's own URL serves the bare shell to visitors when the realm has no public read", async function (assert) {
    let response = await request
      .get(new URL(GOVERNED).pathname)
      .set('Accept', 'text/html');

    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.false(
      response.text.includes('Governed home'),
      'no stored HTML is served off a host URL',
    );
  });

  test('a routing rule applies on a host URL of a realm without public read', async function (assert) {
    let response = await page('/about', GOVERNED_HOST);

    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.true(
      response.text.includes('About us'),
      "the routed card's stored HTML is served",
    );
    let routingMap = hostConfig(response.text).hostRoutingMap;
    assert.deepEqual(routingMap, [
      { path: '/about', id: `http://${GOVERNED_HOST}/about` },
    ]);
  });

  test('a page names its address on the canonical host URL as canonical, on every host URL', async function (assert) {
    for (let [host, path] of [
      [SPACE_HOST, `${SPACE_PREFIX}landing`],
      [OPEN_HOST, '/landing'],
    ]) {
      let response = await page(path, host);

      assert.strictEqual(response.status, 200, response.text.slice(0, 300));
      assert.true(response.text.includes('Open landing'), `${host}: page`);
      assert.strictEqual(
        attr(response.text, /<link [^>]*rel="canonical"[^>]*>/, 'href'),
        `http://${OPEN_HOST}/landing`,
        `${host}: canonical link`,
      );
      assert.strictEqual(
        attr(response.text, /<meta [^>]*property="og:url"[^>]*>/, 'content'),
        `http://${OPEN_HOST}/landing`,
        `${host}: og:url`,
      );
    }
  });

  test('a host URL does not serve the default index placeholder', async function (assert) {
    await db.execute(
      `UPDATE prerendered_html SET isolated_html = $1
       WHERE url = $2 AND type = 'instance'`,
      { bind: [DEFAULT_INDEX_PLACEHOLDER, `${OPEN}index.json`] },
    );
    // A card whose markup only mentions the placeholder's attribute.
    await db.execute(
      `UPDATE prerendered_html SET isolated_html = $1
       WHERE url = $2 AND type = 'instance'`,
      {
        bind: [
          '<section data-prerender><article><p>The shell carries data-boxel-realm-index.</p></article></section>',
          `${OPEN}landing.json`,
        ],
      },
    );

    let onHostURL = await page('/', OPEN_HOST);
    assert.strictEqual(onHostURL.status, 200, onHostURL.text.slice(0, 300));
    assert.false(
      onHostURL.text.includes('data-boxel-realm-index'),
      'the placeholder is not served on a host URL',
    );

    let onRealmURL = await request
      .get(new URL(OPEN).pathname)
      .set('Accept', 'text/html');
    assert.true(
      onRealmURL.text.includes('data-boxel-realm-index'),
      "the realm's own URL serves what the index holds",
    );

    let mentioning = await page('/landing', OPEN_HOST);
    assert.true(
      mentioning.text.includes('The shell carries data-boxel-realm-index.'),
      'a card that only mentions the attribute is served',
    );
  });

  test("a page's own og:url is kept, whether its head names it by property or by name", async function (assert) {
    await db.execute(
      `UPDATE prerendered_html SET head_html = $1
       WHERE url = $2 AND type = 'instance'`,
      {
        bind: [
          '<title>Landing</title><meta name="og:url" content="https://example.com/landing" />',
          `${OPEN}landing.json`,
        ],
      },
    );

    let response = await page('/landing', OPEN_HOST);
    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.strictEqual(
      response.text.match(/og:url/g)?.length,
      1,
      'no second og:url is added',
    );
  });

  test('a generic Accept request on a host URL gets the page for a card, and the module for a module', async function (assert) {
    let cardResponse = await page(`${SPACE_PREFIX}landing`, SPACE_HOST, '*/*');
    assert.strictEqual(cardResponse.status, 200, cardResponse.text);
    assert.true(
      (cardResponse.headers['content-type'] ?? '').startsWith('text/html'),
      'a card path is served as a page',
    );
    assert.true(cardResponse.text.includes('Open landing'));

    let moduleResponse = await page(`${SPACE_PREFIX}home`, SPACE_HOST, '*/*');
    assert.strictEqual(moduleResponse.status, 200, moduleResponse.text);
    assert.false(
      (moduleResponse.headers['content-type'] ?? '').startsWith('text/html'),
      'a module path is served as the module',
    );
  });

  test('a page on a host URL of a realm everyone may read has an ETag a shared cache may keep, and a matching request gets a 304', async function (assert) {
    let response = await page('/landing', OPEN_HOST);
    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    let etag = response.headers['etag'];
    assert.ok(etag, 'the page has an ETag');
    assert.strictEqual(
      response.headers['cache-control'],
      'public, max-age=0, must-revalidate',
    );
    let vary = (response.headers['vary'] ?? '').toLowerCase();
    for (let header of ['accept', 'sec-fetch-dest', 'authorization']) {
      assert.true(vary.includes(header), `it varies on ${header} (${vary})`);
    }

    let conditional = await page('/landing', OPEN_HOST).set(
      'If-None-Match',
      etag,
    );
    assert.strictEqual(
      conditional.status,
      304,
      'a matching request gets a 304',
    );
    assert.notOk(conditional.text, 'with no body');
    assert.strictEqual(conditional.headers['etag'], etag);
  });

  test("a page's ETag changes with its content and with the host URL it is served on", async function (assert) {
    let first = await page('/landing', OPEN_HOST);
    let etag = first.headers['etag'];
    assert.ok(etag);

    let onSpace = await page(`${SPACE_PREFIX}landing`, SPACE_HOST);
    assert.ok(onSpace.headers['etag']);
    assert.notStrictEqual(
      onSpace.headers['etag'],
      etag,
      'each host URL has its own ETag',
    );

    await db.execute(
      `UPDATE prerendered_html SET isolated_html = $1
       WHERE url = $2 AND type = 'instance'`,
      {
        bind: [
          '<section data-prerender><h1 data-headline>Changed landing</h1></section>',
          `${OPEN}landing.json`,
        ],
      },
    );
    let changed = await page('/landing', OPEN_HOST).set('If-None-Match', etag);
    assert.strictEqual(
      changed.status,
      200,
      'the old ETag no longer matches once the page changes',
    );
    assert.true(changed.text.includes('Changed landing'));
    assert.notStrictEqual(changed.headers['etag'], etag);
  });

  test("a page whose markup the realm's policy admits is private", async function (assert) {
    let response = await page('/', GOVERNED_HOST);
    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.true(response.text.includes('Governed home'));
    assert.ok(response.headers['etag'], 'it still has an ETag');
    assert.strictEqual(
      response.headers['cache-control'],
      'private, max-age=0, must-revalidate',
      'a grant can answer two visitors differently, so no shared cache keeps it',
    );
  });

  test('a signed-in request for a page is private', async function (assert) {
    let response = await page('/landing', OPEN_HOST).set(
      'Authorization',
      'Bearer not-checked-here',
    );
    assert.strictEqual(response.status, 200, response.text.slice(0, 300));
    assert.strictEqual(
      response.headers['cache-control'],
      'private, max-age=0, must-revalidate',
    );
  });

  test("a published realm's publish-time ETag never answers a 304 on a host URL", async function (assert) {
    // A published realm names the realm it was published from.
    await db.execute(
      `UPDATE realm_registry
       SET kind = 'published', source_url = $2, last_published_at = '1700000000000'
       WHERE url = $1`,
      { bind: [OPEN, 'http://127.0.0.1:4444/published-from/'] },
    );
    let onRealmURL = await request
      .get(`${new URL(OPEN).pathname}landing`)
      .set('Accept', 'text/html');
    let publishTag = onRealmURL.headers['etag'];
    assert.true(
      (publishTag ?? '').startsWith('"1700000000000-'),
      `the realm's own URL has the publish-time ETag (${publishTag})`,
    );

    let onHostURL = await page('/landing', OPEN_HOST);
    let pageTag = onHostURL.headers['etag'];
    assert.false(
      (pageTag ?? '').startsWith('"1700000000000-'),
      `the host URL has the page-hash ETag (${pageTag})`,
    );
    // The publish-time tag as the host URL's boundary would have sent it, with
    // the suffix that names its translation.
    let suffix = pageTag.match(/(\.h[^"]+)"$/)?.[1];
    assert.ok(suffix, 'the host URL ETag carries the translation suffix');
    let conditional = await page('/landing', OPEN_HOST).set(
      'If-None-Match',
      publishTag.replace(/"$/, `${suffix}"`),
    );
    assert.strictEqual(
      conditional.status,
      200,
      'the publish-time tag does not match the page',
    );
  });

  test('a not-found page on a host URL has no ETag', async function (assert) {
    let response = await page('/docs/missing', GOVERNED_HOST);
    assert.strictEqual(response.status, 404, response.text.slice(0, 300));
    assert.strictEqual(response.headers['etag'], undefined);
  });
});
