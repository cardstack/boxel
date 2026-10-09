import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  LocalPath,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  setAnonymousRequestSink,
  type AnonymousRequestEvent,
} from '@cardstack/runtime-common/card-operations/telemetry';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  clearOfRateLimitWindowEdge,
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

// A newsroom nobody may read or write without signing in, governed by a
// policy card in an Org realm. Its policy lets callers who aren't signed in
// leave feedback and edit open drafts, each as a user the newsroom's own
// `realm.json` names, makes other writes as a user the policy writes out, keeps
// on its own card, or reads from the card being written, and opts in a few
// writes whose acting users don't resolve to anyone who may write the
// newsroom.
const NEWSROOM = 'http://127.0.0.1:4444/newsroom/';
// A board anyone may read, and only a signed-in writer may write without a
// grant; its policy lets visitors post feedback as its own submitter.
const BOARD = 'http://127.0.0.1:4444/board/';
const BOARD_POLICY = 'http://127.0.0.1:4444/org/policies/board';
const ORG = 'http://127.0.0.1:4444/org/';
const NEWSROOM_POLICY = `${ORG}policies/newsroom`;
const EDITOR = '@editor:localhost';
const SUBMITTER = '@submitter:localhost';
const READER = '@reader:localhost';
const ORG_ADMIN = '@org-admin:localhost';

// Callers' addresses come from the ranges reserved for documentation.
const VISITOR = '192.0.2.10';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// The newsroom's policy card is one of these, so a grant can name a user the
// card itself keeps, through `policy("writer")`.
const NEWSROOM_POLICY_MODULE = `
  import { contains, field } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { RealmPolicy } from "@cardstack/catalog/realm-policy/realm-policy";

  export class NewsroomPolicy extends RealmPolicy {
    @field writer = contains(StringField);
  }
`;

const NEWSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Article extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field authorIds = containsMany(StringField);
  }
  export class Feedback extends CardDef {
    @field message = contains(StringField);
  }
  export class Comment extends CardDef {
    @field message = contains(StringField);
  }
  export class Note extends CardDef {
    @field message = contains(StringField);
  }
  export class Tip extends CardDef {
    @field message = contains(StringField);
  }
  export class Rumor extends CardDef {
    @field message = contains(StringField);
  }
  export class Letter extends CardDef {
    @field message = contains(StringField);
  }
  export class Memo extends CardDef {
    @field message = contains(StringField);
  }
  export class Pitch extends CardDef {
    @field message = contains(StringField);
    @field byline = contains(StringField);
  }
  export class Draft extends CardDef {
    @field title = contains(StringField);
    @field editorId = contains(StringField);
  }
  export class Correction extends CardDef {
    @field message = contains(StringField);
  }
