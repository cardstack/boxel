import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  hasWarning,
  rri,
  searchEntryWireQueryFromQuery,
  SupportedMimeType,
  type Query,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
  type RealmPermissions,
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
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// `_federated-search` over realms on this server, end to end: a merged
// search runs as one statement over every realm (the union path), so it
// answers what one realm holding all their cards answers; over one realm it
// answers what that realm's `_search` answers; a realm the caller reads only
// through its policy contributes the rows its grants admit and nothing
// else; and a search the union cannot run is merged, as it was before.
//
// The use case: a read-only Hacker News video corpus, the caller's own
// videos, blended into one feed and collapsed by video.

const SERVER = 'http://127.0.0.1:4444/';
const HN = `${SERVER}hn/`;
const MINE = `${SERVER}mine/`;
// One realm holding both realms' cards, each under a folder named for its
// realm (`all/hn/h1` for `hn/h1`), so ties break by URL alike.
const ALL = `${SERVER}all/`;
// Read by the caller only through its policy: its public videos.
const SHARED = `${SERVER}shared/`;
const ORG = `${SERVER}org/`;
const POLICY = `${ORG}policies/shared`;

const OWNER = '@owner:localhost';
const USER = '@user:localhost';

const Video = { module: `${HN}video`, name: 'Video' };
const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const VIDEO_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import VectorField from "@cardstack/base/vector";
  export class Taste extends VectorField {
    static dimensions = 3;
  }
  export class Video extends CardDef {
    static searchDefaults = { rank: { popularity: 'hnScore', recency: 'published' } };
    @field title = contains(StringField, { search: { role: 'title' } });
    @field youtubeId = contains(StringField);
    @field source = contains(StringField);
    @field visibility = contains(StringField);
    @field channel = contains(StringField, { search: { role: 'label', facet: true } });
    @field hnScore = contains(NumberField, { search: { rank: 'popularity' } });
    @field published = contains(NumberField, { search: { rank: 'recency' } });
    @field taste = contains(Taste);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Video) {
        return this.title;
      },
    });
  }
