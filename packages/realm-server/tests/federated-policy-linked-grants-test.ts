import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A federated search naming one realm the caller reaches through its policy
// reads each linked card under that card's own type's grants (a link facet's
// labels, a `linkedFrom` card), as a direct read of the card would face.
//
// A caller a realm policy admits reads a search's every output through the
// grants: its rows, its facet counts, its link labels and its scores. So a
// row the grants hide, once added, leaves the whole response as it was.

const NEWSROOM = 'http://127.0.0.1:4444/newsroom/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY = `${ORG}policies/newsroom`;
const EDITOR = '@editor:localhost';
// Signed in, holding no permission on the Newsroom: every row they are
// served is one a grant admits.
const MEMBER = '@member:localhost';
// Signed in too, reads the published articles, and owns no picks list.
const OTHER = '@other:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const MODULE = `
  import { contains, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  export class Section extends CardDef {
    @field name = contains(StringField);
    @field audience = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Section) {
        return this.name;
      },
    });
  }
  export class Article extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField, { search: { facet: true } });
    @field views = contains(NumberField);
    @field section = linksTo(() => Section, {
      searchable: true,
      search: { facet: true },
    });
    @field related = linksToMany(() => Article, { searchable: true });
  }
  export class Picks extends CardDef {
    @field ownerId = contains(StringField);
    @field items = linksToMany(() => Article, { searchable: true });
  }