`;

function type(name: string) {
  return { module: `${NEWSROOM}newsroom`, name };
}

function adoptsFrom(name: string) {
  return { module: rri(`${NEWSROOM}newsroom`), name };
}

const ARTICLE = type('Article');
const FEEDBACK = type('Feedback');
const COMMENT = type('Comment');
const NOTE = type('Note');
const TIP = type('Tip');
const RUMOR = type('Rumor');
const LETTER = type('Letter');
const MEMO = type('Memo');
const PITCH = type('Pitch');
const DRAFT = type('Draft');
const CORRECTION = type('Correction');

const OPEN_DRAFT = `${NEWSROOM}articles/open`;
const SPAM = `${NEWSROOM}articles/spam`;
const CLOSED_DRAFT = `${NEWSROOM}articles/closed`;
const GUEST_DRAFT = `${NEWSROOM}articles/guest`;
const MISSING = `${NEWSROOM}articles/nowhere`;
const SUBMITTERS_DRAFT = `${NEWSROOM}drafts/submitters`;
const READERS_DRAFT = `${NEWSROOM}drafts/readers`;

// The acting users the newsroom names: one who may write it, one who may only
// read it, a value that names nobody, and the caller who isn't signed in,
// who is never a user. A grant's rate limit reads `limit` and `window`, which
// a test sets when it wants one tighter than the platform's.
const NEWSROOM_CONFIG = {
  submitter: SUBMITTER,
  reader: READER,
  bogus: 'not a user',
  guest: 'anonymous',
};

// The predicate that opens a grant to callers who aren't signed in and to
// no one else.
const ANYONE_NOT_SIGNED_IN = 'actor() == "anonymous"';

// A grant's rate limit, each half from the newsroom's config where it holds
// one and the platform's otherwise.
const LIMITED = {
  rateLimitRequests: 'realmConfig().limit',
  rateLimitWindowSeconds: 'realmConfig().window',
};

function article(headline: string, status: string, authorIds: string[] = []) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { headline, status, authorIds },
      meta: { adoptsFrom: { module: '../newsroom', name: 'Article' } },
    },
  });
}

function draft(title: string, editorId: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, editorId },
      meta: { adoptsFrom: { module: '../newsroom', name: 'Draft' } },
    },
  });
}

function rule(
  targetType: { module: string; name: string },
  grants: Record<string, unknown>[],
) {
  return { targetType, grants };
}

const POLICY = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      writer: SUBMITTER,
      rules: [
        // rules[0]
        rule(FEEDBACK, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'realmConfig("submitter")',
            ...LIMITED,
          },
        ]),
        // rules[1]
        rule(ARTICLE, [
          {
            operation: 'update',
            where: `${ANYONE_NOT_SIGNED_IN} and .status == "open"`,
            actingUser: 'realmConfig("submitter")',
            ...LIMITED,
          },
          // Reads the caller without naming the one who isn't signed in, so
          // it never admits such a caller, whatever its acting user says.
          {
            operation: 'delete',
            where: '.authorIds | any(. == actor())',
            actingUser: 'realmConfig("submitter")',
          },
          {
            operation: 'delete',
            where: `${ANYONE_NOT_SIGNED_IN} and .status == "spam"`,
            actingUser: 'realmConfig("submitter")',
          },
          // A read is made as nobody, so its acting user, which names no
          // one, is never asked for.
          {
            operation: 'read',
            where: `${ANYONE_NOT_SIGNED_IN} and .status == "open"`,
            actingUser: 'realmConfig("missing")',
            ...LIMITED,
          },
        ]),
        // rules[2] to rules[5]: acting users who may not write the newsroom,
        // who aren't users, or whose expression produces nothing.
        rule(COMMENT, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'realmConfig("reader")',
          },
        ]),
        rule(NOTE, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'realmConfig("bogus")',
          },
        ]),
        rule(TIP, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'realmConfig("missing")',
          },
        ]),
        rule(RUMOR, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'realmConfig("guest")',
          },
        ]),
        // rules[6]: an acting user the policy writes out, on a grant a reader
        // who is signed in is admitted through too.
        rule(LETTER, [
          {
            operation: 'create',
            where: `${ANYONE_NOT_SIGNED_IN} or actor() == "${READER}"`,
            actingUser: `"${SUBMITTER}"`,
          },
        ]),
        // rules[7]: an acting user the policy card keeps.
        rule(MEMO, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'policy("writer")',
          },
        ]),
        // rules[8]: an acting user the card being created names.
        rule(PITCH, [
          {
            operation: 'create',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'instance().byline',
          },
        ]),
        // rules[9]: an acting user the card being updated names.
        rule(DRAFT, [
          {
            operation: 'update',
            where: ANYONE_NOT_SIGNED_IN,
            actingUser: 'instance().editorId',
          },
        ]),
        // rules[10]: names the caller who isn't signed in but no acting user,
        // so it admits only the signed-in reader it names.
        rule(CORRECTION, [
          {
            operation: 'create',
            where: `${ANYONE_NOT_SIGNED_IN} or actor() == "${READER}"`,
          },
        ]),
      ],
    },
    meta: {
      adoptsFrom: { module: '../newsroom-policy', name: 'NewsroomPolicy' },
    },
  },
});

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
  let board: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let records: AnonymousRequestEvent[];
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
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      clientAddress: { trustedProxyHops: 1, infraAddresses: [] },
      realms: [
        {
          realmURL: new URL(NEWSROOM),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Newsroom',
              policy: NEWSROOM_POLICY,
              config: NEWSROOM_CONFIG,
            }),
            'newsroom.gts': NEWSROOM_MODULE,
            'articles/open.json': article('Polls open', 'open', [SUBMITTER]),
            'articles/closed.json': article('Polls close', 'closed'),
            'articles/spam.json': article('Buy now', 'spam'),
            'articles/guest.json': article('Guest column', 'guest', [
              'anonymous',
            ]),
            'drafts/submitters.json': draft('Election night', SUBMITTER),
            'drafts/readers.json': draft('Morning after', READER),
          },
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [SUBMITTER]: ['read', 'write'],
            [READER]: ['read'],
            [ORG_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(BOARD),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Board',
              policy: BOARD_POLICY,
              config: { submitter: SUBMITTER },
            }),
            'newsroom.gts': NEWSROOM_MODULE,
          },
          permissions: {
            '*': ['read'],
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [SUBMITTER]: ['read', 'write'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'newsroom-policy.gts': NEWSROOM_POLICY_MODULE,
            'policies/newsroom.json': POLICY,
            'policies/board.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {
                  rules: [
                    rule({ module: `${BOARD}newsroom`, name: 'Feedback' }, [
                      {
                        operation: 'create',
                        where: ANYONE_NOT_SIGNED_IN,
                        actingUser: 'realmConfig("submitter")',
                      },
                    ]),
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
    newsroom = result.realms.find((realm) => realm.url === NEWSROOM)!;
    board = result.realms.find((realm) => realm.url === BOARD)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [newsroom, board, org]) {
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
      db = dbAdapter;
      await start({ dbAdapter, publisher, runner });
      records = [];
      setAnonymousRequestSink((record) => records.push(record));
    },
    afterEach: async () => {
      setAnonymousRequestSink(undefined);
      await stop();
    },
  });

  function newCard(name: string, attributes: Record<string, unknown>) {
    return {
      data: {
        type: 'card',
        attributes,
        meta: { adoptsFrom: adoptsFrom(name) },
      },
    };
  }

  function createCard(
    name: string,
    attributes: Record<string, unknown>,
    authorization?: string,
  ) {
    let req = request
      .post(new URL(NEWSROOM).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    if (authorization) {
      req = req.set('Authorization', authorization);
    }
    return req.send(JSON.stringify(newCard(name, attributes)));
  }

  function patchArticle(url: string, headline: string, status = 'open') {
    return request
      .patch(new URL(url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { headline, status },
            meta: { adoptsFrom: adoptsFrom('Article') },
          },
        }),
      );
  }

  // Changes only the draft's title, so the editor it names is the same
  // before the write and after it.
  function patchDraft(url: string, title: string) {
    return request
      .patch(new URL(url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { title },
            meta: { adoptsFrom: adoptsFrom('Draft') },
          },
        }),
      );
  }

  function operations(...entries: Record<string, unknown>[]) {
    return operationsAs('POST', ...entries);
  }

  function operationsAs(
    method: 'POST' | 'QUERY',
    ...entries: Record<string, unknown>[]
  ) {
    let req = request.post(`${new URL(NEWSROOM).pathname}_operations`);
    if (method === 'QUERY') {
      req = req.set('X-HTTP-Method-Override', 'QUERY');
    }
    return req
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('X-Forwarded-For', VISITOR)
      .send(JSON.stringify({ 'boxel:operations': entries }));
  }

  function createEntry(name: string, attributes: Record<string, unknown>) {
    return {
      op: 'invoke',
      'boxel:name': 'create',
      data: newCard(name, attributes).data,
    };
  }

  async function stored(url: string) {
    let content = await newsroom.operationCore.readFileAsText(
      `${new URL(url).pathname.slice(new URL(NEWSROOM).pathname.length)}.json` as LocalPath,
    );
    return content === undefined
      ? undefined
      : (
          JSON.parse(content) as {
            data: { attributes: Record<string, unknown> };
          }
        ).data.attributes;
  }

  // How many cards of `name` the newsroom holds, as its editor searches it.
  async function countOf(name: string) {
    await newsroom.indexing();
    let response = await request
      .post(`${new URL(NEWSROOM).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', signedIn(EDITOR, ['read', 'write', 'realm-owner']))
      .send({ filter: { 'item.on': type(name) } });
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    return (response.body as { data: unknown[] }).data.length;
  }

  function feedbackCount() {
    return countOf('Feedback');
  }

  // The users the newsroom's index passes were initiated by: the writer lanes
  // its incremental index jobs ran in. A write by a caller who isn't signed
  // in runs in the lane of the user it is made as.
  async function indexedFor() {
    await newsroom.indexing();
    let family = `indexing:${NEWSROOM}#user:`;
    let rows = (await db.execute(
      `select distinct concurrency_group from jobs
        where concurrency_group like $1`,
      { bind: [`${family}%`] },
    )) as { concurrency_group: string }[];
    return rows.map((row) => row.concurrency_group.slice(family.length)).sort();
  }

  function signedIn(user: string, permissions: string[]) {
    return `Bearer ${createJWT(newsroom, user, permissions as ('read' | 'write' | 'realm-owner')[])}`;
  }

  async function setNewsroom(config: Record<string, unknown>) {
    await newsroom.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Newsroom',
        policy: NEWSROOM_POLICY,
        config,
      }),
    );
    await newsroom.indexing();
  }

  // Tightens every grant that reads the newsroom's limit to `requests` in a
  // ten-minute window.
  async function limitNewsroom(requests: number) {
    await setNewsroom({ ...NEWSROOM_CONFIG, limit: requests, window: 600 });
    await clearOfRateLimitWindowEdge({ windowSeconds: 600 });
  }

  function unauthenticated(response: Response, label: string, assert: Assert) {
    assert.strictEqual(response.status, 401, `${label}: 401 ${response.text}`);
    assert.strictEqual(
      response.body?.errors?.[0]?.code,
      'actor-required',
      `${label}: told to authenticate`,
    );
  }

  test('a caller who is not signed in leaves feedback, written as the user the realm names', async function (assert) {
    let response = await createCard('Feedback', { message: 'Great story' });
    assert.strictEqual(response.status, 201, response.text);
    let id = (response.body as { data: { id: string } }).data.id;
    assert.true(id.startsWith(NEWSROOM), 'the card is in the newsroom');
    assert.deepEqual(
      await stored(id),
      { message: 'Great story' },
      'the card holds what was sent',
    );
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER], 'made as the submitter');
    assert.strictEqual(record?.operation, 'create');
    assert.strictEqual(record?.grant, 'rules[0].grants[0]');
    assert.strictEqual(record?.clientIP, VISITOR);
    assert.deepEqual(
      await indexedFor(),
      [SUBMITTER],
      'and indexed as a write of the submitter',
    );
  });

  test('a write is made as the user an acting user written out on the grant names', async function (assert) {
    let response = await createCard('Letter', { message: 'Dear editor' });
    assert.strictEqual(response.status, 201, response.text);
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER]);
    assert.strictEqual(record?.grant, 'rules[6].grants[0]');
  });

  test('a write is made as the user the policy card keeps', async function (assert) {
    let response = await createCard('Memo', { message: 'Staff meeting' });
    assert.strictEqual(response.status, 201, response.text);
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER]);
    assert.strictEqual(record?.grant, 'rules[7].grants[0]');
  });

  test('a create is made as the user the card it creates names, and admitted only when that user may write', async function (assert) {
    let response = await createCard('Pitch', {
      message: 'A story about parks',
      byline: SUBMITTER,
    });
    assert.strictEqual(response.status, 201, response.text);
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER], 'made as its byline');

    records = [];
    unauthenticated(
      await createCard('Pitch', {
        message: 'A story about libraries',
        byline: READER,
      }),
      'a byline who may only read',
      assert,
    );
    let refused = records.find((r) => r.outcome === 'refused');
    assert.deepEqual(refused?.actingUserFailures, [
      { grant: 'rules[8].grants[0]', failure: 'no-write' },
    ]);
    assert.strictEqual(await countOf('Pitch'), 1, 'only the first was written');
  });

  test('an update is made as the user the card it updates names, and admitted only when that user may write', async function (assert) {
    let response = await patchDraft(SUBMITTERS_DRAFT, 'Election night, late');
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(await stored(SUBMITTERS_DRAFT), {
      title: 'Election night, late',
      editorId: SUBMITTER,
    });
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER], 'made as its editor');
    assert.strictEqual(record?.grant, 'rules[9].grants[0]');

    records = [];
    unauthenticated(
      await patchDraft(READERS_DRAFT, 'Rewritten'),
      'an editor who may only read',
      assert,
    );
    let refused = records.find((r) => r.outcome === 'refused');
    assert.deepEqual(refused?.actingUserFailures, [
      { grant: 'rules[9].grants[0]', failure: 'no-write' },
    ]);
    assert.strictEqual(
      (await stored(READERS_DRAFT))?.title,
      'Morning after',
      'nothing was written',
    );
  });

  test('an acting user who may not write the realm, is not a user, or names nothing admits nothing, and why is recorded', async function (assert) {
    for (let [name, grant, failure] of [
      ['Comment', 'rules[2].grants[0]', 'no-write'],
      ['Note', 'rules[3].grants[0]', 'not-a-matrix-id'],
      ['Tip', 'rules[4].grants[0]', 'expression-failed'],
      ['Rumor', 'rules[5].grants[0]', 'not-a-matrix-id'],
    ] as const) {
      records = [];
      let response = await createCard(name, { message: 'Hello' });
      unauthenticated(response, name, assert);
      let refused = records.find((r) => r.outcome === 'refused');
      assert.deepEqual(
        refused?.actingUserFailures,
        [{ grant, failure }],
        `${name}: recorded as ${failure}`,
      );
      assert.strictEqual(await countOf(name), 0, `${name}: nothing written`);
    }
  });

  test('a write grant that names the caller who is not signed in but no acting user admits no such caller, and still admits a signed-in one', async function (assert) {
    unauthenticated(
      await createCard('Correction', { message: 'Fix the date' }),
      'a caller who is not signed in',
      assert,
    );
    assert.deepEqual(
      records.filter((r) => r.outcome === 'admitted'),
      [],
      'nothing was admitted',
    );
    assert.strictEqual(await countOf('Correction'), 0, 'nothing was written');

    let response = await createCard(
      'Correction',
      { message: 'Fix the date' },
      signedIn(READER, ['read']),
    );
    assert.strictEqual(response.status, 201, response.text);
    assert.strictEqual(await countOf('Correction'), 1, 'the reader wrote it');
  });

  test("a signed-in caller a grant admits writes as themselves, whatever the grant's acting user names", async function (assert) {
    let response = await createCard(
      'Letter',
      { message: 'Signed letter' },
      signedIn(READER, ['read']),
    );
    assert.strictEqual(response.status, 201, response.text);
    assert.deepEqual(records, [], 'and is no anonymous caller');
    assert.deepEqual(
      await indexedFor(),
      [READER],
      'the write was indexed as the reader’s, not the acting user’s',
    );
  });

  test("a read is made as nobody, whatever the grant's acting user names", async function (assert) {
    let read = { op: 'invoke', 'boxel:name': 'read', href: OPEN_DRAFT };
    let response = await operationsAs('QUERY', read);
    assert.strictEqual(response.status, 200, response.text);
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.strictEqual(record?.grant, 'rules[1].grants[3]');
    let actingUsers = record?.actingUsers ?? [];
    assert.deepEqual(actingUsers, [], 'made as no one');
    assert.strictEqual(
      record?.actingUserFailures,
      undefined,
      'and its acting user, which names no one, was never asked for',
    );
  });

  test("a change to the realm's config takes effect on the next write", async function (assert) {
    assert.strictEqual(
      (await createCard('Feedback', { message: 'First' })).status,
      201,
    );
    await setNewsroom({ ...NEWSROOM_CONFIG, submitter: READER });
    unauthenticated(
      await createCard('Feedback', { message: 'Second' }),
      'the key now names a reader',
      assert,
    );
    await setNewsroom({ reader: READER });
    unauthenticated(
      await createCard('Feedback', { message: 'Third' }),
      'the key is gone',
      assert,
    );
    assert.deepEqual(
      records
        .filter((r) => r.outcome === 'refused')
        .map((r) => r.actingUserFailures),
      [
        [{ grant: 'rules[0].grants[0]', failure: 'no-write' }],
        [{ grant: 'rules[0].grants[0]', failure: 'expression-failed' }],
      ],
    );
    assert.strictEqual(await feedbackCount(), 1, 'only the first was written');
  });

  test('an update is admitted only where the grant’s condition holds, and every refusal is the same 401', async function (assert) {
    let open = await patchArticle(OPEN_DRAFT, 'Polls open late');
    assert.strictEqual(open.status, 200, open.text);
    assert.strictEqual((await stored(OPEN_DRAFT))?.headline, 'Polls open late');
    let closed = await patchArticle(CLOSED_DRAFT, 'Rewritten');
    let missing = await patchArticle(MISSING, 'Rewritten');
    unauthenticated(closed, 'a closed draft', assert);
    unauthenticated(missing, 'a missing draft', assert);
    assert.strictEqual(closed.text, missing.text, 'byte-identical');
    assert.strictEqual(
      (await stored(CLOSED_DRAFT))?.headline,
      'Polls close',
      'nothing was written',
    );
  });

  test('a grant that reads the caller without naming one who is not signed in never admits such a caller, even to a card naming them', async function (assert) {
    let response = await request
      .delete(new URL(GUEST_DRAFT).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    unauthenticated(response, 'a delete', assert);
    assert.ok(await stored(GUEST_DRAFT), 'the draft is still there');
  });

  test('a write over the limit gets 429 and writes nothing', async function (assert) {
    await limitNewsroom(1);
    assert.strictEqual(
      (await createCard('Feedback', { message: 'One' })).status,
      201,
    );
    let over = await createCard('Feedback', { message: 'Two' });
    assert.strictEqual(over.status, 429, over.text);
    assert.strictEqual(over.body.errors[0].code, 'rate-limited');
    assert.ok(over.headers['retry-after'], 'says when to try again');
    assert.strictEqual(await feedbackCount(), 1, 'the second was not written');
    let limited = records.find((r) => r.outcome === 'rate-limited');
    assert.strictEqual(limited?.grant, 'rules[0].grants[0]');
    assert.deepEqual(
      limited?.limit,
      {
        requests: 1,
        windowSeconds: 600,
        requestsFrom: 'grant',
        windowSecondsFrom: 'grant',
      },
      "counted against the grant's own limit",
    );
  });

  test('a refused write costs nothing', async function (assert) {
    await limitNewsroom(1);
    for (let i = 0; i < 3; i++) {
      unauthenticated(
        await patchArticle(CLOSED_DRAFT, `Try ${i}`),
        `refused ${i}`,
        assert,
      );
    }
    let response = await patchArticle(OPEN_DRAFT, 'Still fits');
    assert.strictEqual(
      response.status,
      200,
      `the grant's budget is untouched: ${response.text}`,
    );
  });

  test('a batch is counted one unit per entry, and one that does not fit writes nothing', async function (assert) {
    await limitNewsroom(2);
    let three = await operations(
      createEntry('Feedback', { message: 'A' }),
      createEntry('Feedback', { message: 'B' }),
      createEntry('Feedback', { message: 'C' }),
    );
    assert.strictEqual(three.status, 429, three.text);
    assert.ok(three.headers['retry-after'], 'says when to try again');
    assert.strictEqual(await feedbackCount(), 0, 'nothing was written');
    let two = await operations(
      createEntry('Feedback', { message: 'A' }),
      createEntry('Feedback', { message: 'B' }),
    );
    assert.strictEqual(two.status, 200, two.text);
    assert.strictEqual(await feedbackCount(), 2, 'both were written');
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.strictEqual(record?.cost, 2, 'counted as two');
    assert.deepEqual(record?.actingUsers, [SUBMITTER]);
  });

  test('a create posted to a subdirectory is told to authenticate, not that nothing is there', async function (assert) {
    let response = await request
      .post(`${new URL(NEWSROOM).pathname}elsewhere/`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .send(JSON.stringify(newCard('Feedback', { message: 'Hi' })));
    unauthenticated(response, 'a subdirectory', assert);
  });

  test('a capability check answers such a caller about writes as the gate would', async function (assert) {
    let response = await request
      .post(`${new URL(NEWSROOM).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({
        checks: [
          { target: FEEDBACK, operation: 'create' },
          { target: COMMENT, operation: 'create' },
          { target: OPEN_DRAFT, operation: 'update' },
          { target: CLOSED_DRAFT, operation: 'update' },
          { target: CORRECTION, operation: 'create' },
          { target: MEMO, operation: 'create' },
        ],
      });
    assert.strictEqual(response.status, 200, response.text);
    let allowed = (response.body.checks as { allowed: boolean }[]).map(
      (check) => check.allowed,
    );
    assert.deepEqual(allowed, [true, false, true, false, false, true]);
  });

  test('explain judges such a caller’s write by the grants that opt in to them', async function (assert) {
    let explain = async (target: string, operation: string) => {
      let response = await request
        .post(`${new URL(ORG).pathname}_operations`)
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set(
          'Authorization',
          `Bearer ${createJWT(org, ORG_ADMIN, ['read', 'write', 'realm-owner'])}`,
        )
        .send(
          JSON.stringify({
            'boxel:operations': [
              {
                op: 'invoke',
                'boxel:name': 'explain',
                href: NEWSROOM_POLICY,
                data: { actor: '', target, operation },
              },
            ],
          }),
        );
      if (response.status !== 200) {
        throw new Error(
          `explain answered ${response.status}: ${response.text}`,
        );
      }
      return response.body['atomic:results'][0];
    };
    assert.strictEqual(
      (await explain(OPEN_DRAFT, 'update')).decision,
      'allowed',
      'an open draft',
    );
    assert.strictEqual(
      (await explain(CLOSED_DRAFT, 'update')).decision,
      'denied',
      'a closed draft',
    );
  });

  test('signed-in callers write as themselves, untouched by acting users', async function (assert) {
    let response = await request
      .patch(new URL(CLOSED_DRAFT).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .set('Authorization', signedIn(EDITOR, ['read', 'write', 'realm-owner']))
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { headline: 'Edited', status: 'closed' },
            meta: { adoptsFrom: adoptsFrom('Article') },
          },
        }),
      );
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(records, [], 'and is no anonymous caller');
  });

  test('a create gets an id the realm mints, whatever id it names', async function (assert) {
    let doc = newCard('Feedback', { message: 'Pick my id' });
    let response = await request
      .post(new URL(NEWSROOM).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .send(JSON.stringify({ data: { ...doc.data, lid: 'chosen-by-me' } }));
    assert.strictEqual(response.status, 201, response.text);
    let id = (response.body as { data: { id: string } }).data.id;
    assert.notOk(id.includes('chosen-by-me'), `minted: ${id}`);
  });

  test('a write that side-loads another card is refused, and nothing is written', async function (assert) {
    let doc = newCard('Feedback', { message: 'With a friend' });
    let response = await request
      .post(new URL(NEWSROOM).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .send(
        JSON.stringify({
          ...doc,
          included: [
            {
              type: 'card',
              lid: 'friend',
              attributes: { message: 'Side-loaded' },
              meta: { adoptsFrom: adoptsFrom('Feedback') },
            },
          ],
        }),
      );
    unauthenticated(response, 'a side-load', assert);
    assert.strictEqual(await feedbackCount(), 0, 'nothing was written');
  });

  test('an envelope update gives the same 401 for a closed draft and a missing one', async function (assert) {
    let update = (href: string) =>
      operations({
        op: 'invoke',
        'boxel:name': 'update',
        href,
        data: {
          type: 'card',
          attributes: { headline: 'Rewritten', status: 'open' },
          meta: { adoptsFrom: adoptsFrom('Article') },
        },
      });
    let closed = await update(CLOSED_DRAFT);
    let missing = await update(MISSING);
    unauthenticated(closed, 'a closed draft', assert);
    unauthenticated(missing, 'a missing draft', assert);
    assert.strictEqual(closed.text, missing.text, 'byte-identical');
  });

  test('a batch that only reads is counted one unit per entry once its reads have run', async function (assert) {
    await limitNewsroom(2);
    let read = { op: 'invoke', 'boxel:name': 'read', href: OPEN_DRAFT };
    let two = await operationsAs('QUERY', read, read);
    assert.strictEqual(two.status, 200, two.text);
    let over = await operationsAs('QUERY', read);
    assert.strictEqual(over.status, 429, 'the budget is spent');
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.strictEqual(record?.cost, 2, 'counted as two');
  });

  test('an empty batch is answered as it is for anyone, and costs nothing', async function (assert) {
    let response = await operations();
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      records.filter((r) => r.outcome !== 'refused'),
      [],
      'nothing was counted',
    );
  });

  test('a delete is admitted where its grant holds', async function (assert) {
    let response = await request
      .delete(new URL(SPAM).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    assert.true(response.status < 300, `${response.status} ${response.text}`);
    assert.notOk(await stored(SPAM), 'the spam is gone');
  });

  test('a realm anyone may read answers a capability check about a write it opens to such callers', async function (assert) {
    let feedback = { module: `${BOARD}newsroom`, name: 'Feedback' };
    let response = await request
      .post(`${new URL(BOARD).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({ checks: [{ target: feedback, operation: 'create' }] });
    assert.strictEqual(response.status, 200, response.text);
    assert.true(response.body.checks[0].allowed, 'the form may be shown');
    let created = await request
      .post(new URL(BOARD).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { message: 'Hello board' },
            meta: {
              adoptsFrom: { module: rri(`${BOARD}newsroom`), name: 'Feedback' },
            },
          },
        }),
      );
    assert.strictEqual(created.status, 201, created.text);
    assert.ok(board, 'the board realm is up');
  });
});
