import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  EVENT_FEED_MAX_CHECKS_PER_EVENT,
  parseAddressRanges,
  RealmEventFeed,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  FeedEventWindow,
  FeedEvent,
  QueuePublisher,
  QueueRunner,
  Realm,
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
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";
  export class Article extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @operation static retitle = {
      base: 'transform',
      params: { headline: StringField },
      set: { headline: params('headline') },
    };
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

const PUBLISHED_TO_ANONYMOUS = {
  where: 'actor() == "anonymous" and .status == "published"',
};

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
  let library: Realm;
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
      clientAddress: {
        trustedProxyHops: 1,
        infraAddresses: parseAddressRanges(['203.0.113.5']).ranges,
      },
      realms: [
        {
          realmURL: new URL(NEWSROOM),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Newsroom',
              policy: `${ORG}policies/newsroom`,
            }),
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
              { operation: 'read', ...PUBLISHED_TO_ANONYMOUS },
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
    assert.deepEqual(feed.window().events, [
      { v: 1, seq: 1, kind: 'reset', path: '' },
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
    assert.deepEqual(feed.window().events, [
      { v: 1, seq: 1, kind: 'reset', path: '' },
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
    assert.deepEqual(feed.window().events[0].types, [
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
    assert.strictEqual(feed.window().events[0].types, undefined);
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
      feed.window().events.map(({ kind, operation }) => ({ kind, operation })),
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
    let removed = feed.window().events.find((e) => e.kind === 'removed');
    assert.deepEqual(removed?.operation, { name: 'delete', base: 'delete' });
  });

  test("a change to the realm's config resets the feed, since it names the policy", async function (assert) {
    let feed = new RealmEventFeed(REALM, async () => ({}));
    await feed.ingest({
      eventName: 'update',
      updated: ['realm.json'],
      realmURL: REALM,
    } as never);
    assert.deepEqual(feed.window().events, [
      { v: 1, seq: 1, kind: 'reset', path: '' },
    ]);
  });
});
