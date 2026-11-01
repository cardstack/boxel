import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  EVENT_FEED_MAX_CHECKS_PER_EVENT,
  cardRevisionOf,
  channelFeedKey,
  DbFeedStore,
  REALM_PRESENCE_CHANNEL,
  EVENT_FEED_WINDOW,
  parseAddressRanges,
  RealmEventFeed,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  FeedEventWindow,
  FeedEvent,
  FeedStore,
  PresenceNotice,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import { refreshAfterRepublish } from '../handlers/handle-publish-realm.ts';
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

// ADR 020: a realm's event feed. A newsroom nobody may read without
// signing in opens published articles to callers who aren't signed in; a
// library opens nothing to them.
const NEWSROOM = 'http://127.0.0.1:4444/newsroom/';
const LIBRARY = 'http://127.0.0.1:4444/library/';
const ORG = 'http://127.0.0.1:4444/org/';
const EDITOR = '@editor:localhost';
const VISITOR = '192.0.2.10';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const ARTICLE_MODULE = `
  import { contains, containsMany, field, linksTo, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, bxl } from "@cardstack/base/operations";
  export class Article extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @operation static retitle = {
      base: 'transform',
      params: { headline: StringField },
      set: { headline: params('headline') },
    };
    @field cheerers = containsMany(StringField);
    // What lasts of the cheers: who cheered, read off the card's channel
    // inside the write.
    @operation static tally = {
      base: 'transform',
      collect: { cheers: 'cheer' },
      transformations: bxl\`.cheerers += [params("cheers")[] | .reader];\`,
    };
    @operation static cheer = {
      base: 'emit',
      params: { reader: StringField, mood: StringField },
      key: bxl\`params("reader")\`,
    };
    // Who is reading now: presence, the latest per reader, with no position.
    @operation static here = {
      base: 'emit',
      ordered: false,
      expiresAfter: 60,
      params: { reader: StringField },
      key: bxl\`params("reader")\`,
    };
    @field present = containsMany(StringField);
    @operation static rollCall = {
      base: 'transform',
      collect: { readers: 'here' },
      transformations: bxl\`.present = [params("readers")[] | .reader] | sort;\`,
    };
  }
  // A card that shows another's headline, as a leaderboard shows a game's
  // scores: computed from the card it links to.
  export class Digest extends Article {
    @field lead = linksTo(() => Article);
    @field leadHeadline = contains(StringField, {
      computeVia: function (this: Digest) {
        return this.lead?.headline;
      },
    });
  }
`;

function article(headline: string, status: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { headline, status },
      meta: { adoptsFrom: { module: '../article', name: 'Article' } },
    },
  });
}

