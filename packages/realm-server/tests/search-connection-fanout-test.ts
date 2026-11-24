import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  insertPermissions,
  notifyRealmIndexUpdated,
  SupportedMimeType,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
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
import { RealmIndexUpdatedListener } from '../lib/realm-index-updated-listener.ts';
import {
  ConnectionFanoutRecorder,
  untilPoolQuiet,
  type FanoutSummary,
  type RecorderOptions,
} from './helpers/connection-fanout.ts';

// A measurement, not a gate (yet): how many database connections one `_search`
// checks out, how long it holds each, and where each comes from, for the
// search shapes a video app sends on a page load. Each shape runs alone,
// then the shapes run together, then 19 at once (what one of its page loads
// fired), against a pool sized like production and against a scaled-down
// pool. Every number is printed as a `FANOUT` line for the run's log.
//
// The shapes are that app's own request bodies, on a small
// corpus of the same three types: a let (one card, or a list), a filter of
// three parts, and a sort that is a blend, a near, a plain field or none.

const SERVER = 'http://127.0.0.1:4444/';
const APP = `${SERVER}video-app/`;
const OWNER = '@owner:localhost';
const USER = '@user:localhost';

const Concept = { module: `${APP}concept`, name: 'Concept' };
const Moment = { module: `${APP}moment`, name: 'Moment' };
const VideoMoment = { module: `${APP}video-moment`, name: 'VideoMoment' };

const CONCEPT_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import VectorField from "@cardstack/base/vector";
  export class ConceptEmbedding extends VectorField {
    static dimensions = 3;
  }
  export class Concept extends CardDef {
    @field slug = contains(StringField);
    @field name = contains(StringField, { search: { role: 'title' } });
    @field area = contains(StringField, { search: { facet: true } });
    @field domainName = contains(StringField, { search: { facet: true } });
    @field videoCount = contains(NumberField);
    @field clipCount = contains(NumberField);
    @field bestVid = contains(StringField);
    @field bestStart = contains(NumberField);
    @field bestEnd = contains(NumberField);
    @field bestQuote = contains(StringField);
    @field bestScore = contains(NumberField);
    @field embedding = contains(ConceptEmbedding);
  }
`;

const MOMENT_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import BooleanField from "@cardstack/base/boolean";
  import VectorField from "@cardstack/base/vector";
  export class ClipEmbedding extends VectorField {
    static dimensions = 3;
  }
  export class Moment extends CardDef {
    static searchDefaults = {
      title: 'videoTitle',
      rank: { popularity: 'hnScore', recency: 'lastDiscussed' },
    };
    @field vid = contains(StringField, { search: { role: 'identifier' } });
    @field videoTitle = contains(StringField);
    @field channel = contains(StringField, { search: { role: 'label', facet: true } });
    @field start = contains(NumberField);
    @field end = contains(NumberField);
    @field quote = contains(StringField, { search: { role: 'summary' } });
    @field text = contains(StringField, { search: { role: 'body' } });
    @field concepts = containsMany(StringField, { search: { role: 'keywords', facet: true } });
    @field area = contains(StringField, { search: { role: 'label', facet: true } });
    @field category = contains(StringField);
    @field talkDuration = contains(NumberField);
    @field isDuplicate = contains(BooleanField);
    @field hnScore = contains(NumberField, { search: { rank: 'popularity' } });
    @field lastDiscussed = contains(NumberField, { search: { rank: 'recency' } });
    @field embedding = contains(ClipEmbedding);
  }
`;

const VIDEO_MOMENT_MODULE = `
  import { containsMany, contains, field } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import { Moment } from "./moment";
  export class VideoMoment extends Moment {
    static searchDefaults = {
      title: 'videoTitle',
      rank: { popularity: 'hnScore', recency: 'lastDiscussed' },
    };
    @field teaches = containsMany(StringField, { search: { role: 'keywords' } });
    @field prerequisites = containsMany(StringField);
    @field bestStart = contains(NumberField);
    @field speakers = containsMany(StringField, { search: { role: 'name' } });
    @field relatedVids = containsMany(StringField);
  }
`;

