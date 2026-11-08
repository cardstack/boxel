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
    @field status = contains(StringField);
    @field views = contains(NumberField);
    @field section = linksTo(() => Section, {
      search: { facet: true, include: ['name'] },
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
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
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

  // The member's search, its response reduced to what a caller reads:
  // the rows in order with their scores, the counts and the labels.
  async function search(body: Record<string, unknown>, caller = MEMBER) {
    let response = await request
      .post(`${new URL(NEWSROOM).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, caller, caller === EDITOR ? ['read', 'write', 'realm-owner'] : [])}`,
      )
      .send(body);
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    let { data, meta } = response.body as {
      data: { id: string; meta?: Record<string, unknown> }[];
      meta: Record<string, any>;
    };
    return {
      rows: data.map(({ id, meta: m }) => [
        id.replace(NEWSROOM, ''),
        m?._rerank ?? null,
        m?._blendScore ?? null,
      ]),
      total: meta.page?.total,
      facets: meta.facets,
      rerank: meta.rerank,
    };
  }

  // A `select` search as `caller`: the status and the body, parsed as a
  // table or, for a line type, as its lines.
  async function table(
    body: Record<string, unknown>,
    caller = MEMBER,
    accept: string = SupportedMimeType.CardJson,
  ) {
    let response = await request
      .post(`${new URL(NEWSROOM).pathname}_search`)
      .set('Accept', accept)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, caller, caller === EDITOR ? ['read', 'write', 'realm-owner'] : [])}`,
      )
      .buffer(true)
      .parse((res, cb) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => cb(null, text));
      })
      .send(body);
    let text = response.body as string;
    let strip = (id: unknown) =>
      typeof id === 'string' ? id.replace(NEWSROOM, '') : id;
    if (response.status !== 200) {
      return { status: response.status, error: JSON.parse(text).errors?.[0] };
    }
    if (accept !== SupportedMimeType.CardJson) {
      return {
        status: 200,
        type: response.headers['content-type'],
        lines: text
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l))
          .map((o) => ('id' in o ? { ...o, id: strip(o.id) } : o)),
      };
    }
    let doc = JSON.parse(text);
    return {
      status: 200,
      columns: doc.columns,
      rows: doc.rows.map((r: unknown[]) => [strip(r[0]), ...r.slice(1)]),
      total: doc.meta?.page?.total,
    };
  }

  // A hidden row: a draft, in a section no published article is in, with far
  // more views than any other, so it would move every count, label and score
  // it reached.
  async function addHiddenRow() {
    await newsroom.write(
      'articles/hidden.json',
      article('Hidden', 'draft', 100_000, 'secret'),
    );
  }

  test('a hidden row changes nothing a facet, label or score shows', async function (assert) {
    let body = {
      filter: { 'item.on': Article, eq: { 'item.status': 'published' } },
      facets: [{ by: 'item.status', own: 'ignore' }, { by: 'item.section' }],
      sort: [
        {
          blend: [
            { by: 'item.views', 'item.on': Article, weight: 1 },
            { by: 'item.headline', 'item.on': Article, weight: 0.5 },
          ],
          k: 60,
        },
      ],
      rerank: { expression: 'views / stats.views.median', top: 10 },
      fields: { entry: ['item.headline'] },
    };
    let before = await search(body);
    assert.deepEqual(
      before.facets?.status,
      [{ value: 'published', count: 3 }],
      "own: 'ignore' drops the caller's status predicate, not the grant's",
    );
    await addHiddenRow();
    let after = await search(body);
    assert.deepEqual(
      after,
      before,
      'rows, scores, counts and labels are unchanged',
    );
  });

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
      labels((await search(body)).facets),
      { 'sections/world': [2, 'World'], 'sections/sport': [1, 'Sport'] },
      'the member, whom the Section grant admits, sees the section titles',
    );
    assert.deepEqual(
      labels((await search(body, OTHER)).facets),
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
    let owner = await search(body);
    assert.deepEqual(
      owner.rows.map(([id]) => id),
      ['articles/a', 'articles/c'],
      'the owner, whom the Picks grant admits, gets the articles it links',
    );
    let other = await search(body, OTHER);
    assert.deepEqual(
      other.rows.map(([id]) => id),
      [],
      "a caller the Picks grant does not admit reads none of the list's links",
    );
    await addHiddenRow();
    assert.deepEqual(
      await search(body),
      owner,
      'and a hidden row changes nothing',
    );
  });

  test("a caller's binding and linkedFrom each keep their meaning under the policy", async function (assert) {
    let body = {
      let: {
        __linkedFrom0: {
          from: {
            filter: {
              'item.on': Article,
              range: { 'item.views': { gte: 15 } },
            },
          },
          select: 'item.status',
        },
      },
      filter: {
        every: [
          {
            'item.on': Article,
            in: { 'item.status': { $let: '__linkedFrom0' } },
          },
          {
            // a's related articles: c, and the draft d the grant hides
            linkedFrom: {
              card: `${NEWSROOM}articles/a.json`,
              field: 'related',
            },
          },
        ],
      },
      fields: { entry: ['item.headline'] },
    };
    let before = await search(body);
    assert.deepEqual(
      before.rows.map(([id]) => id),
      ['articles/c'],
      "a's related articles the grant admits, among the statuses the caller's binding selected",
    );
    await addHiddenRow();
    assert.deepEqual(
      await search(body),
      before,
      'and a hidden row changes nothing',
    );
  });

  test('select answers a table of indexed values, under the grants', async function (assert) {
    let body = {
      filter: { 'item.on': Article },
      sort: [{ by: 'item.views', 'item.on': Article, direction: 'desc' }],
      select: ['headline', 'views', { section: 'section.name' }],
    };
    let member = await table(body);
    assert.deepEqual(
      member,
      {
        status: 200,
        columns: ['id', 'headline', 'views', 'section'],
        rows: [
          ['articles/b', 'B', 30, 'World'],
          ['articles/c', 'C', 20, 'Sport'],
          ['articles/a', 'A', 10, 'World'],
        ],
        total: 3,
      },
      'the published articles; the draft the grant hides is not a row',
    );
    let other = await table(body, OTHER);
    assert.deepEqual(
      other.rows,
      [
        ['articles/b', 'B', 30, null],
        ['articles/c', 'C', 20, null],
        ['articles/a', 'A', 10, null],
      ],
      "a caller the Section grant does not admit reads no section's name",
    );
    await addHiddenRow();
    assert.deepEqual(await table(body), member, 'a hidden row changes nothing');
  });

  test('a list column through links keeps only the linked cards the caller may read', async function (assert) {
    let { rows } = (await table({
      filter: { 'item.on': Article, eq: { 'item.headline': 'A' } },
      select: ['related.headline'],
    })) as { rows: unknown[][] };
    assert.deepEqual(
      rows,
      [['articles/a', ['C']]],
      "a's related articles are c and the draft d; only c's headline shows",
    );
    let owner = (await table(
      {
        filter: { 'item.on': Article, eq: { 'item.headline': 'A' } },
        select: ['related.headline'],
      },
      EDITOR,
    )) as { rows: unknown[][] };
    assert.deepEqual(
      owner.rows,
      [['articles/a', ['C', 'D']]],
      'the realm owner reads both',
    );
  });

  test('select answers as NDJSON or JSONL, one row a line', async function (assert) {
    let body = {
      filter: { 'item.on': Article },
      sort: [{ by: 'item.views', 'item.on': Article, direction: 'desc' }],
      select: ['headline', 'views'],
      page: { size: 2 },
    };
    for (let type of ['application/x-ndjson', 'application/jsonl']) {
      let answer = (await table(body, MEMBER, type)) as any;
      assert.strictEqual(answer.type, type, `answered as ${type}`);
      assert.deepEqual(answer.lines, [
        { id: 'articles/b', headline: 'B', views: 30 },
        { id: 'articles/c', headline: 'C', views: 20 },
        { meta: { page: { total: 3 } } },
      ]);
    }
  });

  test('a select path the index does not hold is refused, by code', async function (assert) {
    let codes: Record<string, unknown> = {};
    for (let [why, columns, extra] of [
      ['no such field', ['subtitle'], {}],
      ['a linked field the link does not carry', ['section.audience'], {}],
      ['beside fields', ['headline'], { fields: { entry: ['item.headline'] } }],
      ['named id', [{ id: 'headline' }], {}],
    ] as const) {
      let answer = (await table({
        filter: { 'item.on': Article },
        select: columns,
        ...extra,
      })) as any;
      codes[why] = [answer.status, answer.error?.code];
    }
    assert.deepEqual(codes, {
      'no such field': [400, 'unknown-field'],
      'a linked field the link does not carry': [400, 'not-selectable'],
      'beside fields': [400, 'select-excludes-fields'],
      'named id': [400, 'conflicting-members'],
    });
  });
});