function policyCard(module: string, grants: Record<string, unknown>[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [{ targetType: { module, name: 'Article' }, grants }],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

// The newsroom's config, with how many reads a visitor's address gets a
// window.
function newsroomConfig(anonymousRequests: number) {
  return realmConfigCardJSON({
    name: 'Newsroom',
    policy: `${ORG}policies/newsroom`,
    config: { anonymousRequests },
  });
}

const PUBLISHED_TO_ANONYMOUS = {
  where: 'actor() == "anonymous" and .status == "published"',
};

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
  let library: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let feedDbAdapter: PgAdapter;

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
    feedDbAdapter = dbAdapter;
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      clientAddress: {
        trustedProxyHops: 1,
        infraAddresses: parseAddressRanges(['203.0.113.5']).ranges,
      },
      realms: [
        {
          realmURL: new URL(NEWSROOM),
          fileSystem: {
            'realm.json': newsroomConfig(1000),
            'article.gts': ARTICLE_MODULE,
            'articles/published.json': article('Polls open', 'published'),
            'articles/draft.json': article('Polls close', 'draft'),
          },
          permissions: { [EDITOR]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(LIBRARY),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Library',
              policy: `${ORG}policies/library`,
            }),
            'article.gts': ARTICLE_MODULE,
            'articles/shelved.json': article('Shelved', 'published'),
          },
          permissions: { [EDITOR]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/newsroom.json': policyCard(`${NEWSROOM}article`, [
              {
                operation: 'read',
                ...PUBLISHED_TO_ANONYMOUS,
                rateLimitRequests: 'realmConfig("anonymousRequests")',
                rateLimitWindowSeconds: '600',
              },
              {
                operation: 'cheer',
                anonymous: true,
                ...PUBLISHED_TO_ANONYMOUS,
              },
              {
                operation: 'here',
                anonymous: true,
                ...PUBLISHED_TO_ANONYMOUS,
              },
            ]),
            // Opens nothing to callers who aren't signed in.
            'policies/library.json': policyCard(`${LIBRARY}article`, [
              { operation: 'read' },
            ]),
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
    newsroom = result.realms.find((realm) => realm.url === NEWSROOM)!;
    library = result.realms.find((realm) => realm.url === LIBRARY)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [newsroom, library, org]) {
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

  function feedWindow(realm = NEWSROOM) {
    return request
      .get(`${new URL(realm).pathname}_live`)
      .set('Accept', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR);
  }

  // The feed's events once it has announced at least `count` past `after`.
  async function eventsAfter(after: number, count = 1) {
    let deadline = Date.now() + 10_000;
    for (;;) {
      let response = await feedWindow();
      let events = (response.body as FeedEventWindow).events.filter(
        (event) => event.seq > after,
      );
      if (events.length >= count || Date.now() > deadline) {
        return events;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function head() {
    return ((await feedWindow()).body as FeedEventWindow).head;
  }

  test('a change to a card a visitor may read is announced by its path, and one to a card they may not is not', async function (assert) {
    let start = await head();
    await newsroom.write(
      'articles/draft.json',
      article('Polls close late', 'draft'),
    );
    await newsroom.write(
      'articles/published.json',
      article('Polls open late', 'published'),
    );
    await newsroom.indexing();
    let events = await eventsAfter(start);
    let paths = events.map((event) => event.path);
    assert.true(
      paths.includes('articles/published'),
      `the published article is announced: ${JSON.stringify(events)}`,
    );
    assert.false(
      paths.includes('articles/draft'),
      'the draft is not announced',
    );
    assert.false(
      JSON.stringify(events).includes(NEWSROOM),
      "no event names the realm's own address",
    );
    assert.false(
      JSON.stringify(events).includes('Polls open late'),
      'no event carries card content',
    );
    let written = events.find(
      (event) =>
        event.kind === 'written' && event.path === 'articles/published',
    );
    assert.deepEqual(
      written?.operation,
      { name: 'update', base: 'update' },
      'a write that ran no named operation is named by its base',
    );
  });

  test('a card that stops being readable is announced as withdrawn, once', async function (assert) {
    // The feed announces a removal only for a card it has seen readable, so
    // a visitor never learns the path of a card they could not read.
    let start = await head();
    await newsroom.write(
      'articles/published.json',
      article('Polls open early', 'published'),
    );
    await newsroom.indexing();
    await eventsAfter(start);
    await new Promise((resolve) => setTimeout(resolve, 500));
    let before = await head();
    await newsroom.write(
      'articles/published.json',
      article('Polls open', 'draft'),
    );
    await newsroom.indexing();
    let events = await eventsAfter(before);
    assert.deepEqual(
      events
        .filter((event) => event.kind === 'withdrawn')
        .map(({ kind, path }) => ({ kind, path })),
      [{ kind: 'withdrawn', path: 'articles/published' }],
      `announced as withdrawn, not removed, since the card still exists: ${JSON.stringify(events)}`,
    );
    let quiet = await head();
    await newsroom.write(
      'articles/published.json',
      article('Polls open again', 'draft'),
    );
    await newsroom.indexing();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.strictEqual(await head(), quiet, 'and not again while unreadable');
  });

  test('the poll is the same for every caller and a shared cache may hold it for a second', async function (assert) {
    let response = await feedWindow();
    assert.strictEqual(response.status, 200, response.text);
    assert.strictEqual(
      response.headers['cache-control'],
      'public, max-age=1, stale-while-revalidate=1',
    );
    let body = response.body as FeedEventWindow;
    assert.strictEqual(body.v, 1, 'says which version of the wire it is');
    assert.strictEqual(typeof body.epoch, 'string', 'names its epoch');
    assert.strictEqual(typeof body.head, 'number', 'and its head');
  });

  test('the stream delivers changes as they land and replays from Last-Event-ID', async function (assert) {
    let address = server.address();
    let port = typeof address === 'object' && address ? address.port : 4444;
    let url = `http://127.0.0.1:${port}/newsroom/_live`;
    let controller = new AbortController();
    let response = await fetch(url, {
      headers: {
        Accept: SupportedMimeType.EventStream,
        'X-Forwarded-For': VISITOR,
      },
      signal: controller.signal,
    });
    assert.strictEqual(response.status, 200);
    assert.true(
      response.headers.get('content-type')?.startsWith('text/event-stream'),
      'served as an event stream',
    );
    let reader = response.body!.getReader();
    let text = '';
    let read = async (until: (text: string) => boolean) => {
      let deadline = Date.now() + 10_000;
      while (!until(text) && Date.now() < deadline) {
        let chunk = await Promise.race([
          reader.read(),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), 500),
          ),
        ]);
        if (chunk && !chunk.done) {
          text += new TextDecoder().decode(chunk.value);
        }
      }
      return text;
    };
    await read((t) => t.includes('retry:'));
    await newsroom.write(
      'articles/published.json',
      article('Polls open live', 'published'),
    );
    await newsroom.indexing();
    await read((t) => t.includes('articles/published'));
    controller.abort();
    let match = text.match(/^id: (\S+)$/m);
    assert.ok(match, `the stream sent an event: ${text}`);
    let data = text.match(/^data: (.+)$/m)?.[1];
    let event = JSON.parse(data!) as FeedEvent;
    assert.strictEqual(event.path, 'articles/published');

    let [epoch, seq] = match![1].split(':');
    let replay = await fetch(url, {
      headers: {
        Accept: SupportedMimeType.EventStream,
        'X-Forwarded-For': VISITOR,
        'Last-Event-ID': `${epoch}:${Number(seq) - 1}`,
      },
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
    let replayed = '';
    if (replay?.body) {
      let replayReader = replay.body.getReader();
      let chunk = await replayReader.read();
      replayed += new TextDecoder().decode(chunk.value);
      if (!replayed.includes('articles/published')) {
        chunk = await replayReader.read();
        replayed += new TextDecoder().decode(chunk.value);
      }
      await replayReader.cancel();
    }
    assert.true(
      replayed.includes(`id: ${epoch}:${seq}`),
      `a reconnecting client gets what it missed: ${replayed}`,
    );

    let stale = await fetch(url, {
      headers: {
        Accept: SupportedMimeType.EventStream,
        'X-Forwarded-For': VISITOR,
        'Last-Event-ID': 'another-epoch:3',
      },
      signal: AbortSignal.timeout(3_000),
    });
    let staleReader = stale.body!.getReader();
    let first = '';
    while (!first.includes('"kind":"reset"')) {
      let chunk = await staleReader.read();
      if (chunk.done) break;
      first += new TextDecoder().decode(chunk.value);
    }
    await staleReader.cancel();
    assert.true(
      first.includes('"kind":"reset"'),
      'a client from another epoch is told to reset',
    );
  });

  function readCard(path: string, realm = NEWSROOM) {
    return request
      .get(`${new URL(realm).pathname}${path}`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
  }

  test('a signed-out read the policy admits may be held by a shared cache, and a signed-in one may not', async function (assert) {
    // Every caller who isn't signed in is the same caller to the policy, so
    // they all get the same document (ADR 020 §1.5).
    let anonymous = await readCard('articles/published');
    assert.strictEqual(anonymous.status, 200, anonymous.text);
    assert.strictEqual(
      anonymous.headers['cache-control'],
      'public, max-age=0, must-revalidate',
    );
    let vary = (anonymous.headers['vary'] ?? '')
      .split(',')
      .map((name: string) => name.trim().toLowerCase());
    assert.true(
      vary.includes('authorization'),
      `a cache holding it answers only another caller without credentials: ${anonymous.headers['vary']}`,
    );
    assert.true(
      vary.includes('x-boxel-site'),
      `nor a caller visiting through a site, which may be answered differently: ${anonymous.headers['vary']}`,
    );
    let head = await request
      .head(`${new URL(NEWSROOM).pathname}articles/published`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    assert.strictEqual(
      head.headers['cache-control'],
      'public, max-age=0, must-revalidate',
      'a HEAD states what the GET sends',
    );

    let signedIn = await readCard('articles/published').set(
      'Authorization',
      `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
    );
    assert.strictEqual(signedIn.status, 200, signedIn.text);
    assert.strictEqual(
      signedIn.headers['cache-control'],
      'private, max-age=0, must-revalidate',
      "a signed-in caller's read stays private",
    );
  });

  test("an indexed change names the card's revision, and a read at that revision may be held for a long time", async function (assert) {
    let start = await head();
    await newsroom.write(
      'articles/published.json',
      article('Polls open at last', 'published'),
    );
    await newsroom.indexing();
    let indexed: FeedEvent | undefined;
    let deadline = Date.now() + 10_000;
    while (!indexed && Date.now() < deadline) {
      indexed = (await eventsAfter(start)).find(
        (event) =>
          event.kind === 'indexed' &&
          event.path === 'articles/published' &&
          event.rev,
      );
      if (!indexed) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(indexed?.rev, `the indexed event names a revision`);
    let rev = indexed!.rev!;
    assert.false(
      JSON.stringify(indexed).includes('Polls open at last'),
      'which carries no card content',
    );

    let current = await readCard(
      `articles/published?rev=${encodeURIComponent(rev)}`,
    );
    assert.strictEqual(current.status, 200, current.text);
    assert.strictEqual(
      current.headers['etag'],
      `"${rev}"`,
      'the revision is the validator the read carries',
    );
    assert.strictEqual(
      current.headers['cache-control'],
      'public, max-age=0, s-maxage=30, must-revalidate',
      'a shared cache holds the current revision briefly, then asks again',
    );
    assert.strictEqual(
      current.body.data.attributes.headline,
      'Polls open at last',
    );

    let stale = await readCard('articles/published?rev=an-older-revision');
    assert.strictEqual(stale.status, 200, stale.text);
    assert.strictEqual(
      stale.headers['cache-control'],
      'public, max-age=0, must-revalidate',
      'another revision is answered with the card as it is, cached as usual',
    );

    let signedIn = await readCard(
      `articles/published?rev=${encodeURIComponent(rev)}`,
    ).set(
      'Authorization',
      `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
    );
    assert.strictEqual(
      signedIn.headers['cache-control'],
      'private, max-age=0, must-revalidate',
      "a signed-in caller's read stays private at any revision",
    );
  });

  test('a writer may ask the pages following the feed to reload, at most once a minute', async function (assert) {
    let refresh = () =>
      request
        .post(`${new URL(NEWSROOM).pathname}_live/refresh`)
        .set('Accept', SupportedMimeType.JSON);

    let visitor = await refresh().set('X-Forwarded-For', VISITOR);
    assert.strictEqual(
      visitor.status,
      401,
      `a visitor who isn't signed in may not ask: ${visitor.text}`,
    );

    let before = await head();
    let asked = await refresh().set(
      'Authorization',
      `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
    );
    assert.strictEqual(asked.status, 202, asked.text);
    let events = (await feedWindow()).body as FeedEventWindow;
    assert.deepEqual(
      events.events.filter((event) => event.seq > before),
      [{ v: 1, seq: before + 1, kind: 'refresh', path: '' }],
      'the feed carries the request and nothing else about it',
    );

    let again = await refresh().set(
      'Authorization',
      `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
    );
    assert.strictEqual(again.status, 429, again.text);
    assert.ok(
      Number(again.headers['retry-after']) > 0,
      'and says when another is accepted',
    );
    assert.strictEqual(await head(), before + 1, 'the refused one is not sent');
  });

  test('a change made through an operation names that operation, on its write and its index pass', async function (assert) {
    await newsroom.write(
      'articles/published.json',
      article('Polls open', 'published'),
    );
    await newsroom.indexing();
    let before = await head();
    let invoked = await request
      .post(`${new URL(NEWSROOM).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
      )
      .send({
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': 'retitle',
            href: `${NEWSROOM}articles/published`,
            data: { headline: 'Polls open at dawn' },
          },
        ],
      });
    assert.strictEqual(invoked.status, 200, invoked.text);
    let events = await eventsAfter(before, 2);
    let mine = events.filter((event) => event.path === 'articles/published');
    assert.deepEqual(
      mine.map(({ kind, operation }) => ({ kind, operation })),
      [
        { kind: 'written', operation: { name: 'retitle', base: 'transform' } },
        { kind: 'indexed', operation: { name: 'retitle', base: 'transform' } },
      ],
      `both events name the operation: ${JSON.stringify(events)}`,
    );
    assert.false(
      JSON.stringify(events).includes('Polls open at dawn'),
      "no event carries the operation's parameters",
    );
    assert.false(
      JSON.stringify(events).includes(EDITOR),
      'no event names who ran it',
    );
  });

  test("a read carries the feed's position, and a batch's response the contiguous range its changes took", async function (assert) {
    await newsroom.write('articles/first.json', article('First', 'published'));
    await newsroom.write(
      'articles/second.json',
      article('Second', 'published'),
    );
    await newsroom.indexing();
    // Let the feed finish announcing both cards' index passes.
    let deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      let indexed = ((await feedWindow()).body as FeedEventWindow).events
        .filter((event) => event.kind === 'indexed')
        .map((event) => event.path);
      if (
        indexed.includes('articles/first') &&
        indexed.includes('articles/second')
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    let read = await request
      .get(`${new URL(NEWSROOM).pathname}articles/first`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    assert.strictEqual(read.status, 200, read.text);
    let window = (await feedWindow()).body as FeedEventWindow;
    assert.strictEqual(
      read.headers['boxel-feed-position'],
      `${window.epoch}:${window.head}`,
      'a read names where the feed stood',
    );

    let before = window.head;
    let invoked = await request
      .post(`${new URL(NEWSROOM).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
      )
      .send({
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': 'retitle',
            href: `${NEWSROOM}articles/first`,
            data: { headline: 'First, again' },
          },
          {
            op: 'invoke',
            'boxel:name': 'retitle',
            href: `${NEWSROOM}articles/second`,
            data: { headline: 'Second, again' },
          },
        ],
      });
    assert.strictEqual(invoked.status, 200, invoked.text);
    let written = (await eventsAfter(before, 2)).filter(
      (event) => event.kind === 'written',
    );
    assert.deepEqual(written.map((event) => event.path).sort(), [
      'articles/first',
      'articles/second',
    ]);
    let [first, last] = [written[0]!.seq, written[written.length - 1]!.seq];
    assert.strictEqual(last - first, 1, 'the two changes are adjacent');
    assert.strictEqual(
      invoked.headers['boxel-feed-position'],
      `${window.epoch}:${first}-${last}`,
      'the response names the range',
    );
  });

  test("a card's channel answers only for a card a visitor may read, and carries the card's own changes", async function (assert) {
    let channel = (path: string) =>
      request
        .get(`${new URL(NEWSROOM).pathname}_live`)
        .query({ channel: path })
        .set('Accept', SupportedMimeType.JSON)
        .set('X-Forwarded-For', VISITOR);

    let draft = await channel('articles/draft');
    assert.strictEqual(
      draft.status,
      404,
      'a draft has no channel a visitor can follow',
    );
    let escape = await channel('../elsewhere/Card/1');
    assert.strictEqual(escape.status, 404, 'a path out of the realm has none');

    let opened = await channel('articles/published');
    assert.strictEqual(opened.status, 200, opened.text);
    let window = opened.body as FeedEventWindow;
    assert.deepEqual(
      window.events.filter((event) => event.kind !== 'reset'),
      [],
      'a new channel carries nothing but, perhaps, the realm feed starting',
    );
    assert.strictEqual(window.from, 0);

    await newsroom.write(
      'articles/published.json',
      article('Polls open early', 'published'),
    );
    await newsroom.indexing();
    let deadline = Date.now() + 10_000;
    let kinds: string[] = [];
    while (Date.now() < deadline) {
      kinds = (
        (await channel('articles/published')).body as FeedEventWindow
      ).events
        .filter((event) => event.kind !== 'reset')
        .map((event) => `${event.kind} ${event.path}`);
      if (kinds.includes('indexed articles/published')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(
      kinds,
      ['written articles/published', 'indexed articles/published'],
      'the channel carries the change the realm feed announced',
    );
    let other = (await channel('articles/published')).body as FeedEventWindow;
    assert.notStrictEqual(
      other.epoch,
      ((await feedWindow()).body as FeedEventWindow).epoch,
      'and keeps a sequence of its own',
    );
  });

  test("a visitor's emit lands on the card's channel, the latest per key, and writes nothing", async function (assert) {
    let cheer = (reader: string, mood: string) =>
      request
        .post(`${new URL(NEWSROOM).pathname}_operations`)
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set('X-Forwarded-For', VISITOR)
        .send({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': 'cheer',
              href: `${NEWSROOM}articles/published`,
              data: { reader, mood },
            },
          ],
        });
    let feedBefore = await head();

    let first = await cheer('ana', 'happy');
    assert.strictEqual(first.status, 200, first.text);
    let changed = await cheer('ana', 'thrilled');
    assert.strictEqual(changed.status, 200, changed.text);
    let other = await cheer('ben', 'calm');
    assert.strictEqual(other.status, 200, other.text);

    let channel = (
      await request
        .get(`${new URL(NEWSROOM).pathname}_live`)
        .query({ channel: 'articles/published' })
        .set('Accept', SupportedMimeType.JSON)
        .set('X-Forwarded-For', VISITOR)
    ).body as FeedEventWindow;
    assert.deepEqual(
      channel.events
        .filter((event) => event.kind === 'message')
        .map(({ key, body, operation }) => ({ key, body, operation })),
      [
        {
          key: 'ana',
          body: { reader: 'ana', mood: 'thrilled' },
          operation: { name: 'cheer', base: 'emit' },
        },
        {
          key: 'ben',
          body: { reader: 'ben', mood: 'calm' },
          operation: { name: 'cheer', base: 'emit' },
        },
      ],
      "ana's change replaces her first cheer",
    );
    let emitted = (first.body as any)['atomic:results'][0];
    assert.strictEqual(
      emitted.data.meta.position,
      `${channel.epoch}:1`,
      'the response names where the message landed on the channel',
    );
    assert.strictEqual(
      await head(),
      feedBefore,
      "the realm's own feed hears nothing: no card changed",
    );

    let draft = await request
      .post(`${new URL(NEWSROOM).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('X-Forwarded-For', VISITOR)
      .send({
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': 'cheer',
            href: `${NEWSROOM}articles/draft`,
            data: { reader: 'ana', mood: 'curious' },
          },
        ],
      });
    assert.notStrictEqual(
      draft.status,
      200,
      `the policy admits no cheer on a draft: ${draft.text}`,
    );
  });

  test("a card's revision changes when the permissions or policy that admit it do", async function (assert) {
    let read = () =>
      request
        .get(`${new URL(NEWSROOM).pathname}articles/published`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-Forwarded-For', VISITOR);
    let before = (await read()).headers['etag'];
    assert.ok(before, "a visitor's read carries a validator");
    assert.strictEqual((await read()).headers['etag'], before, 'a stable one');

    let patched = await request
      .patch(`${new URL(NEWSROOM).pathname}_permissions`)
      .set('Accept', 'application/vnd.api+json')
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
      )
      .send({
        data: {
          id: NEWSROOM,
          type: 'permissions',
          attributes: { permissions: { '@reader:localhost': ['read'] } },
        },
      });
    assert.strictEqual(patched.status, 200, patched.text);
    let afterPermissions = (await read()).headers['etag'];
    assert.notStrictEqual(
      afterPermissions,
      before,
      'new permissions make a new revision',
    );

    await org.write(
      'policies/newsroom.json',
      policyCard(`${NEWSROOM}article`, [
        { operation: 'read', ...PUBLISHED_TO_ANONYMOUS },
      ]),
    );
    await org.indexing();
    let deadline = Date.now() + 10_000;
    let afterPolicy = afterPermissions;
    while (afterPolicy === afterPermissions && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      afterPolicy = (await read()).headers['etag'];
    }
    assert.notStrictEqual(
      afterPolicy,
      afterPermissions,
      'and so does a new policy',
    );
  });

  test("a visitor's read at the card's current revision costs no budget; one at an old revision does", async function (assert) {
    await newsroom.write('realm.json', newsroomConfig(2));
    await newsroom.indexing();
    let read = (query: Record<string, string> = {}) =>
      request
        .get(`${new URL(NEWSROOM).pathname}articles/published`)
        .query(query)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-Forwarded-For', VISITOR);
    let first = await read();
    assert.strictEqual(first.status, 200, first.text);
    let rev = cardRevisionOf(first.headers['etag'])!;
    assert.strictEqual((await read()).status, 200, 'the second read fits');
    assert.strictEqual(
      (await read()).status,
      429,
      'a third plain read is over the limit',
    );
    for (let i = 0; i < 3; i++) {
      let reread = await read({ rev });
      assert.strictEqual(
        reread.status,
        200,
        `a re-read at the current revision is served: ${reread.text}`,
      );
    }
    assert.strictEqual(
      (await read({ rev: 'not-a-revision' })).status,
      429,
      'a read naming any other revision is counted as any read is',
    );
    assert.strictEqual(
      (await read({ rev, bust: '1' })).status,
      429,
      'and so is one that adds anything to the URL the feed hands out',
    );
    // Not the card document: whatever the realm answers it with, the
    // exemption doesn't serve it.
    let asJSON = await request
      .get(`${new URL(NEWSROOM).pathname}articles/published`)
      .query({ rev })
      .set('Accept', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR);
    assert.notStrictEqual(
      asJSON.status,
      200,
      `nor one that asks for anything but the card document: ${asJSON.status}`,
    );
  });

  test("a card's revision is the same whichever kind of request came before it", async function (assert) {
    let owner = `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`;
    // Readable by anyone, so a visitor's read is judged from `*` alone.
    let patched = await request
      .patch(`${new URL(NEWSROOM).pathname}_permissions`)
      .set('Accept', 'application/vnd.api+json')
      .set('Authorization', owner)
      .send({
        data: {
          id: NEWSROOM,
          type: 'permissions',
          attributes: { permissions: { '*': ['read'] } },
        },
      });
    assert.strictEqual(patched.status, 200, patched.text);
    let before = (await readCard('articles/published')).headers['etag'];
    assert.ok(before, "a visitor's read carries a validator");
    let owners = await request
      .get(`${new URL(NEWSROOM).pathname}_permissions`)
      .set('Accept', 'application/vnd.api+json')
      .set('Authorization', owner);
    assert.strictEqual(owners.status, 200, owners.text);
    assert.strictEqual(
      (await readCard('articles/published')).headers['etag'],
      before,
      "an owner's request between two reads changes no card's revision",
    );
  });

  test("a channel's stream ends when its card is withdrawn", async function (assert) {
    // Announced as readable first: the feed withdraws only a card it
    // announced.
    let start = await head();
    await newsroom.write(
      'articles/published.json',
      article('Polls open early', 'published'),
    );
    await newsroom.indexing();
    await eventsAfter(start, 2);
    let address = server.address();
    let port = typeof address === 'object' && address ? address.port : 4444;
    let url = `http://127.0.0.1:${port}/newsroom/_live?channel=${encodeURIComponent('articles/published')}`;
    let response = await fetch(url, {
      headers: {
        Accept: SupportedMimeType.EventStream,
        'X-Forwarded-For': VISITOR,
      },
      signal: AbortSignal.timeout(20_000),
    });
    assert.strictEqual(response.status, 200);
    let reader = response.body!.getReader();
    let text = '';
    let ended = false;
    let pump = (async () => {
      for (;;) {
        let chunk = await reader.read();
        if (chunk.done) {
          ended = true;
          return;
        }
        text += new TextDecoder().decode(chunk.value);
      }
    })().catch(() => undefined);
    await newsroom.write(
      'articles/published.json',
      article('Polls open', 'draft'),
    );
    await newsroom.indexing();
    let deadline = Date.now() + 15_000;
    while (!ended && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.true(ended, `the stream ended: ${text}`);
    assert.true(
      text.includes('"kind":"withdrawn"'),
      'after telling the page the card is withdrawn',
    );
    await pump;
    let again = await request
      .get(`${new URL(NEWSROOM).pathname}_live`)
      .query({ channel: 'articles/published' })
      .set('Accept', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR);
    assert.strictEqual(
      again.status,
      404,
      'and the channel answers as not found',
    );
  });

  test('every spelling of a card names one channel, and anything that is not a card names none', async function (assert) {
    let channel = (path: string) =>
      request
        .get(`${new URL(NEWSROOM).pathname}_live`)
        .query({ channel: path })
        .set('Accept', SupportedMimeType.JSON)
        .set('X-Forwarded-For', VISITOR);
    for (let path of [
      'articles/published?x=1',
      'articles/published#x',
      'articles/../_live',
      '\\\\elsewhere/articles/published',
      'articles/',
    ]) {
      assert.strictEqual(
        (await channel(path)).status,
        404,
        `${path} names no channel`,
      );
    }
    let plain = (await channel('articles/published')).body as FeedEventWindow;
    let spelled = (await channel('articles/./published.json'))
      .body as FeedEventWindow;
    assert.strictEqual(
      spelled.epoch,
      plain.epoch,
      'another spelling of the card is the same channel',
    );
    let rows = (await feedDbAdapter.execute(
      `SELECT feed_key FROM realm_feeds WHERE feed_key LIKE '%#%'`,
    )) as { feed_key: string }[];
    assert.deepEqual(
      rows.map((row) => row.feed_key),
      [channelFeedKey(NEWSROOM, 'articles/published')],
      'and only that one is stored',
    );
  });

  test('an edit to the policy card resets the feed, since what a visitor may read can have changed', async function (assert) {
    // A read first, so the realm has compiled its policy.
    await request
      .get(`${new URL(NEWSROOM).pathname}articles/published`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    let before = await head();
    await org.write(
      'policies/newsroom.json',
      policyCard(`${NEWSROOM}article`, [
        { operation: 'read', ...PUBLISHED_TO_ANONYMOUS },
      ]),
    );
    await org.indexing();
    let events = await eventsAfter(before);
    assert.ok(
      events.some((event) => event.kind === 'reset'),
      `the feed resets: ${JSON.stringify(events)}`,
    );
  });

  test('a stream past the cap is turned away with 503 and when to try again, and the poll still answers', async function (assert) {
    newsroom.eventFeedStreamCap = 0;
    let stream = await request
      .get(`${new URL(NEWSROOM).pathname}_live`)
      .set('Accept', 'text/event-stream')
      .set('X-Forwarded-For', VISITOR);
    assert.strictEqual(stream.status, 503, stream.text);
    assert.ok(Number(stream.headers['retry-after']) > 0, 'says when');
    assert.strictEqual(
      (await feedWindow()).status,
      200,
      'the poll a shared cache absorbs is still there',
    );
  });

  test('a card computed from another is announced when that one changes, at a revision that reads the new value', async function (assert) {
    await newsroom.write(
      'digests/today.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { headline: 'Today', status: 'published' },
          relationships: {
            lead: { links: { self: '../articles/published' } },
          },
          meta: { adoptsFrom: { module: '../article', name: 'Digest' } },
        },
      }),
    );
    await newsroom.indexing();
    let before = await head();
    await newsroom.write(
      'articles/published.json',
      article('Polls stay open late', 'published'),
    );
    await newsroom.indexing();
    let deadline = Date.now() + 15_000;
    let digest: FeedEvent | undefined;
    while (!digest && Date.now() < deadline) {
      digest = (await eventsAfter(before, 1)).find(
        (event) => event.kind === 'indexed' && event.path === 'digests/today',
      );
      if (!digest) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.ok(digest?.rev, 'the digest is announced with a revision');
    let read = await request
      .get(`${new URL(NEWSROOM).pathname}digests/today`)
      .query({ rev: digest!.rev! })
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR);
    assert.strictEqual(read.status, 200, read.text);
    assert.strictEqual(
      read.body.data.attributes.leadHeadline,
      'Polls stay open late',
      'reading it at that revision brings the recomputed value',
    );
  });

  test("a transform that collects an emit's messages writes them into the card, the latest per key", async function (assert) {
    let invoke = (
      name: string,
      data: Record<string, unknown>,
      auth?: string,
    ) => {
      let req = request
        .post(`${new URL(NEWSROOM).pathname}_operations`)
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations);
      req = auth
        ? req.set('Authorization', auth)
        : req.set('X-Forwarded-For', VISITOR);
      return req.send({
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': name,
            href: `${NEWSROOM}articles/published`,
            data,
          },
        ],
      });
    };
    for (let [reader, mood] of [
      ['ana', 'happy'],
      ['ben', 'calm'],
      ['ana', 'thrilled'],
    ]) {
      let cheered = await invoke('cheer', { reader, mood });
      assert.strictEqual(cheered.status, 200, cheered.text);
    }
    let editor = `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`;
    let tallied = await invoke('tally', {}, editor);
    assert.strictEqual(tallied.status, 200, tallied.text);
    let forged = await invoke(
      'tally',
      { cheers: [{ reader: 'mallory' }] },
      editor,
    );
    assert.strictEqual(
      forged.status,
      400,
      `a caller can't supply what the channel holds: ${forged.text}`,
    );
    await newsroom.indexing();
    let read = await request
      .get(`${new URL(NEWSROOM).pathname}articles/published`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', editor);
    assert.deepEqual(
      [...read.body.data.attributes.cheerers].sort(),
      ['ana', 'ben'],
      'each reader once: the latest cheer per key',
    );
  });

  test("presence takes no position on the card's channel, reaches its followers, and a transform collects who is here", async function (assert) {
    let invoke = (
      name: string,
      data: Record<string, unknown>,
      auth?: string,
    ) => {
      let req = request
        .post(`${new URL(NEWSROOM).pathname}_operations`)
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations);
      req = auth
        ? req.set('Authorization', auth)
        : req.set('X-Forwarded-For', VISITOR);
      return req.send({
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': name,
            href: `${NEWSROOM}articles/published`,
            data,
          },
        ],
      });
    };
    let window = async () =>
      (
        await request
          .get(`${new URL(NEWSROOM).pathname}_live`)
          .query({ channel: 'articles/published' })
          .set('Accept', SupportedMimeType.JSON)
          .set('X-Forwarded-For', VISITOR)
      ).body as FeedEventWindow;
    let before = await window();

    for (let reader of ['ana', 'ben', 'ana']) {
      let here = await invoke('here', { reader });
      assert.strictEqual(here.status, 200, here.text);
    }

    let after = await window();
    assert.strictEqual(
      after.head,
      before.head,
      "presence takes no position on the channel, so its head doesn't move",
    );
    assert.notOk(
      after.events.some((event) => event.operation?.name === 'here'),
      "and isn't in the channel's ordered window",
    );

    let address = server.address();
    let port = typeof address === 'object' && address ? address.port : 4444;
    let controller = new AbortController();
    let response = await fetch(
      `http://127.0.0.1:${port}${new URL(NEWSROOM).pathname}_live?channel=articles/published`,
      {
        headers: {
          Accept: SupportedMimeType.EventStream,
          'X-Forwarded-For': VISITOR,
        },
        signal: controller.signal,
      },
    );
    assert.strictEqual(response.status, 200);
    let reader = response.body!.getReader();
    let text = '';
    let framesIn = () =>
      text
        .split('\n\n')
        .map((block) => ({
          id: block.match(/^id: (.+)$/m)?.[1],
          data: JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? 'null'),
        }))
        .filter((frame) => frame.data) as {
        id?: string;
        data: FeedEvent;
      }[];
    let stream = {
      until: async (done: (frames: ReturnType<typeof framesIn>) => boolean) => {
        let deadline = Date.now() + 10_000;
        while (!done(framesIn()) && Date.now() < deadline) {
          let chunk = await Promise.race([
            reader.read(),
            new Promise<undefined>((resolve) =>
              setTimeout(() => resolve(undefined), 500),
            ),
          ]);
          if (chunk && !chunk.done) {
            text += new TextDecoder().decode(chunk.value);
          }
        }
        return framesIn();
      },
      close: () => controller.abort(),
    };
    try {
      let heard = await stream.until((frames) =>
        ['ana', 'ben'].every((reader) =>
          frames.some(
            (frame) =>
              frame.data.operation?.name === 'here' &&
              frame.data.key === reader,
          ),
        ),
      );
      let presenceFrames = heard.filter(
        (frame) => frame.data.operation?.name === 'here',
      );
      assert.ok(
        presenceFrames.every(
          (frame) => frame.id === undefined && frame.data.unordered === true,
        ),
        'a page that starts following hears who is here, without positions',
      );
      let late = await invoke('here', { reader: 'cy' });
      assert.strictEqual(late.status, 200, late.text);
      await stream.until((frames) =>
        frames.some(
          (frame) =>
            frame.data.operation?.name === 'here' && frame.data.key === 'cy',
        ),
      );
      assert.ok(true, 'and hears a newcomer as they arrive');
    } finally {
      stream.close();
    }

    let editor = `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`;
    let rolled = await invoke('rollCall', {}, editor);
    assert.strictEqual(rolled.status, 200, rolled.text);
    await newsroom.indexing();
    let read = await request
      .get(`${new URL(NEWSROOM).pathname}articles/published`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', editor);
    assert.deepEqual(
      read.body.data.attributes.present,
      ['ana', 'ben', 'cy'],
      'the transform collects each reader once',
    );
  });

  test("a change to the realm's permissions resets the feed, since any card's readability may have moved", async function (assert) {
    let before = await head();
    let patched = await request
      .patch(`${new URL(NEWSROOM).pathname}_permissions`)
      .set('Accept', 'application/vnd.api+json')
      .set(
        'Authorization',
        `Bearer ${createJWT(newsroom, EDITOR, ['read', 'write', 'realm-owner'])}`,
      )
      .send({
        data: {
          id: NEWSROOM,
          type: 'permissions',
          attributes: { permissions: { '@reader:localhost': ['read'] } },
        },
      });
    assert.strictEqual(patched.status, 200, patched.text);
    let events = await eventsAfter(before);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['reset'],
      'every client is told to revalidate what it holds',
    );
  });

  test('a realm whose policy opens nothing to callers who are not signed in refuses them its feed', async function (assert) {
    let response = await feedWindow(LIBRARY);
    assert.strictEqual(response.status, 401, response.text);
  });
});

