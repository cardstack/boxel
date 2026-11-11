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

// A log's lines through the real server, as the owner, as a caller a realm
// policy admits to their own lines, as a signed-in stranger with no lines,
// and as a caller who isn't signed in; on the realm's `_search` and on the
// federated `_search`; and the one write a policy grants on a log, `record`,
// beside the writes it never grants. Every expectation is the fixture's
// lines, filtered here.

const FEED = 'http://127.0.0.1:4444/feed/';
const PLAIN = 'http://127.0.0.1:4444/plain/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY = `${ORG}policies/feed`;
const LOG = 'Class/attendance.jsonl';
const LOG_URL = `${FEED}${LOG}`;
const OWNER = '@owner:localhost';
const ADA = '@ada:localhost';
const BO = '@bo:localhost';
const ZED = '@zed:localhost';

const LIKES = 'Feed/likes.jsonl';
const BIG = 'Class/big.jsonl';
// 40 KB of lines: more than the 16 KB tail a log's file meta keeps.
const bigLogText = () =>
  Array.from(
    { length: 400 },
    (_, i) =>
      `${JSON.stringify({ at: '2026-11-01 08:00:00', actor: OWNER, what: { n: i, pad: 'x'.repeat(40) } })}\n`,
  ).join('');
const FEED_MODULE = `
  import { contains, field, linksTo, CardDef, FieldDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import BooleanField from "@cardstack/base/boolean";
  import DateField from "@cardstack/base/date";
  import { JSONLFile } from "@cardstack/base/jsonl-file-def";
  export class Attendance extends FieldDef {
    @field present = contains(BooleanField);
    @field day = contains(DateField);
  }
  export class Roster extends CardDef {
    @field log = linksTo(JSONLFile, { of: Attendance });
  }
  export class Post extends CardDef {
    @field uri = contains(StringField);
  }
`;

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const JSONL_FILE = {
  module: rri('@cardstack/base/jsonl-file-def'),
  name: 'JSONLFile',
};

type Row = Record<string, any>;

const LINES: [string, string, Row][] = [
  ['2026-11-01 08:00:00', ADA, { present: true, day: '2026-11-01' }],
  ['2026-11-01 08:01:00', BO, { present: true, day: '2026-11-01' }],
  ['2026-11-02 08:00:00', ADA, { present: true, day: '2026-11-02' }],
  ['2026-11-02 08:05:00', BO, { present: false, day: '2026-11-02' }],
  ['2026-11-03 08:00:00', ADA, { present: true, day: '2026-11-03' }],
];
const logText = () =>
  LINES.map(
    ([at, actor, what]) => `${JSON.stringify({ at, actor, what })}\n`,
  ).join('');
const linesOf = (actor: string) =>
  LINES.map((l, i) => ({ line: i + 1, actor: l[1], what: l[2] })).filter(
    (l) => l.actor === actor,
  );