`;

const type = (name: string) => ({ module: `${NEWSROOM}news`, name });
const Article = type('Article');

function card(name: string, attributes: Record<string, unknown>, links = {}) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      relationships: links,
      meta: { adoptsFrom: { module: '../news', name } },
    },
  });
}

function article(
  headline: string,
  status: string,
  views: number,
  section: string,
) {
  return card(
    'Article',
    { headline, status, views },
    { section: { links: { self: `../sections/${section}` } } },
  );
}

// Published articles are open to signed-in callers; sections and the picks
// list to anyone signed in.
function policyCard() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          {
            targetType: Article,
            grants: [{ operation: 'query', where: '.status == "published"' }],
          },
          {
            targetType: type('Section'),
            grants: [{ operation: 'query', where: '.audience == actor()' }],
          },
          {
            targetType: type('Picks'),
            grants: [{ operation: 'query', where: '.ownerId == actor()' }],
          },
        ],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
  let virtualNetwork: VirtualNetwork;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;

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
    virtualNetwork = createVirtualNetwork();
    let result = await runTestRealmServerWithRealms({
      virtualNetwork,
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(NEWSROOM),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Newsroom',
              policy: POLICY,
            }),
            'news.gts': MODULE,
            'sections/world.json': card('Section', {
              name: 'World',
              audience: MEMBER,
            }),
            'sections/sport.json': card('Section', {
              name: 'Sport',
              audience: MEMBER,
            }),
            'sections/secret.json': card('Section', {
              name: 'Secret desk',
              audience: MEMBER,
            }),
            'articles/a.json': card(
              'Article',
              { headline: 'A', status: 'published', views: 10 },
              {
                section: { links: { self: '../sections/world' } },
                'related.0': { links: { self: './c' } },
                'related.1': { links: { self: './d' } },
              },
            ),
            'articles/b.json': article('B', 'published', 30, 'world'),
            'articles/c.json': article('C', 'published', 20, 'sport'),
            'articles/d.json': article('D', 'draft', 5, 'secret'),
            'picks/mine.json': card(
              'Picks',
              { ownerId: MEMBER },
              {
                'items.0': { links: { self: '../articles/a' } },
                'items.1': { links: { self: '../articles/c' } },
              },
            ),
          },
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
          } satisfies RealmPermissions as RealmPermissions,
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/newsroom.json': policyCard(),
          },
          permissions: { [EDITOR]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    let realm = (url: string) =>
      result.realms.find((candidate) => candidate.url === url)!;
    newsroom = realm(NEWSROOM);
    org = realm(ORG);
  }

  async function stop() {
    for (let realm of [newsroom, org]) {
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
    afterEach: async () => {
      await stop();
    },
  });

  // A hidden row: a draft, in a section no published article is in, with far
  // more views than any other, so it would move every count, label and score
  // it reached.
  async function addHiddenRow() {
    await newsroom.write(
      'articles/hidden.json',
      article('Hidden', 'draft', 100_000, 'secret'),
    );
  }

  // The same search, sent as a federated search naming the Newsroom alone:
  // the grants decide what the caller reads, not the endpoint.
  async function federatedSearch(
    body: Record<string, unknown>,
    caller = MEMBER,
  ) {
    let response = await request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, caller, caller === EDITOR ? ['read', 'write', 'realm-owner'] : [])}`,
      )
      .send({ ...body, realms: [NEWSROOM] });
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    let { data, meta } = response.body as {
      data: { id: string }[];
      meta: Record<string, any>;
    };
    return {
      rows: data.map(({ id }) => [id.replace(NEWSROOM, '')]),
      total: meta.page?.total,
      facets: meta.facets,
    };
  }

  test("a link facet's labels come from the linked type's grants", async function (assert) {
    // Sections are opened to the member only, by the Section rule, which the
    // query's Article grants say nothing about.
    let body = {
      filter: { 'item.on': Article, eq: { 'item.status': 'published' } },
      facets: [{ by: 'item.section' }],
      fields: { entry: ['item.headline'] },
    };
    let labels = (facets: any) =>
      Object.fromEntries(
        (facets?.section ?? []).map((c: any) => [
          String(c.value).replace(NEWSROOM, ''),
          [c.count, c.label ?? null],
        ]),
      );
    assert.deepEqual(
      labels((await federatedSearch(body)).facets),
      { 'sections/world': [2, 'World'], 'sections/sport': [1, 'Sport'] },
      'the member, whom the Section grant admits, sees the section titles',
    );
    assert.deepEqual(
      labels((await federatedSearch(body, OTHER)).facets),
      { 'sections/world': [2, null], 'sections/sport': [1, null] },
      'another caller gets the same counts, and no titles',
    );
  });

  test("linkedFrom to another type's card reads it under that type's grants", async function (assert) {
    // Articles, through the links of a Picks list: the policy opens a Picks
    // list to its owner only.
    let body = {
      filter: {
        every: [
          { 'item.on': Article, eq: { 'item.status': 'published' } },
          {
            linkedFrom: { card: `${NEWSROOM}picks/mine.json`, field: 'items' },
          },
        ],
      },
      fields: { entry: ['item.headline'] },
    };
    let owner = await federatedSearch(body);
    assert.deepEqual(
      owner.rows.map(([id]) => id),
      ['articles/a', 'articles/c'],
      'the owner, whom the Picks grant admits, gets the articles it links',
    );
    let other = await federatedSearch(body, OTHER);
    assert.deepEqual(
      other.rows.map(([id]) => id),
      [],
      "a caller the Picks grant does not admit reads none of the list's links",
    );
    await addHiddenRow();
    assert.deepEqual(
      await federatedSearch(body),
      owner,
      'and a hidden row changes nothing',
    );
  });

  test("linkedFrom names its card in any id form, and reads it under that card's grants", async function (assert) {
    // ADR 002: the card's URL, its registered prefix's id and `$REALM/<path>`
    // name one card, resolved where the request arrives, so the Picks grant
    // that opens the list to its owner applies to each.
    let body = (card: string) => ({
      filter: {
        every: [
          { 'item.on': Article, eq: { 'item.status': 'published' } },
          { linkedFrom: { card, field: 'items' } },
        ],
      },
      fields: { entry: ['item.headline'] },
    });
    let ids = (rows: unknown[][]) => rows.map(([id]) => id);
    // A prefix over the lists' folder only: one over the whole realm would
    // re-spell the realm's already-indexed types too.
    virtualNetwork.addRealmMapping('@test/picks/', `${NEWSROOM}picks/`);
    try {
      for (let card of [
        `${NEWSROOM}picks/mine`,
        '@test/picks/mine',
        '@test/picks/mine.json',
        '$REALM/picks/mine',
      ]) {
        assert.deepEqual(
          ids((await federatedSearch(body(card))).rows),
          ['articles/a', 'articles/c'],
          `the owner gets the articles ${card} links`,
        );
        assert.deepEqual(
          ids((await federatedSearch(body(card), OTHER)).rows),
          [],
          `a caller the Picks grant does not admit reads none of ${card}'s links`,
        );
      }
    } finally {
      virtualNetwork.removeRealmMapping('@test/picks/');
    }
  });

  // The same query from an admitted caller and a refused one, in either
  // order: neither is ever answered with the other's linked titles or links
  // (a cached answer is keyed by whom the linked cards' grants were judged
  // for).
  for (let first of ['admitted', 'refused'] as const) {
    test(`a refused caller never reads an admitted caller's linked cards, ${first} caller first`, async function (assert) {
      let facets = {
        filter: { 'item.on': Article, eq: { 'item.status': 'published' } },
        facets: [{ by: 'item.section' }],
        fields: { entry: ['item.headline'] },
      };
      let linked = {
        filter: {
          every: [
            { 'item.on': Article, eq: { 'item.status': 'published' } },
            {
              linkedFrom: {
                card: `${NEWSROOM}picks/mine.json`,
                field: 'items',
              },
            },
          ],
        },
        fields: { entry: ['item.headline'] },
      };
      let labels = (result: { facets?: any }) =>
        (result.facets?.section ?? []).map((c: any) => c.label ?? null);
      let ids = (result: { rows: unknown[][] }) =>
        result.rows.map(([id]) => id);
      let order = first === 'admitted' ? [MEMBER, OTHER] : [OTHER, MEMBER];
      for (let caller of order) {
        let admitted = caller === MEMBER;
        assert.deepEqual(
          labels(await federatedSearch(facets, caller)),
          admitted ? ['World', 'Sport'] : [null, null],
          `${caller}'s facet labels`,
        );
        assert.deepEqual(
          ids(await federatedSearch(linked, caller)),
          admitted ? ['articles/a', 'articles/c'] : [],
          `${caller}'s rows through linkedFrom`,
        );
      }
    });
  }
});