`;

type V = {
  title: string;
  youtubeId: string;
  channel: string;
  hnScore: number;
  published: number;
  taste: number[];
  visibility?: string;
};

const hnVideos: Record<string, V> = {
  h1: {
    title: 'Rust ownership explained',
    youtubeId: 'y1',
    channel: 'talks',
    hnScore: 400,
    published: 100,
    taste: [1, 0, 0],
  },
  h2: {
    title: 'Async Rust in practice',
    youtubeId: 'y2',
    channel: 'talks',
    hnScore: 300,
    published: 200,
    taste: [0.9, 0.1, 0],
  },
  h3: {
    title: 'Postgres internals',
    youtubeId: 'y3',
    channel: 'db',
    hnScore: 500,
    published: 300,
    taste: [0, 1, 0],
  },
  h4: {
    title: 'Rust and Postgres together',
    youtubeId: 'y4',
    channel: 'db',
    hnScore: 100,
    published: 400,
    taste: [0.5, 0.5, 0],
  },
};
const myVideos: Record<string, V> = {
  // the same video as h1
  m1: {
    title: 'My Rust notes',
    youtubeId: 'y1',
    channel: 'notes',
    hnScore: 0,
    published: 600,
    taste: [1, 0.1, 0],
  },
  m2: {
    title: 'Rust borrow checker',
    youtubeId: 'y6',
    channel: 'talks',
    hnScore: 10,
    published: 700,
    taste: [0.8, 0.2, 0],
  },
};
const sharedVideos: Record<string, V> = {
  s1: {
    title: 'Rust at work',
    youtubeId: 'y8',
    channel: 'talks',
    hnScore: 20,
    published: 650,
    taste: [0.7, 0.3, 0],
    visibility: 'public',
  },
  s2: {
    title: 'Rust secrets',
    youtubeId: 'y9',
    channel: 'secret',
    hnScore: 900,
    published: 900,
    taste: [1, 0, 0],
    visibility: 'private',
  },
};

function video(source: string, v: V, moduleFromCard: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { ...v, source },
      meta: { adoptsFrom: { module: moduleFromCard, name: 'Video' } },
    },
  });
}

function files(
  videos: Record<string, V>,
  source: string,
  folder = '',
): Record<string, string> {
  let up = folder ? '../../hn/video' : '../hn/video';
  return Object.fromEntries(
    Object.entries(videos).map(([id, v]) => [
      `${folder}${id}.json`,
      video(source, v, up),
    ]),
  );
}

function policyCard() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          {
            targetType: Video,
            grants: [{ operation: 'query', where: '.visibility == "public"' }],
          },
        ],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

// The feed: videos about rust, blended by relevance, nearness to the
// caller's taste, recency and a boost for their own, one per video.
function feed(page: number, size = 2): Query {
  return {
    type: Video,
    filter: { matches: 'rust' },
    sort: [
      {
        blend: [
          { by: 'textRelevance' },
          { by: 'taste', near: [1, 0, 0] },
          { by: 'published' },
          { boost: { eq: { source: 'mine' } }, weight: 2 },
        ],
        k: 60,
      },
    ],
    collapse: 'youtubeId',
    facets: [{ by: 'channel' }],
    page: { size, number: page },
  } as unknown as Query;
}

module(basename(import.meta.filename), function (hooks) {
  let realms: Record<string, Realm> = {};
  let request: SuperTest<Test>;
  let server: Server;

  setupCatalogTestSubset(hooks);

  async function start(args: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let owner = { [OWNER]: ['read', 'write', 'realm-owner'] };
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(HN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'HN' }),
            'video.gts': VIDEO_MODULE,
            ...files(hnVideos, 'hn'),
          },
          permissions: { ...owner, [USER]: ['read'] } as RealmPermissions,
        },
        {
          realmURL: new URL(MINE),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Mine' }),
            ...files(myVideos, 'mine'),
          },
          permissions: {
            ...owner,
            [USER]: ['read', 'write'],
          } as RealmPermissions,
        },
        {
          realmURL: new URL(ALL),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'All' }),
            ...files(hnVideos, 'hn', 'hn/'),
            ...files(myVideos, 'mine', 'mine/'),
          },
          permissions: { ...owner, [USER]: ['read'] } as RealmPermissions,
        },
        {
          realmURL: new URL(SHARED),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Shared',
              policy: POLICY,
            }),
            ...files(sharedVideos, 'shared'),
          },
          permissions: owner as RealmPermissions,
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/shared.json': policyCard(),
          },
          permissions: owner as RealmPermissions,
        },
      ],
      dbAdapter: args.dbAdapter,
      publisher: args.publisher,
      runner: args.runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    realms = Object.fromEntries(result.realms.map((r) => [r.url, r]));
  }

  async function stop() {
    for (let realm of Object.values(realms)) {
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
    beforeEach: async (adapter, publisher, runner) => {
      await start({ dbAdapter: adapter, publisher, runner });
    },
    afterEach: async () => {
      await stop();
    },
  });

  // What a caller reads of an answer: its rows with their scores, the
  // counts and the facets. A card of one realm reads as `<realm>/<id>`, and
  // one of the realm holding both as the same.
  function reduce(body: any) {
    let label = (id: string) => id.replace(ALL, '').replace(SERVER, '');
    return {
      rows: body.data.map((e: any) => label(e.id)),
      scores: body.data.map((e: any) =>
        e.meta?._blendScore == null ? null : Number(e.meta._blendScore),
      ),
      collapse: body.data.map((e: any) => e.meta?._collapseSize ?? null),
      total: body.meta.page?.total,
      hasMore: body.meta.page?.hasMore,
      facets: body.meta.facets,
    };
  }

  async function federated(
    query: Query,
    realmList: string[],
    results: 'merged' | 'byRealm',
    caller = USER,
  ) {
    let response = await request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: caller, sessionRoom: `session-room-${caller}` },
          realmSecretSeed,
        )}`,
      )
      .send({
        ...searchEntryWireQueryFromQuery(query),
        realms: realmList,
        federation: { results },
      });
    if (response.status !== 200) {
      throw new Error(
        `federated answered ${response.status}: ${response.text}`,
      );
    }
    return response.body;
  }

  async function own(query: Query, realm: string, caller = USER) {
    let response = await request
      .post(`${new URL(realm).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createJWT(realms[realm], caller, ['read'])}`,
      )
      .send(searchEntryWireQueryFromQuery(query));
    if (response.status !== 200) {
      throw new Error(`_search answered ${response.status}: ${response.text}`);
    }
    return response.body;
  }

  function assertSame(
    assert: Assert,
    got: ReturnType<typeof reduce>,
    want: ReturnType<typeof reduce>,
    what: string,
  ) {
    assert.deepEqual(got.rows, want.rows, `${what}: rows and order`);
    assert.strictEqual(got.total, want.total, `${what}: total`);
    assert.strictEqual(got.hasMore, want.hasMore, `${what}: hasMore`);
    assert.deepEqual(got.facets, want.facets, `${what}: facets`);
    assert.deepEqual(got.collapse, want.collapse, `${what}: collapse sizes`);
    got.scores.forEach((s: number | null, i: number) => {
      let w = want.scores[i];
      assert.true(
        (s === null && w === null) ||
          (s !== null && w !== null && Math.abs(s - w) <= 1e-9),
        `${what}: row ${i} scores ${s}, expected ${w}`,
      );
    });
  }

  test('over one realm, a federated search answers what that realm’s _search answers', async function (assert) {
    for (let page of [0, 1]) {
      let mine = reduce(await own(feed(page), HN));
      for (let results of ['merged', 'byRealm'] as const) {
        let doc = await federated(feed(page), [HN], results);
        assertSame(assert, reduce(doc), mine, `${results}, page ${page}`);
        assert.strictEqual(doc.meta.realms[HN].status, 'ok');
        assert.strictEqual(doc.meta.realms[HN].total, mine.total);
        assert.false(hasWarning(doc.meta, 'approximate-order'));
      }
    }
    let merged = await federated(feed(0), [HN], 'merged');
    assert.deepEqual(merged.meta.federation, {
      results: 'merged',
      path: 'union',
    });
  });

  test('over two realms, a merged search answers what one realm holding both answers', async function (assert) {
    for (let page of [0, 1, 2]) {
      let doc = await federated(feed(page), [HN, MINE], 'merged');
      let one = reduce(await own(feed(page), ALL));
      assertSame(assert, reduce(doc), one, `page ${page}`);
      assert.deepEqual(doc.meta.federation, {
        results: 'merged',
        path: 'union',
      });
      assert.false(hasWarning(doc.meta, 'approximate-order'), 'exact order');
      assert.strictEqual(
        doc.meta.realms[HN].total + doc.meta.realms[MINE].total,
        doc.meta.page.total,
        'the realms’ totals sum to the total',
      );
    }
    let all = reduce(await federated(feed(0, 10), [HN, MINE], 'merged'));
    assert.strictEqual(all.total, 4, 'five rust videos, two of one video');
    assert.true(
      all.scores.every((s: number | null) => s !== null && s > 0),
      'every row carries its blend score',
    );
    assert.true(all.rows.includes('mine/m1'), 'the boosted copy of y1 is kept');
    assert.false(all.rows.includes('hn/h1'), 'the other copy is collapsed');
  });

  test('a realm read through its policy adds only what its grants admit', async function (assert) {
    let before = await federated(feed(0, 10), [HN, SHARED], 'merged');
    let rows = reduce(before).rows;
    assert.true(rows.includes('shared/s1'), 'the public video');
    assert.false(rows.includes('shared/s2'), 'not the private one');
    assert.deepEqual(before.meta.federation.path, 'union');
    assert.deepEqual(before.meta.policyScopedRealms, [SHARED]);
    assert.strictEqual(before.meta.realms[SHARED].total, 1);
    // A private video that would move every count, rank and facet.
    await realms[SHARED].write(
      's3.json',
      video(
        'shared',
        {
          title: 'Rust rust rust',
          youtubeId: 'y2',
          channel: 'secret',
          hnScore: 10_000,
          published: 10_000,
          taste: [1, 0, 0],
          visibility: 'private',
        },
        '../hn/video',
      ),
    );
    let after = await federated(feed(0, 10), [HN, SHARED], 'merged');
    assertSame(assert, reduce(after), reduce(before), 'with a hidden row');
    assert.deepEqual(after.meta.realms[SHARED].total, 1);
  });

  test('a search the union cannot run is merged', async function (assert) {
    // As if MINE read another database.
    let mine = realms[MINE];
    let original = mine.sharesIndexWith;
    mine.sharesIndexWith = () => false;
    let hn = realms[HN];
    let hnOriginal = hn.sharesIndexWith;
    hn.sharesIndexWith = () => false;
    try {
      let doc = await federated(feed(0), [HN, MINE], 'merged');
      assert.deepEqual(doc.meta.federation, {
        results: 'merged',
        path: 'merge',
      });
      assert.true(
        hasWarning(doc.meta, 'approximate-order'),
        'scores order approximately',
      );
      assert.strictEqual(doc.meta.realms[HN].status, 'ok');
      assert.strictEqual(doc.meta.realms[MINE].status, 'ok');
    } finally {
      mine.sharesIndexWith = original;
      hn.sharesIndexWith = hnOriginal;
    }
    // Per realm keeps its sections, each realm searched on its own.
    let byRealm = await federated(feed(0), [HN, MINE], 'byRealm');
    assert.deepEqual(byRealm.meta.federation, { results: 'byRealm' });
    assert.strictEqual(byRealm.meta.sections.length, 2);
  });
});