const SLUGS = [
  'ownership',
  'borrowing',
  'async',
  'indexes',
  'vacuum',
  'replication',
  'consensus',
  'caching',
  'queues',
  'types',
  'testing',
  'tracing',
];
const WORDS = ['rust', 'postgres', 'async', 'index', 'cache'];
const TOPICS = [
  'rust ownership and borrowing',
  'postgres indexes and vacuum',
  'async rust runtimes',
  'replication and consensus',
  'caching and queues',
  'types and testing',
  'tracing in production',
  'rust and postgres together',
];

// a deterministic unit vector for the i-th thing
function vector(i: number): number[] {
  let a = (i * 0.7) % (2 * Math.PI);
  let b = (i * 0.3) % 1;
  let v = [Math.cos(a), Math.sin(a), b];
  let n = Math.hypot(...v);
  return v.map((x) => Math.round((x / n) * 1e4) / 1e4);
}

function card(module: string, name: string, attributes: object) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module, name } },
    },
  });
}

function corpus(): Record<string, string> {
  let files: Record<string, string> = {};
  SLUGS.forEach((slug, i) => {
    files[`Concept/${slug}.json`] = card('../concept', 'Concept', {
      slug,
      name: slug[0].toUpperCase() + slug.slice(1),
      area: i % 2 ? 'systems' : 'languages',
      domainName: 'software',
      videoCount: 20 - i,
      clipCount: 40 - i,
      // two concepts have no best talk, so the home filter drops something
      bestVid: i < 10 ? `v${(i % 8) + 1}` : null,
      bestStart: 10 * i,
      bestEnd: 10 * i + 30,
      bestQuote: `the best of ${slug}`,
      bestScore: 1 - i / 20,
      embedding: vector(i),
    });
  });
  TOPICS.forEach((topic, t) => {
    let vid = `v${t + 1}`;
    let shared = {
      vid,
      videoTitle: topic,
      channel: t % 2 ? 'talks' : 'db',
      area: t % 2 ? 'systems' : 'languages',
      category: 'talk',
      talkDuration: 1800 + 60 * t,
      hnScore: 100 * (8 - t),
      lastDiscussed: 1000 + t,
    };
    files[`VideoMoment/${vid}.json`] = card('../video-moment', 'VideoMoment', {
      ...shared,
      start: 0,
      end: 1800,
      quote: topic,
      text: `a whole talk on ${topic}`,
      concepts: [SLUGS[t], SLUGS[(t + 3) % SLUGS.length]],
      isDuplicate: t === 7,
      teaches: [SLUGS[t]],
      prerequisites: [],
      bestStart: 60,
      speakers: [`speaker ${t}`],
      relatedVids: [`v${((t + 1) % 8) + 1}`],
      embedding: vector(100 + t),
    });
    for (let c = 0; c < 4; c++) {
      files[`Moment/${vid}-${c}.json`] = card('../moment', 'Moment', {
        ...shared,
        start: 300 * c,
        end: 300 * c + 90,
        quote: `${topic}, part ${c}`,
        text: `on ${topic}: ${WORDS[(t + c) % WORDS.length]} in depth, part ${c}`,
        concepts: [SLUGS[(t + c) % SLUGS.length]],
        isDuplicate: false,
        embedding: vector(200 + 4 * t + c),
      });
    }
  });
  return files;
}

const CONCEPT_FIELDS = [
  'item.slug',
  'item.name',
  'item.area',
  'item.domainName',
  'item.videoCount',
  'item.clipCount',
];
const TALK_FIELDS = [
  'item.vid',
  'item.videoTitle',
  'item.channel',
  'item.talkDuration',
  'item.end',
  'item.area',
  'item.category',
  'item.concepts',
  'item.hnScore',
  'item.bestStart',
  'item.teaches',
  'item.prerequisites',
  'item.relatedVids',
  'item.speakers',
];
const BEST = [
  'item.bestVid',
  'item.bestStart',
  'item.bestEnd',
  'item.bestQuote',
  'item.bestScore',
];
const NOT_DUPLICATE = { not: { eq: { isDuplicate: true } } };
const HOME_SIZE = 20;