// The feed on its own, with the readability check stood in for.
module(`${basename(import.meta.filename)} > RealmEventFeed`, function () {
  const REALM = 'http://feed.test/realm/';

  function changed(...paths: string[]) {
    return {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: paths.map((path) => new URL(path, REALM).href),
      realmURL: REALM,
    } as const;
  }

  test('a check that fails resets the feed rather than dropping the change', async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => {
      throw new Error('the gate could not be asked');
    });
    await feed.ingest(changed('Card/1'));
    assert.deepEqual((await feed.window()).events, [
      { v: 1, seq: 1, kind: 'reset', path: '', spread: 250 },
    ]);
  });

  test('an event that changes more cards than are judged one by one resets the feed', async function (assert) {
    let checked = 0;
    let feed = new RealmEventFeed(REALM, async () => {
      checked++;
      return {};
    });
    let paths = Array.from(
      { length: EVENT_FEED_MAX_CHECKS_PER_EVENT + 1 },
      (_, i) => `Card/${i}`,
    );
    await feed.ingest(changed(...paths));
    assert.strictEqual(checked, 0, 'no card is read');
    assert.deepEqual((await feed.window()).events, [
      { v: 1, seq: 1, kind: 'reset', path: '', spread: 250 },
    ]);
  });

  test("an event names the changed cards' types without naming the realm's address", async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => ({}));
    await feed.ingest({
      ...changed('Card/1'),
      invalidatedTypes: [
        new URL('article/Article', REALM).href,
        '@cardstack/base/card-api/CardDef',
      ],
    } as never);
    assert.deepEqual((await feed.window()).events[0].types, [
      'article/Article',
      '@cardstack/base/card-api/CardDef',
    ]);
  });

  test("a type from another realm's address drops the types, rather than naming that address", async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => ({}));
    await feed.ingest({
      ...changed('Card/1'),
      invalidatedTypes: [
        new URL('article/Article', REALM).href,
        'http://elsewhere.test/library/book/Book',
      ],
    } as never);
    assert.strictEqual((await feed.window()).events[0].types, undefined);
  });

  test('a change written by an operation names it, on its write and on its index pass', async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => ({ rev: 'r1' }));
    let card = new URL('Game/1', REALM).href;
    await feed.ingest(
      {
        eventName: 'update',
        updated: ['Game/1.json'],
        realmURL: REALM,
      } as never,
      { [card]: { name: 'answer', base: 'transform' } },
    );
    await feed.ingest(changed('Game/1'));
    assert.deepEqual(
      (await feed.window()).events.map(({ kind, operation }) => ({
        kind,
        operation,
      })),
      [
        { kind: 'written', operation: { name: 'answer', base: 'transform' } },
        { kind: 'indexed', operation: { name: 'answer', base: 'transform' } },
      ],
    );
  });

  test('a removal that ran no named operation is named by its base', async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => ({}));
    await feed.ingest(changed('Game/1'));
    await feed.ingest({
      eventName: 'update',
      removed: ['Game/1.json'],
      realmURL: REALM,
    } as never);
    let removed = (await feed.window()).events.find(
      (e) => e.kind === 'removed',
    );
    assert.deepEqual(removed?.operation, { name: 'delete', base: 'delete' });
  });

  test("a change to the realm's config resets the feed, since it names the policy", async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => ({}));
    await feed.ingest({
      eventName: 'update',
      updated: ['realm.json'],
      realmURL: REALM,
    } as never);
    assert.deepEqual((await feed.window()).events, [
      { v: 1, seq: 1, kind: 'reset', path: '', spread: 250 },
    ]);
  });
});