function policyCard() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          {
            targetType: JSONL_FILE,
            grants: [
              {
                operation: 'query',
                where: '.actor == actor() and actor() != "anonymous"',
              },
              { operation: 'record', where: 'actor() != "anonymous"' },
            ],
          },
        ],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let feed: Realm;
  let plain: Realm;
  let org: Realm;
  let plainAdapter: any;
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
    let owner = {
      [OWNER]: ['read', 'write', 'realm-owner'],
    } satisfies RealmPermissions as RealmPermissions;
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(FEED),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Feed', policy: POLICY }),
            [LOG]: logText(),
            'feed.gts': FEED_MODULE,
            // The attendance log is typed: one card links it through a field
            // whose line type is Attendance.
            'rosters/maths.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {},
                relationships: {
                  log: { links: { self: `../${LOG}` } },
                },
                meta: { adoptsFrom: { module: '../feed', name: 'Roster' } },
              },
            }),
            ...Object.fromEntries(
              ['p1', 'p2', 'p3'].map((uri) => [
                `posts/${uri}.json`,
                JSON.stringify({
                  data: {
                    type: 'card',
                    attributes: { uri },
                    meta: { adoptsFrom: { module: '../feed', name: 'Post' } },
                  },
                }),
              ]),
            ),
            [LIKES]: `${JSON.stringify({ at: '2026-11-01 08:00:00', actor: OWNER, what: { post: 'p1' } })}\n`,
          },
          permissions: owner,
        },
        {
          realmURL: new URL(PLAIN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Plain' }),
            [LOG]: logText(),
            [BIG]: bigLogText(),
          },
          permissions: owner,
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/feed.json': policyCard(),
          },
          permissions: owner,
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
    plainAdapter =
      result.realmAdapters[
        result.realms.findIndex((candidate) => candidate.url === PLAIN)
      ];
    feed = realm(FEED);
    plain = realm(PLAIN);
    org = realm(ORG);
  }

  async function stop() {
    for (let realm of [feed, plain, org]) {
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

  let auth = (realm: Realm, user: string | undefined) =>
    user
      ? `Bearer ${createJWT(realm, user, user === OWNER ? ['read', 'write', 'realm-owner'] : [])}`
      : undefined;

  async function search(
    body: Row,
    user: string | undefined,
    realmURL = FEED,
    realm = feed,
  ) {
    let req = request
      .post(`${new URL(realmURL).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY');
    let header = auth(realm, user);
    if (header) req = req.set('Authorization', header);
    let response = await req.send(body);
    return { status: response.status, body: response.body as Row };
  }

  async function federated(body: Row, user: string | undefined) {
    let req = request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY');
    let header = auth(feed, user);
    if (header) req = req.set('Authorization', header);
    let response = await req.send(body);
    return { status: response.status, body: response.body as Row };
  }

  async function operations(user: string, ...entries: Row[]) {
    return await operationsOn(FEED, feed, user, ...entries);
  }

  async function operationsOn(
    realmURL: string,
    realm: Realm,
    user: string,
    ...entries: Row[]
  ) {
    let response = await request
      .post(`${new URL(realmURL).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth(realm, user)!)
      .send(JSON.stringify({ 'boxel:operations': entries }));
    return { status: response.status, body: response.body as Row };
  }

  const ALL = { from: { log: LOG }, page: { size: 100, total: 'exact' } };

  test('the policy compiles its log-line grant', async function (assert) {
    let policy = await feed.getCompiledPolicy();
    let grant = policy?.rules[0]?.grants.find((g) => g.operation === 'query');
    assert.strictEqual(grant?.logLines, 'own', JSON.stringify(policy?.issues));
    assert.ok(
      policy?.rules[0]?.grants.find((g) => g.operation === 'record'),
      `record is granted: ${JSON.stringify(policy?.issues)}`,
    );
  });

  test('the owner reads every line', async function (assert) {
    let { status, body } = await search(ALL, OWNER);
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.deepEqual(
      body.data.map((r: Row) => r.line),
      LINES.map((_, i) => i + 1),
    );
    assert.strictEqual(body.meta.page.total, LINES.length);
    assert.strictEqual(body.meta.policyScopedLogs, undefined);
  });

  test('a caller the grant admits reads only their own lines: rows, total, groups and facets', async function (assert) {
    let mine = linesOf(ADA);
    let { status, body } = await search(
      { ...ALL, facets: [{ by: 'actor' }] },
      ADA,
    );
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.deepEqual(
      body.data.map((r: Row) => r.line),
      mine.map((l) => l.line),
    );
    assert.strictEqual(body.meta.page.total, mine.length);
    assert.deepEqual(body.meta.facets.actor, [
      { value: ADA, count: mine.length },
    ]);
    assert.deepEqual(body.meta.policyScopedLogs, [LOG_URL]);
    let perDay = await search(
      {
        from: { log: LOG },
        group: { by: 'what.day', aggregates: { n: { count: true } } },
      },
      BO,
    );
    assert.deepEqual(
      perDay.body.data,
      linesOf(BO).map((l) => ({ group: { 'what.day': l.what.day }, n: 1 })),
      "a day with only Ada's lines is no group of Bo's",
    );
  });

  test('a signed-in caller with no lines reads none; a filter on actor reaches no one else', async function (assert) {
    let { status, body } = await search(ALL, ZED);
    assert.strictEqual(status, 200);
    assert.deepEqual(body.data, []);
    assert.strictEqual(body.meta.page.total, 0);
    let widened = await search({ ...ALL, filter: { eq: { actor: ADA } } }, BO);
    assert.deepEqual(widened.body.data, []);
  });

  test('a caller who is not signed in is refused', async function (assert) {
    let { status } = await search(ALL, undefined);
    assert.true([401, 403].includes(status), String(status));
  });

  test('with no log-line grant, the log is the owner’s alone', async function (assert) {
    let { status, body } = await search(ALL, ADA, PLAIN, plain);
    assert.strictEqual(status, 403, JSON.stringify(body));
    assert.strictEqual(body.data, undefined);
    let owner = await search(ALL, OWNER, PLAIN, plain);
    assert.strictEqual(owner.body.data.length, LINES.length);
  });

  test('the raw log is granted to no one: a GET of it is refused to a caller the grant admits', async function (assert) {
    let response = await request
      .get(new URL(LOG_URL).pathname)
      .set('Authorization', auth(feed, ADA)!);
    assert.notStrictEqual(response.status, 200);
    let owner = await request
      .get(new URL(LOG_URL).pathname)
      .set('Authorization', auth(feed, OWNER)!);
    assert.strictEqual(owner.status, 200);
  });

  test('record is granted: the realm stamps the actor, which no payload can forge', async function (assert) {
    let { status, body } = await operations(ZED, {
      op: 'invoke',
      'boxel:name': 'record',
      href: LOG_URL,
      // A `line` in the payload is the input program's to overwrite.
      data: {
        what: { present: true, day: '2026-11-04' },
        line: JSON.stringify({ at: '2020-01-01 00:00:00', actor: ADA }),
      },
    });
    assert.strictEqual(status, 200, JSON.stringify(body));
    await feed.indexing();
    let mine = await search(ALL, ZED);
    assert.deepEqual(
      mine.body.data.map((r: Row) => [r.actor, r.entry.what.day]),
      [[ZED, '2026-11-04']],
    );
    let ada = await search(ALL, ADA);
    assert.strictEqual(
      ada.body.data.length,
      linesOf(ADA).length,
      'a forged actor in `what` widens no one’s view',
    );
  });

  test('the base appendLine and update on a log are never granted', async function (assert) {
    let append = await operations(ZED, {
      op: 'invoke',
      'boxel:name': 'appendLine',
      href: LOG_URL,
      data: { line: JSON.stringify({ at: '2026-11-04 08:00:00', actor: ADA }) },
    });
    assert.notStrictEqual(append.status, 200, JSON.stringify(append.body));
    let update = await operations(ZED, {
      op: 'invoke',
      'boxel:name': 'update',
      href: LOG_URL,
      data: { content: '' },
    });
    assert.notStrictEqual(update.status, 200, JSON.stringify(update.body));
    await feed.indexing();
    let owner = await search(ALL, OWNER);
    assert.strictEqual(
      owner.body.data.length,
      LINES.length,
      'the log is as it was',
    );
  });

  test('record stores a structured what as a value and a text what as text', async function (assert) {
    // JSONLFile's `record` took `what` as a StringField on main, so a caller
    // encoded a structured event as text; it is a JsonField now, and an
    // object is stored as an object (an intended change, docs/search.md).
    for (let what of [{ present: true, day: '2026-11-05' }, 'late']) {
      // In the untyped log of a realm with no policy.
      let { status, body } = await operationsOn(PLAIN, plain, OWNER, {
        op: 'invoke',
        'boxel:name': 'record',
        href: `${PLAIN}${LOG}`,
        data: { what },
      });
      assert.strictEqual(status, 200, JSON.stringify(body));
    }
    let raw = await request
      .get(new URL(`${PLAIN}${LOG}`).pathname)
      .set('Accept', '*/*')
      .set('Authorization', auth(plain, OWNER)!)
      .buffer(true)
      .parse((res, cb) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => cb(null, text));
      });
    let written = String(raw.body)
      .trim()
      .split('\n')
      .slice(-2)
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      written.map((l) => [l.actor, l.what]),
      [
        [OWNER, { present: true, day: '2026-11-05' }],
        [OWNER, 'late'],
      ],
    );
    assert.true(
      written.every((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(l.at)),
      'the realm stamps the time, to the second, in UTC',
    );
  });

  test('a typed log holds every record to its line type, on the server', async function (assert) {
    // Sent straight to `_operations`, past the operations client's check.
    let refused = await operations(OWNER, {
      op: 'invoke',
      'boxel:name': 'record',
      href: LOG_URL,
      data: { what: { present: 'maybe', day: '2026-11-04' } },
    });
    assert.strictEqual(refused.status, 400, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors?.[0]?.code, 'invalid-params');
    let unknown = await operations(OWNER, {
      op: 'invoke',
      'boxel:name': 'record',
      href: LOG_URL,
      data: { what: { present: true, mood: 'happy' } },
    });
    assert.strictEqual(unknown.status, 400);
    let kept = await operations(OWNER, {
      op: 'invoke',
      'boxel:name': 'record',
      href: LOG_URL,
      data: { what: { present: 'true', day: '2026-11-06' } },
    });
    assert.strictEqual(kept.status, 200, JSON.stringify(kept.body));
    let last = await search(
      { ...ALL, sort: [{ by: 'line', direction: 'desc' }], page: { size: 1 } },
      OWNER,
    );
    assert.deepEqual(
      last.body.data[0].entry.what,
      { present: true, day: '2026-11-06' },
      'normalized as the type declares it',
    );
  });

  test('a card query that binds a log is never answered from a cache the append left stale', async function (assert) {
    let POST = { module: `${FEED}feed`, name: 'Post' };
    let body = {
      realms: [FEED],
      filter: { 'item.on': POST, in: { 'item.uri': '$liked' } },
      let: {
        $liked: { from: { log: LIKES }, select: 'what.post' },
      },
    };
    let ids = async () => {
      let { status, body: answer } = await federated(body, OWNER);
      assert.strictEqual(status, 200, JSON.stringify(answer));
      return (answer.data as Row[])
        .map((d) => String(d.id).split('/').pop())
        .sort();
    };
    assert.deepEqual(await ids(), ['p1']);
    let liked = await operations(OWNER, {
      op: 'invoke',
      'boxel:name': 'record',
      href: `${FEED}${LIKES}`,
      data: { what: { post: 'p2' } },
    });
    assert.strictEqual(liked.status, 200, JSON.stringify(liked.body));
    assert.deepEqual(
      await ids(),
      ['p1', 'p2'],
      'the appended like is in the next answer, with no index pass between',
    );
  });

  test('a log’s file meta counts every line and keeps the tail, after appends', async function (assert) {
    for (let day of ['2026-11-07', '2026-11-08', '2026-11-09']) {
      let { status, body } = await operationsOn(PLAIN, plain, OWNER, {
        op: 'invoke',
        'boxel:name': 'record',
        href: `${PLAIN}${LOG}`,
        data: { what: { present: true, day } },
      });
      assert.strictEqual(status, 200, JSON.stringify(body));
    }
    await plain.indexing();
    let response = await request
      .get(new URL(`${PLAIN}${LOG}`).pathname)
      .set('Accept', SupportedMimeType.FileMeta)
      .set('Authorization', auth(plain, OWNER)!);
    assert.strictEqual(response.status, 200, response.text);
    let attributes = (response.body as Row).data.attributes;
    assert.strictEqual(attributes.lineCount, LINES.length + 3);
    assert.true(
      String(attributes.content).trimEnd().endsWith('"day":"2026-11-09"}}'),
      String(attributes.content).slice(-120),
    );
  });

  test('N appends through record read O(N) bytes of the log, the index pass and the file meta included', async function (assert) {
    // Every read of the log's bytes the realm makes, by kind: the bytes it
    // serves and indexes from (whole opens and ranges), and the bounded
    // reads an append fingerprints the file with.
    let path = BIG;
    let served = 0;
    let fingerprinted = 0;
    let openFile = plainAdapter.openFile.bind(plainAdapter);
    let readRange = plainAdapter.readRange.bind(plainAdapter);
    plainAdapter.openFile = async (p: string) => {
      let ref = await openFile(p);
      if (!ref || p !== path) return ref;
      return {
        ...ref,
        get content() {
          served += ref.size ?? 0;
          return ref.content;
        },
        openContent: ref.openContent
          ? (...args: unknown[]) => {
              served += ref.size ?? 0;
              return ref.openContent(...args);
            }
          : undefined,
        createRangeStream: ref.createRangeStream
          ? (start: number, end: number) => {
              served += end - start + 1;
              return ref.createRangeStream(start, end);
            }
          : undefined,
      };
    };
    plainAdapter.readRange = (p: string, start: number, end: number) => {
      if (p === path) fingerprinted += end - start;
      return readRange(p, start, end);
    };
    let size = new TextEncoder().encode(bigLogText()).byteLength;
    let costs: number[] = [];
    let fingerprints: number[] = [];
    try {
      for (let n = 0; n < 6; n++) {
        served = 0;
        fingerprinted = 0;
        let { status, body } = await operationsOn(PLAIN, plain, OWNER, {
          op: 'invoke',
          'boxel:name': 'record',
          href: `${PLAIN}${BIG}`,
          data: { what: { n: 1000 + n } },
        });
        assert.strictEqual(status, 200, JSON.stringify(body));
        await plain.indexing();
        costs.push(served);
        fingerprints.push(fingerprinted);
      }
    } finally {
      plainAdapter.openFile = openFile;
      plainAdapter.readRange = readRange;
    }
    // The append's rows are written as it lands, so its index pass reads no
    // line; what each pass reads is the file meta's head (2,000 bytes) and
    // tail (16 KB), once for the index visit and once for the HTML visit:
    // bounded by the tail, never the whole log, and no more for the sixth
    // append than the second.
    let bound = 2 * (16 * 1024 + 2_000) + 4 * 1024;
    assert.true(
      costs.every((c) => c < bound),
      `served per append ${JSON.stringify(costs)}, under ${bound} of a ${size}-byte log`,
    );
    assert.true(
      Math.max(...costs.slice(1)) - Math.min(...costs.slice(1)) < 1024,
      `no growth with the log: ${JSON.stringify(costs)}`,
    );
    let response = await request
      .get(new URL(`${PLAIN}${BIG}`).pathname)
      .set('Accept', SupportedMimeType.FileMeta)
      .set('Authorization', auth(plain, OWNER)!);
    assert.strictEqual(
      (response.body as Row).data.attributes.lineCount,
      400 + 6,
      'every line counted',
    );
    // The append itself extends the log's recorded fingerprint rather than
    // hashing the file: past the first (which finds no fingerprint recorded
    // for the log the realm started with, and hashes it once), it reads none
    // of the log.
    assert.true(
      fingerprints.slice(1).every((bytes) => bytes <= 200),
      `bytes the append reads ${JSON.stringify(fingerprints)}`,
    );
    // The version a read reports after the appends is the one they kept.
    let meta = await request
      .get(new URL(`${PLAIN}${BIG}`).pathname)
      .set('Accept', SupportedMimeType.FileMeta)
      .set('Authorization', auth(plain, OWNER)!);
    assert.true(
      String((meta.body as Row).data.attributes.contentHash).startsWith('log:'),
      String((meta.body as Row).data.attributes.contentHash),
    );
  });

  test('the federated _search answers a log search on the one realm it names, under the same grants', async function (assert) {
    let owner = await federated({ ...ALL, realms: [FEED] }, OWNER);
    assert.strictEqual(owner.status, 200, JSON.stringify(owner.body));
    assert.strictEqual(owner.body.data.length, LINES.length);
    let ada = await federated({ ...ALL, realms: [FEED] }, ADA);
    assert.strictEqual(ada.status, 200, JSON.stringify(ada.body));
    assert.deepEqual(
      ada.body.data.map((r: Row) => r.line),
      linesOf(ADA).map((l) => l.line),
    );
    let two = await federated({ ...ALL, realms: [FEED, PLAIN] }, OWNER);
    assert.strictEqual(two.status, 400);
    let elsewhere = await federated(
      { ...ALL, from: { log: `${PLAIN}${LOG}` }, realms: [FEED] },
      OWNER,
    );
    assert.strictEqual(elsewhere.status, 400, 'the log is in another realm');
    let ungranted = await federated({ ...ALL, realms: [PLAIN] }, ADA);
    assert.strictEqual(ungranted.status, 403);
  });
});