// The app's request bodies, the i-th variant of each, so
// concurrent searches are distinct requests as a page load's are.
const SHAPES: Record<string, (i: number) => Record<string, unknown>> = {
  // similarConcepts: a one-card let, a three-part filter, a near on the let
  similarConcepts: (i) => {
    let slug = SLUGS[i % SLUGS.length];
    return {
      let: {
        $me: {
          from: { filter: { 'item.on': Concept, eq: { 'item.slug': slug } } },
          one: true,
        },
      },
      filter: {
        every: [
          { 'item.on': Concept },
          { not: { 'item.on': Concept, eq: { 'item.slug': slug } } },
        ],
      },
      sort: [
        { 'item.on': Concept, by: 'item.embedding', near: '$me.embedding' },
      ],
      fields: { entry: CONCEPT_FIELDS },
      page: { size: 12 },
    };
  },
  // wordSearch's clips: a list let over talks, a three-part filter, a blend
  wordSearchClips: (i) => {
    let query = WORDS[i % WORDS.length];
    return {
      let: {
        $talks: {
          from: {
            filter: { 'item.on': VideoMoment, matches: query },
            sort: [{ by: 'item.textRelevance' }],
            page: { size: 10 },
          },
          select: 'item.vid',
        },
      },
      filter: {
        every: [
          { 'item.on': Moment },
          { not: { 'item.on': VideoMoment } },
          { 'item.on': Moment, in: { 'item.vid': '$talks' } },
        ],
      },
      sort: [
        {
          blend: [
            { boost: { 'item.on': Moment, matches: query }, weight: 2 },
            { 'item.on': Moment, by: 'item.hnScore' },
          ],
        },
      ],
      collapse: { by: 'item.vid', 'item.on': Moment },
      fields: {
        entry: [
          'item.vid',
          'item.start',
          'item.end',
          'item.text',
          'item.quote',
          'item.concepts',
        ],
      },
      page: { size: 10 },
    };
  },
  // nearTalks (searchTalks): one type, a near on its embedding
  nearTalks: (i) => ({
    type: VideoMoment,
    filter: { every: [NOT_DUPLICATE] },
    sort: [{ 'item.on': VideoMoment, by: 'item.embedding', near: vector(i) }],
    fields: { entry: TALK_FIELDS },
    page: { size: 14 },
  }),
  // the stored-model search's clips: a near let over talks, then a near
  storedSearchClips: (i) => ({
    let: {
      $talks: {
        from: {
          filter: { 'item.on': VideoMoment },
          sort: [
            { 'item.on': VideoMoment, by: 'item.embedding', near: vector(i) },
          ],
          page: { size: 14 },
        },
        select: 'item.vid',
      },
    },
    filter: {
      every: [
        { 'item.on': Moment },
        { not: { 'item.on': VideoMoment } },
        { 'item.on': Moment, in: { 'item.vid': '$talks' } },
      ],
    },
    sort: [{ 'item.on': Moment, by: 'item.embedding', near: vector(i + 1) }],
    collapse: { by: 'item.vid', 'item.on': Moment, keep: 2 },
    fields: {
      entry: [
        'item.vid',
        'item.start',
        'item.end',
        'item.text',
        'item.quote',
        'item.concepts',
      ],
    },
    page: { size: 40 },
  }),
  // loadHome's concepts: a plain field sort, no let
  homeConcepts: (i) => ({
    filter: {
      every: [
        { 'item.on': Concept },
        { not: { 'item.on': Concept, eq: { 'item.bestVid': null } } },
      ],
    },
    sort: [
      {
        'item.on': Concept,
        by: 'item.videoCount',
        direction: i % 2 ? 'asc' : 'desc',
      },
    ],
    fields: { entry: [...CONCEPT_FIELDS, ...BEST] },
    page: { size: HOME_SIZE - (i % 3) },
  }),
  // loadHome's talks: a list let sorted by a field, a filter, no sort
  homeTalks: (i) => ({
    let: {
      $best: {
        from: {
          filter: {
            every: [
              { 'item.on': Concept },
              { not: { 'item.on': Concept, eq: { 'item.bestVid': null } } },
            ],
          },
          sort: [
            { 'item.on': Concept, by: 'item.videoCount', direction: 'desc' },
          ],
          page: { size: HOME_SIZE - (i % 3) },
        },
        select: 'item.bestVid',
      },
    },
    filter: {
      every: [
        { 'item.on': VideoMoment, in: { 'item.vid': '$best' } },
        { not: { 'item.on': VideoMoment, eq: { 'item.isDuplicate': true } } },
      ],
    },
    fields: { entry: TALK_FIELDS },
    page: { size: HOME_SIZE },
  }),
};
const SHAPE_NAMES = Object.keys(SHAPES);