module(`${basename(import.meta.filename)} > stored feed`, function (hooks) {
  const REALM = 'http://feed.test/stored/';
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  function feed() {
    return new RealmEventFeed(
      REALM,
      async () => ({}),
      new DbFeedStore(dbAdapter),
    );
  }

  function changed(path: string) {
    return {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [new URL(path, REALM).href],
      realmURL: REALM,
    } as RealmEventContent;
  }

  test('a feed found stored keeps its epoch and positions, and announces no reset', async function (assert) {
    let first = feed();
    await first.ingest(changed('Card/1'));
    await first.ingest(changed('Card/2'));
    let before = await first.window();

    let restarted = feed();
    let after = await restarted.window();
    assert.strictEqual(after.epoch, before.epoch, 'the epoch carries on');
    assert.deepEqual(
      after.events.map(({ seq, kind, path }) => ({ seq, kind, path })),
      [
        { seq: 1, kind: 'indexed', path: 'Card/1' },
        { seq: 2, kind: 'indexed', path: 'Card/2' },
      ],
      'what was announced before is still there to resume from, and nothing is reset',
    );
    assert.deepEqual(
      (await restarted.replay(`${before.epoch}:1`)).map((event) => event.seq),
      [2],
      'a client that held position 1 resumes from it',
    );
  });

  test('a removal is announced whichever feed announced the card, and after a reset', async function (assert) {
    let one = feed();
    let two = feed();
    await one.ingest(changed('Card/1'));
    await one.ingest(changed('Card/2'));
    await two.ready();
    await two.ingest({
      eventName: 'update',
      removed: ['Card/1.json'],
      realmURL: REALM,
    } as RealmEventContent);
    two.reset();
    await two.settled();
    await two.ingest({
      eventName: 'update',
      removed: ['Card/2.json', 'Card/never-announced.json'],
      realmURL: REALM,
    } as RealmEventContent);
    let window = await two.window();
    assert.deepEqual(
      window.events
        .filter((event) => event.kind !== 'indexed')
        .map(({ kind, path }) => ({ kind, path })),
      [
        { kind: 'removed', path: 'Card/1' },
        { kind: 'reset', path: '' },
        { kind: 'removed', path: 'Card/2' },
      ],
      'both removals are announced by the feed that never announced the cards, and a card never announced as readable is not named',
    );
    await two.ingest({
      eventName: 'update',
      removed: ['Card/1.json'],
      realmURL: REALM,
    } as RealmEventContent);
    assert.strictEqual(
      (await two.window()).head,
      window.head,
      'and a card already announced removed is not announced again',
    );
  });

  test('a card that stops being readable is withdrawn by a feed that never announced it', async function (assert) {
    let one = feed();
    await one.ingest(changed('Card/1'));
    let two = new RealmEventFeed(
      REALM,
      async () => false,
      new DbFeedStore(dbAdapter),
    );
    await two.ingest(changed('Card/1'));
    await two.ingest(changed('Card/9'));
    let events = (await two.window()).events.filter((event) => event.seq > 1);
    assert.deepEqual(
      events.map(({ kind, path }) => ({ kind, path })),
      [{ kind: 'withdrawn', path: 'Card/1' }],
    );
  });

  test('a feed that falls further behind than the store keeps tells its clients to reset', async function (assert) {
    let one = feed();
    await one.ingest(changed('Card/1'));
    let heard: FeedEvent[] = [];
    one.subscribe((event) => heard.push(event));
    let store = new DbFeedStore(dbAdapter);
    let count = EVENT_FEED_WINDOW * 4 + 50;
    await store.append(
      REALM,
      Array.from({ length: count }, (_, i) => ({
        v: 1,
        kind: 'indexed' as const,
        path: `Bulk/${i}`,
      })),
      EVENT_FEED_WINDOW,
    );
    await one.catchUp();
    let reset = heard.find((event) => event.kind === 'reset');
    assert.ok(reset, 'a reset reaches its subscribers');
    assert.strictEqual(
      heard.indexOf(reset!),
      0,
      'before anything after the positions it missed',
    );
    assert.strictEqual(one.head, count + 1, 'and it is at the head');
    let replayed = await one.replay(`${(await one.window()).epoch}:2`);
    assert.deepEqual(
      replayed.map((event) => event.kind),
      ['reset'],
      'a client that held a position it missed is told to reset too',
    );
  });

  test('a feed whose first load fails loads again on the next ask', async function (assert) {
    let failing = true;
    let real = new DbFeedStore(dbAdapter);
    let store: FeedStore = {
      load: async (key, keep) => {
        if (failing) {
          failing = false;
          throw new Error('the database blinked');
        }
        return await real.load(key, keep);
      },
      append: (...args) => real.append(...args),
      appendIfExists: (...args) => real.appendIfExists(...args),
      after: (...args) => real.after(...args),
      latestMessages: (...args) => real.latestMessages(...args),
      wasVisible: (...args) => real.wasVisible(...args),
      claimRefresh: (...args) => real.claimRefresh(...args),
      putPresence: (...args) => real.putPresence(...args),
      presence: (...args) => real.presence(...args),
    };
    let flaky = new RealmEventFeed(REALM, async () => ({}), store);
    await assert.rejects(flaky.position(), /blinked/);
    assert.ok(
      /^[0-9a-f]+:0$/.test(await flaky.position()),
      'the next ask loads the feed',
    );
  });

  test('two feeds on one database give out one sequence, and each hears the other', async function (assert) {
    let one = feed();
    let two = feed();
    await one.ingest(changed('Card/1'));
    await two.ready();
    await two.ingest(changed('Card/2'));
    let heard: number[] = [];
    one.subscribe((event) => heard.push(event.seq));
    await one.catchUp();
    let window = await one.window();
    assert.deepEqual(
      window.events.map(({ seq, kind, path }) => ({ seq, kind, path })),
      [
        { seq: 1, kind: 'indexed', path: 'Card/1' },
        { seq: 2, kind: 'indexed', path: 'Card/2' },
      ],
    );
    assert.deepEqual(heard, [2], 'one passes on what two appended');

    await one.ingest(changed('Card/3'));
    await two.catchUp();
    assert.deepEqual(
      (await two.window()).events.map((event) => event.seq),
      [1, 2, 3],
      'and two hears what one appends after',
    );
  });

  test('a republish inside the cooldown asks its pages to reload once the cooldown is up', async function (assert) {
    let answers: Awaited<ReturnType<Realm['requestEventFeedRefresh']>>[] = [
      { accepted: false, retryAfterMs: 20 },
      { accepted: true },
    ];
    let asked: number[] = [];
    let started = Date.now();
    await refreshAfterRepublish(
      {
        requestEventFeedRefresh: async () => {
          asked.push(Date.now() - started);
          return answers[asked.length - 1]!;
        },
      },
      REALM,
    );
    assert.strictEqual(asked.length, 2, 'asked again');
    assert.ok(asked[1]! >= 20, 'after the wait the realm named');
  });

  test('a refresh accepted by one process is refused by another within the cooldown', async function (assert) {
    let one = feed();
    let two = feed();
    assert.deepEqual(await one.requestRefresh(), { accepted: true });
    let refused = await two.requestRefresh();
    assert.false(refused.accepted, 'the cooldown is stored, not per process');
    if (!refused.accepted) {
      assert.ok(refused.retryAfterMs > 0, 'and says how long to wait');
    }
  });

  test("a channel's window keeps the latest message for each key, however old", async function (assert) {
    let channel = new RealmEventFeed(
      REALM,
      async () => ({}),
      new DbFeedStore(dbAdapter),
      { key: channelFeedKey(REALM, 'Game/1') },
    );
    let pick = (team: string, choice: string) =>
      channel.emit({
        path: 'Game/1',
        operation: { name: 'select', base: 'emit' },
        key: `${team}:1`,
        body: { team, choice },
      });
    await pick('red', 'A');
    await pick('blue', 'C');
    await pick('red', 'B');
    let window = await channel.window();
    assert.deepEqual(
      window.events.map((event) => event.body),
      [
        { team: 'blue', choice: 'C' },
        { team: 'red', choice: 'B' },
      ],
      "red's change replaces red's first pick",
    );
    assert.strictEqual(window.from, 0, 'nothing a client needs was dropped');

    for (let i = 0; i < EVENT_FEED_WINDOW + 10; i++) {
      await channel.emit({
        path: 'Game/1',
        operation: { name: 'cheer', base: 'emit' },
        body: { i },
      });
    }
    let restarted = new RealmEventFeed(
      REALM,
      async () => ({}),
      new DbFeedStore(dbAdapter),
      { key: channelFeedKey(REALM, 'Game/1') },
    );
    let later = await restarted.window();
    let picks = later.events
      .filter((event) => event.key !== undefined)
      .map((event) => event.body);
    assert.deepEqual(
      picks,
      [
        { team: 'blue', choice: 'C' },
        { team: 'red', choice: 'B' },
      ],
      'the picks outlive the window and a restart',
    );
    assert.ok(
      later.from > 0,
      'and the window says the cheers before it are gone',
    );
  });

  test("the messages a transform collects are every key's latest, however many keys there are", async function (assert) {
    let key = channelFeedKey(REALM, 'Game/2');
    let channel = new RealmEventFeed(
      REALM,
      async () => ({}),
      new DbFeedStore(dbAdapter),
      { key },
    );
    await channel.ready();
    let teams = EVENT_FEED_WINDOW + 44;
    await new DbFeedStore(dbAdapter).append(
      key,
      Array.from({ length: teams }, (_, i) => ({
        v: 1,
        kind: 'message' as const,
        path: 'Game/2',
        operation: { name: 'answer', base: 'emit' },
        key: `team-${i}`,
        body: { team: i },
      })),
      EVENT_FEED_WINDOW,
    );
    await channel.catchUp();
    assert.ok(
      (await channel.window()).events.length <= EVENT_FEED_WINDOW,
      'the window in memory holds no more than it keeps',
    );
    let collected = await channel.latestMessages();
    assert.strictEqual(
      collected.length,
      teams,
      'and every answer is collected',
    );
  });

  test('presence is the latest per key until it expires, and is told to every process', async function (assert) {
    let key = channelFeedKey(REALM, 'Room/1');
    let store = new DbFeedStore(dbAdapter);
    let here = (who: string, at: number) => ({
      v: 1,
      seq: 0,
      kind: 'message' as const,
      unordered: true as const,
      path: 'Room/1',
      operation: { name: 'here', base: 'emit' },
      key: who,
      body: { who, at },
    });
    let notices: PresenceNotice[] = [];
    let listening = await dbAdapter.subscribe(
      REALM_PRESENCE_CHANNEL,
      (notification) => {
        notices.push(JSON.parse(notification.payload ?? '{}'));
      },
    );
    try {
      await Promise.all([
        store.putPresence(key, here('ana', 1), 60_000),
        store.putPresence(key, here('ben', 1), 60_000),
        store.putPresence(key, here('gone', 1), 1),
      ]);
      await store.putPresence(key, here('ana', 2), 60_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      let live = await store.presence(key, 'here');
      assert.deepEqual(
        live
          .map((event) => event.body)
          .sort((a: any, b: any) => a.who.localeCompare(b.who)),
        [
          { who: 'ana', at: 2 },
          { who: 'ben', at: 1 },
        ],
        "each key's latest, and none that expired",
      );
      assert.deepEqual(
        await store.presence(key, 'elsewhere'),
        [],
        'only the operation asked for',
      );
      let feed = new RealmEventFeed(REALM, async () => ({}), store, { key });
      await feed.ready();
      assert.strictEqual(feed.head, 0, 'and the channel took no positions');
      for (let attempt = 0; attempt < 50 && notices.length < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.deepEqual(
        notices.map((notice) => [notice.key, notice.event?.key]).sort(),
        [
          [key, 'ana'],
          [key, 'ben'],
          [key, 'gone'],
          [key, 'ana'],
        ].sort(),
        'each write is announced, carrying its message',
      );
    } finally {
      await listening.unsubscribe();
    }
  });

  test("an emit's guard runs in turn with the channel's appends, and a refused one emits nothing", async function (assert) {
    let key = channelFeedKey(REALM, 'Game/3');
    let channel = new RealmEventFeed(
      REALM,
      async () => ({}),
      new DbFeedStore(dbAdapter),
      { key },
    );
    let order: string[] = [];
    let message = (body: unknown) => ({
      path: 'Game/3',
      operation: { name: 'answer', base: 'emit' },
      body,
    });
    let first = channel.emit(message(1), async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push('guard 1');
    });
    let second = channel.emit(message(2), async () => {
      order.push('guard 2');
      throw new Error('too late');
    });
    let collected = channel.latestMessages().then((events) => {
      order.push('collected');
      return events;
    });
    await first;
    await assert.rejects(second, /too late/);
    let messages = await collected;
    assert.deepEqual(order, ['guard 1', 'guard 2', 'collected']);
    assert.deepEqual(
      messages.map((event) => event.body),
      [1],
      'the collect waited for both, and the refused message is not there',
    );
  });
});