// Checkouts that belong to the test's own machinery rather than to a search.
const BACKGROUND = /queue \/ background/;

function report(label: string, value: unknown) {
  console.log(`FANOUT ${label} ${JSON.stringify(value)}`);
}

function brief(s: FanoutSummary) {
  return {
    checkouts: s.checkouts,
    peakInUse: s.peakInUse,
    peakHolds: s.peakHolds,
    peakWaiting: s.peakWaiting,
    oldestWaitMs: s.oldestWaitMs,
    snapshotRestarts: s.snapshotRestarts,
  };
}

function setupFanoutRealm(hooks: NestedHooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let adapter: PgAdapter;

  async function start(args: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(APP),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Video app' }),
            'concept.gts': CONCEPT_MODULE,
            'moment.gts': MOMENT_MODULE,
            'video-moment.gts': VIDEO_MOMENT_MODULE,
            ...corpus(),
          },
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
            [USER]: ['read'],
          } as RealmPermissions,
        },
      ],
      dbAdapter: args.dbAdapter,
      publisher: args.publisher,
      runner: args.runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    realm = result.realms[0];
    adapter = args.dbAdapter;
  }

  async function stop() {
    realm.__testOnlyClearCaches();
    realm.unsubscribe();
    await closeServer(server);
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

  async function search(body: Record<string, unknown>) {
    let started = performance.now();
    let response = await request
      .post(`${new URL(APP).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', `Bearer ${createJWT(realm, USER, ['read'])}`)
      .send(body);
    return {
      status: response.status,
      rows: response.body?.data?.length ?? 0,
      ms: Math.round(performance.now() - started),
      error: response.status === 200 ? undefined : response.text.slice(0, 400),
    };
  }

  async function patchPermissions(permissions: RealmPermissions) {
    return await request
      .patch(`${new URL(APP).pathname}_permissions`)
      .set('Accept', 'application/vnd.api+json')
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, OWNER, ['read', 'write', 'realm-owner'])}`,
      )
      .send({
        data: {
          id: APP,
          type: 'permissions',
          attributes: { permissions },
        },
      });
  }

  return {
    get adapter() {
      return adapter;
    },
    get realm() {
      return realm;
    },
    search,
    patchPermissions,
  };
}

// Runs `bodies` at once and reports peaks, totals and each search's wall time.
async function concurrently(
  assert: Assert,
  label: string,
  adapter: PgAdapter,
  search: ReturnType<typeof setupFanoutRealm>['search'],
  bodies: { shape: string; body: Record<string, unknown> }[],
  recorderOptions?: RecorderOptions,
) {
  await untilPoolQuiet(adapter);
  let recorder = new ConnectionFanoutRecorder(adapter, recorderOptions);
  try {
    recorder.start();
    let started = performance.now();
    let results = await Promise.all(
      bodies.map(async ({ shape, body }) => ({
        shape,
        ...(await search(body)),
      })),
    );
    let wallMs = Math.round(performance.now() - started);
    recorder.stop();
    let summary = recorder.summary({ exclude: BACKGROUND });
    let walls = results.map((r) => r.ms).sort((a, b) => a - b);
    report(`${label} concurrent`, {
      searches: bodies.length,
      limit: adapter.connectionStats.limit,
      wallMs,
      perSearchMs: {
        min: walls[0],
        median: walls[Math.floor(walls.length / 2)],
        max: walls[walls.length - 1],
      },
      checkoutsPerSearch:
        Math.round((summary.checkouts / bodies.length) * 10) / 10,
      ...brief(summary),
      bySource: summary.bySource,
    });
    for (let r of results) {
      assert.strictEqual(
        r.status,
        200,
        `${label} ${r.shape}: ${r.error ?? ''}`,
      );
    }
  } finally {
    recorder.dispose();
  }
}

function mixed(n: number) {
  return Array.from({ length: n }, (_, i) => {
    let shape = SHAPE_NAMES[i % SHAPE_NAMES.length];
    return { shape, body: SHAPES[shape](i) };
  });
}

// Each shape alone, measured cold (its first run) and warm (a second,
// distinct variant): the first search of a realm reads its definitions.
async function eachShapeAlone(
  assert: Assert,
  realm: ReturnType<typeof setupFanoutRealm>,
  prefix: string,
  recorderOptions?: RecorderOptions,
) {
  assert.timeout(120_000);
  let { adapter, search } = realm;
  report(`${prefix}pool`, adapter.connectionStats);
  for (let phase of ['cold', 'warm'] as const) {
    for (let [n, shape] of SHAPE_NAMES.entries()) {
      await untilPoolQuiet(adapter);
      let recorder = new ConnectionFanoutRecorder(adapter, recorderOptions);
      try {
        recorder.start();
        let result = await search(SHAPES[shape](phase === 'cold' ? n : n + 1));
        recorder.stop();
        let summary = recorder.summary({ exclude: BACKGROUND });
        report(`${prefix}${phase} ${shape}`, {
          status: result.status,
          rows: result.rows,
          wallMs: result.ms,
          ...brief(summary),
          bySource: summary.bySource,
          snapshotStatements: summary.snapshotStatements,
          holds: summary.holds,
        });
        if (phase === 'cold' && !prefix) {
          report(`${phase} ${shape} examples`, summary.examples);
        }
        assert.strictEqual(
          result.status,
          200,
          `${shape}: ${result.error ?? ''}`,
        );
        assert.true(result.rows > 0, `${shape} returns rows`);
      } finally {
        recorder.dispose();
      }
    }
  }
}

// Sizes the pool the realm server under test builds, for one module.
function withPool(hooks: NestedHooks, max: string, overflow: string) {
  let saved: Record<string, string | undefined> = {};
  hooks.before(function () {
    for (let [k, v] of Object.entries({
      PG_POOL_MAX: max,
      PG_POOL_OVERFLOW: overflow,
    })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  hooks.after(function () {
    for (let [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// What a production round trip adds to each statement; see
// `RecorderOptions.statementDelayMs`.
const DELAYED: RecorderOptions = { statementDelayMs: 20 };

module(basename(import.meta.filename), function () {
  module('a pool sized like production (40)', function (hooks) {
    let realm = setupFanoutRealm(hooks);

    test('each shape alone: checkouts, holds and their sources', async function (assert) {
      await eachShapeAlone(assert, realm, '');
    });

    test('the shapes together, then 19 at once', async function (assert) {
      assert.timeout(120_000);
      let { adapter, search } = realm;
      // warm the definitions first, as a running realm's are
      for (let shape of SHAPE_NAMES) await search(SHAPES[shape](0));
      await concurrently(
        assert,
        'pool40 shapes',
        adapter,
        search,
        mixed(SHAPE_NAMES.length),
      );
      await concurrently(assert, 'pool40 x19', adapter, search, mixed(19));
      await concurrently(assert, 'pool40 x76', adapter, search, mixed(76));
    });
  });

  module('a scaled-down pool (8, overflow 2)', function (hooks) {
    withPool(hooks, '8', '2');
    let realm = setupFanoutRealm(hooks);

    test('19 at once, and the proportional 4', async function (assert) {
      assert.timeout(120_000);
      let { adapter, search } = realm;
      report('pool', adapter.connectionStats);
      for (let shape of SHAPE_NAMES) await search(SHAPES[shape](0));
      await concurrently(assert, 'pool8 x4', adapter, search, mixed(4));
      await concurrently(assert, 'pool8 x19', adapter, search, mixed(19));
    });
  });

  module(
    'a pool sized like production (40), 20 ms per statement',
    function (hooks) {
      let realm = setupFanoutRealm(hooks);

      test('each shape alone', async function (assert) {
        await eachShapeAlone(assert, realm, 'delay20 ', DELAYED);
      });

      test('19 at once', async function (assert) {
        assert.timeout(180_000);
        let { adapter, search } = realm;
        for (let shape of SHAPE_NAMES) await search(SHAPES[shape](0));
        await concurrently(
          assert,
          'delay20 pool40 x19',
          adapter,
          search,
          mixed(19),
          DELAYED,
        );
      });
    },
  );

  module(
    'a scaled-down pool (8, overflow 2), 20 ms per statement',
    function (hooks) {
      withPool(hooks, '8', '2');
      let realm = setupFanoutRealm(hooks);

      test('19 at once', async function (assert) {
        assert.timeout(180_000);
        let { adapter, search } = realm;
        report('delay20 pool', adapter.connectionStats);
        for (let shape of SHAPE_NAMES) await search(SHAPES[shape](0));
        await concurrently(
          assert,
          'delay20 pool8 x19',
          adapter,
          search,
          mixed(19),
          DELAYED,
        );
      });
    },
  );

  // A warm search checks out its request's own connections and its read
  // snapshot, and reads neither a definitions row nor the realm's permissions
  // for a definition lookup; and whatever changes either is seen by the very
  // next search.
  module('warm definition and permissions reads', function (hooks) {
    let realm = setupFanoutRealm(hooks);

    // One search, recorded: its definition lookups' checkouts, and their
    // statements inside its read snapshot.
    async function lookupReads(body: Record<string, unknown>) {
      let { adapter, search } = realm;
      await untilPoolQuiet(adapter);
      let recorder = new ConnectionFanoutRecorder(adapter);
      try {
        recorder.start();
        let result = await search(body);
        recorder.stop();
        let summary = recorder.summary({ exclude: BACKGROUND });
        let count = (pattern: RegExp) =>
          Object.entries(summary.bySource)
            .filter(([source]) => pattern.test(source))
            .reduce((n, [, entry]) => n + entry.checkouts, 0);
        let inSnapshot = Object.entries(summary.snapshotStatements)
          .filter(([source]) => /^definition lookup/.test(source))
          .reduce((n, [, entry]) => n + entry.statements, 0);
        return {
          result,
          checkouts: summary.checkouts,
          definitionReads: count(/^definition lookup: definition read/),
          permissionsReads: count(/^definition lookup: permissions read/),
          inSnapshot,
        };
      } finally {
        recorder.dispose();
      }
    }

    async function publicRows(): Promise<number> {
      let rows = (await realm.adapter.execute(
        `SELECT count(*)::int AS n FROM modules WHERE resolved_realm_url = $1 AND cache_scope = 'public'`,
        { bind: [APP] },
      )) as { n: number }[];
      return rows[0].n;
    }

    test('a warm search reads no definitions row and no permissions', async function (assert) {
      assert.timeout(120_000);
      for (let shape of SHAPE_NAMES) await realm.search(SHAPES[shape](0));
      for (let shape of SHAPE_NAMES) {
        let reads = await lookupReads(SHAPES[shape](1));
        report(`warm-reads ${shape}`, reads);
        assert.strictEqual(reads.result.status, 200, shape);
        assert.strictEqual(reads.definitionReads, 0, `${shape}: rows`);
        assert.strictEqual(reads.permissionsReads, 0, `${shape}: permissions`);
        assert.strictEqual(reads.inSnapshot, 0, `${shape}: in its snapshot`);
      }
    });

    test('a permissions change through the endpoint is seen by the next search', async function (assert) {
      assert.timeout(120_000);
      await realm.search(SHAPES.homeConcepts(0));
      assert.notStrictEqual(
        (await realm.realm.ownerAndVisibility()).visibility,
        'public',
        'baseline: the realm is not public',
      );
      assert.strictEqual(await publicRows(), 0, 'baseline: no public rows');

      let response = await realm.patchPermissions({ '*': ['read'] });
      assert.strictEqual(response.status, 200, response.text);

      let reads = await lookupReads(SHAPES.homeConcepts(1));
      assert.strictEqual(reads.result.status, 200, reads.result.error);
      assert.true(
        reads.permissionsReads > 0,
        'the next search read the permissions again',
      );
      assert.strictEqual(
        (await realm.realm.ownerAndVisibility()).visibility,
        'public',
      );
      assert.true(
        (await publicRows()) > 0,
        'its definitions were looked up under the public scope',
      );
      let again = await lookupReads(SHAPES.homeConcepts(2));
      assert.strictEqual(again.permissionsReads, 0, 'and held once more');
    });

    test('a direct permissions write with its notification is seen by the next search', async function (assert) {
      assert.timeout(120_000);
      let listener = new RealmIndexUpdatedListener({
        dbAdapter: realm.adapter,
        lookupMountedRealm: (url) =>
          url === realm.realm.url ? realm.realm : undefined,
        listMountedRealms: () => [realm.realm],
      });
      await listener.start();
      try {
        await realm.search(SHAPES.homeConcepts(0));
        assert.strictEqual(await publicRows(), 0, 'baseline: no public rows');

        // as a peer's write arrives: the row, then the notification
        await insertPermissions(realm.adapter, new URL(APP), { '*': ['read'] });
        await notifyRealmIndexUpdated(realm.adapter, realm.realm.url);
        let deadline = Date.now() + 5_000;
        while (
          (await realm.realm.ownerAndVisibility()).visibility !== 'public'
        ) {
          if (Date.now() > deadline) {
            throw new Error('the notification never reached the realm');
          }
          await new Promise((r) => setTimeout(r, 20));
        }

        let result = await realm.search(SHAPES.homeConcepts(1));
        assert.strictEqual(result.status, 200, result.error);
        assert.true(
          (await publicRows()) > 0,
          'its definitions were looked up under the public scope',
        );
      } finally {
        await listener.shutDown();
      }
    });

    test('a module change is seen by the next search', async function (assert) {
      assert.timeout(120_000);
      let byMood = {
        filter: { 'item.on': Concept, eq: { 'item.mood': 'calm' } },
        page: { size: 5 },
      };
      await realm.search(SHAPES.homeConcepts(0));
      let before = await realm.search(byMood);
      assert.notStrictEqual(
        before.status,
        200,
        'baseline: Concept has no mood field',
      );

      await realm.realm.write(
        'concept.gts',
        CONCEPT_MODULE.replace(
          '@field slug = contains(StringField);',
          '@field slug = contains(StringField);\n    @field mood = contains(StringField);',
        ),
      );

      let after = await realm.search(byMood);
      assert.strictEqual(after.status, 200, after.error);
      let warm = await lookupReads(SHAPES.homeConcepts(1));
      assert.strictEqual(warm.result.status, 200, warm.result.error);
    });
  });
});
