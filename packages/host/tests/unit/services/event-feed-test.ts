import { run } from '@ember/runloop';
import { settled } from '@ember/test-helpers';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import {
  noteFeedPosition,
  resetFeedPositionsForTests,
} from '@cardstack/host/lib/feed-positions';

import { liveCardContext } from '@cardstack/host/lib/live-card-context';
import type EventFeedService from '@cardstack/host/services/event-feed';
import type {
  TabChannel,
  TabCoordination,
} from '@cardstack/host/services/event-feed';
import type MessageService from '@cardstack/host/services/message-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from '@cardstack/base/card-api';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

// A site's realm, as a visitor's page reaches it through the site's alias.
const REALM = 'http://public-events.test/sites/owner/quiz/_r/a1b2c3/';

// Stands in for the browser's EventSource, so a test can play the realm's
// side of the stream.
class FakeEventSource {
  static CLOSED = 2;
  static made: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.made.push(this);
  }
  addEventListener(name: string, listener: (event: unknown) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  emit(name: string, event: unknown = {}) {
    for (let listener of this.listeners.get(name) ?? []) {
      listener(event);
    }
  }
  close() {
    this.closed = true;
  }
}

// Stands in for one browser's Web Locks and BroadcastChannel: one lock,
// granted to its requesters in turn, and a channel that delivers a message to
// every tab but the sender.
class FakeBrowser {
  private held = false;
  private waiting: {
    callback: () => Promise<void>;
    signal?: AbortSignal;
    reject: (error: unknown) => void;
  }[] = [];
  private channels = new Set<{
    listeners: ((message: MessageEvent) => void)[];
  }>();

  coordination(): TabCoordination {
    return {
      locks: {
        request: (_name, { signal }, callback) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              this.waiting = this.waiting.filter(
                (w) => w.callback !== callback,
              );
              reject(new DOMException('aborted', 'AbortError'));
            });
            this.waiting.push({ callback, signal, reject });
            this.grant();
          }),
      },
      channel: () => {
        let entry = { listeners: [] as ((message: MessageEvent) => void)[] };
        this.channels.add(entry);
        let channel: TabChannel = {
          postMessage: (message) => {
            for (let other of this.channels) {
              if (other !== entry) {
                let data = JSON.parse(JSON.stringify(message));
                for (let listener of other.listeners) {
                  listener({ data } as MessageEvent);
                }
              }
            }
          },
          addEventListener: (_type, listener) => {
            entry.listeners.push(listener);
          },
          close: () => {
            this.channels.delete(entry);
          },
        };
        return channel;
      },
    };
  }

  private grant() {
    if (this.held) {
      return;
    }
    let next = this.waiting.shift();
    if (!next) {
      return;
    }
    this.held = true;
    void next.callback().then(() => {
      this.held = false;
      this.grant();
    });
  }
}

// A tab's own message bus, for a tab made beside the one the owner holds.
function tabMessageService() {
  let listeners: ((realm: string) => void)[] = [];
  let received: RealmEventContent[] = [];
  return {
    received,
    watch(realm: string) {
      for (let listener of listeners) {
        listener(realm);
      }
    },
    onFirstSubscription(listener: (realm: string) => void) {
      listeners.push(listener);
      return () => {};
    },
    relayRealmEvent(event: RealmEventContent) {
      received.push(event);
    },
  };
}

module('Unit | Service | event-feed', function (hooks) {
  setupTest(hooks);

  let originalEventSource: unknown;
  let messageService: MessageService;
  let service: EventFeedService;
  let received: RealmEventContent[];

  hooks.beforeEach(function () {
    originalEventSource = (globalThis as any).EventSource;
    (globalThis as any).EventSource = FakeEventSource;
    FakeEventSource.made = [];
    messageService = this.owner.lookup(
      'service:message-service',
    ) as MessageService;
    service = this.owner.lookup('service:event-feed') as EventFeedService;
    received = [];
  });

  hooks.afterEach(function () {
    (globalThis as any).EventSource = originalEventSource;
    resetFeedPositionsForTests();
  });

  function watch() {
    return messageService.subscribe(REALM, (event) => received.push(event));
  }

  // Another tab of the same browser, with its own message bus.
  function makeTab(owner: any, browser: FakeBrowser) {
    let tab = owner
      .factoryFor('service:event-feed')
      .create() as EventFeedService;
    let bus = tabMessageService();
    Object.defineProperty(tab, 'messageService', { value: bus });
    tab.coordination = browser.coordination();
    return { tab, bus };
  }

  test("a realm the page watches gets its event feed, and each change reaches the realm's subscribers as an incremental index event", function (assert) {
    service.start();
    let unsubscribe = watch();
    assert.strictEqual(FakeEventSource.made.length, 1, 'one feed is opened');
    let source = FakeEventSource.made[0];
    assert.strictEqual(source.url, `${REALM}_live`);

    source.emit('open');
    source.emit('change', {
      data: JSON.stringify({ seq: 3, kind: 'written', path: 'QuizNight/lamb' }),
    });
    assert.deepEqual(
      received,
      [],
      'a write announced before indexing starts no re-read',
    );
    source.emit('change', {
      data: JSON.stringify({
        seq: 4,
        kind: 'indexed',
        path: 'QuizNight/lamb',
        rev: '1730000000-abc:card-srcver-lb500',
      }),
    });
    assert.deepEqual(received, [
      {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${REALM}QuizNight/lamb`],
        revisions: {
          [`${REALM}QuizNight/lamb`]: '1730000000-abc:card-srcver-lb500',
        },
        realmURL: REALM,
      },
    ]);

    source.emit('change', {
      data: JSON.stringify({ seq: 5, kind: 'reset', path: '' }),
    });
    assert.deepEqual(
      received[1],
      { eventName: 'index', indexType: 'full', realmURL: REALM },
      'a reset is a full index event',
    );

    watch();
    assert.strictEqual(
      FakeEventSource.made.length,
      1,
      'a second subscriber shares the feed',
    );
    unsubscribe();
  });

  test("a realm's feed opens from the earliest position among the page's reads of it", function (assert) {
    noteFeedPosition(`${REALM}QuizNight/lamb`, 'e1:7');
    noteFeedPosition(`${REALM}HostDesk/lamb`, 'e1:3');
    noteFeedPosition(`${REALM}QuizNight/lamb`, 'e1:9');
    noteFeedPosition('http://elsewhere.test/other/Card/1', 'e9:1');
    service.start();
    watch();
    assert.strictEqual(
      FakeEventSource.made[0].url,
      `${REALM}_live?lastEventId=${encodeURIComponent('e1:3')}`,
      'a change made after the earliest read is replayed rather than missed',
    );
  });

  test("a page follows a card's channel: messages reach it, card changes reach the store, and the channel closes with its last follower", function (assert) {
    let card = `${REALM}QuizNight/x7k2`;
    let heard: unknown[] = [];
    watch();
    service.start();
    let unfollow = service.followChannel(card, REALM, (message) =>
      heard.push(message),
    );
    let source = FakeEventSource.made.find((made) =>
      made.url.includes('channel='),
    )!;
    assert.strictEqual(
      source.url,
      `${REALM}_live?channel=${encodeURIComponent('QuizNight/x7k2')}`,
    );
    assert.deepEqual(
      received.map((event) => (event as any).invalidations),
      [[card]],
      'the card is re-read once, since it may have changed before the channel opened',
    );

    source.emit('change', {
      data: JSON.stringify({
        seq: 4,
        kind: 'message',
        path: 'QuizNight/x7k2',
        key: 'red:1',
        operation: { name: 'select', base: 'emit' },
        body: { team: 'red', choice: 'B' },
      }),
    });
    assert.deepEqual(heard, [
      {
        seq: 4,
        key: 'red:1',
        operation: 'select',
        body: { team: 'red', choice: 'B' },
      },
    ]);
    source.emit('change', {
      data: JSON.stringify({
        seq: 5,
        kind: 'indexed',
        path: 'QuizNight/x7k2',
        rev: 'r2',
      }),
    });
    assert.strictEqual(received.length, 2, 'the change reaches the store');
    assert.strictEqual(heard.length, 1, 'and is not a message');

    unfollow();
    assert.true(source.closed, 'the channel closes when nothing follows it');
  });

  test('a signed-in page, whose realm events come over Matrix, still follows a channel', function (assert) {
    let card = `${REALM}QuizNight/x7k2`;
    let unfollow = service.followChannel(card, REALM, () => undefined);
    assert.true(
      FakeEventSource.made.some((made) => made.url.includes('channel=')),
      'the channel opens without the realm feeds having started',
    );
    unfollow();
  });

  test("a card is followed through the realm it was read from, even one the realm service doesn't know", function (assert) {
    let live = liveCardContext(service, {
      realmURLOf: () => undefined,
    } as unknown as RealmService);
    let card = {
      id: `${REALM}QuizNight/x7k2`,
      [realmURLSymbol]: new URL(REALM),
    } as unknown as CardDef;
    let unfollow = live.followChannel(card, () => undefined);
    assert.true(
      FakeEventSource.made.some(
        (made) =>
          made.url ===
          `${REALM}_live?channel=${encodeURIComponent('QuizNight/x7k2')}`,
      ),
      "the channel opens under the site's alias",
    );
    unfollow();
  });

  test('nothing is opened until the service starts', function (assert) {
    watch();
    assert.strictEqual(FakeEventSource.made.length, 0);
    service.start();
    assert.strictEqual(
      FakeEventSource.made.length,
      1,
      'starting opens the feeds of realms already watched',
    );
  });

  test("a browser's tabs share one feed, which the leading tab passes on", function (assert) {
    let browser = new FakeBrowser();
    let first = makeTab(this.owner, browser);
    let second = makeTab(this.owner, browser);
    first.tab.start();
    second.tab.start();
    first.bus.watch(REALM);
    second.bus.watch(REALM);
    assert.strictEqual(
      FakeEventSource.made.length,
      1,
      'one connection for both tabs',
    );

    let source = FakeEventSource.made[0];
    source.emit('open');
    source.emit('change', {
      data: JSON.stringify({ seq: 4, kind: 'indexed', path: 'QuizNight/lamb' }),
      lastEventId: 'e1:4',
    });
    let expected: RealmEventContent = {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [`${REALM}QuizNight/lamb`],
      realmURL: REALM,
    };
    assert.deepEqual(first.bus.received, [expected], 'the leader relays it');
    assert.deepEqual(
      second.bus.received,
      [expected],
      'and the other tab hears it from the leader',
    );
    run(() => {
      first.tab.destroy();
      second.tab.destroy();
    });
  });

  test('a tab that watches a realm the leader does not gets that feed opened by the leader', function (assert) {
    let browser = new FakeBrowser();
    let first = makeTab(this.owner, browser);
    let second = makeTab(this.owner, browser);
    first.tab.start();
    second.tab.start();
    second.bus.watch(REALM);
    assert.strictEqual(FakeEventSource.made.length, 1);
    FakeEventSource.made[0].emit('change', {
      data: JSON.stringify({ seq: 1, kind: 'indexed', path: 'Card/1' }),
      lastEventId: 'e1:1',
    });
    assert.strictEqual(
      first.bus.received.length,
      0,
      'the leader relays nothing for a realm its page does not watch',
    );
    assert.strictEqual(second.bus.received.length, 1, 'the watcher does');
    run(() => {
      first.tab.destroy();
      second.tab.destroy();
    });
  });

  test('when the leading tab closes, another takes over and resumes from the last event id', async function (assert) {
    let browser = new FakeBrowser();
    let first = makeTab(this.owner, browser);
    let second = makeTab(this.owner, browser);
    first.tab.start();
    second.tab.start();
    first.bus.watch(REALM);
    second.bus.watch(REALM);
    let source = FakeEventSource.made[0];
    source.emit('change', {
      data: JSON.stringify({ seq: 7, kind: 'indexed', path: 'Card/1' }),
      lastEventId: 'e1:7',
    });

    run(() => first.tab.destroy());
    await settled();
    assert.true(source.closed, "the closed tab's connection is gone");
    assert.strictEqual(FakeEventSource.made.length, 2, 'the next tab opens it');
    assert.strictEqual(
      FakeEventSource.made[1].url,
      `${REALM}_live?lastEventId=${encodeURIComponent('e1:7')}`,
      'from where the last leader stopped',
    );
    FakeEventSource.made[1].emit('change', {
      data: JSON.stringify({ seq: 8, kind: 'indexed', path: 'Card/2' }),
      lastEventId: 'e1:8',
    });
    assert.deepEqual(
      second.bus.received.map(
        (event) => (event as { invalidations?: string[] }).invalidations,
      ),
      [[`${REALM}Card/1`], [`${REALM}Card/2`]],
      'and the tab hears every change once',
    );
    run(() => second.tab.destroy());
  });

  test('a refresh request reloads the page when nothing on it takes the notice', function (assert) {
    let reloads = 0;
    service.reloadPage = () => reloads++;
    service.start();
    watch();
    let source = FakeEventSource.made[0];
    source.emit('change', {
      data: JSON.stringify({ seq: 9, kind: 'refresh', path: '' }),
    });
    assert.strictEqual(reloads, 1, 'the page reloads');
    assert.deepEqual(received, [], 'nothing is relayed as a realm event');
    source.emit('change', {
      data: JSON.stringify({ seq: 10, kind: 'refresh', path: '' }),
    });
    assert.strictEqual(
      reloads,
      1,
      'a second request finds one already under way',
    );
  });

  test('a card that takes refresh requests reloads the page when it chooses to', function (assert) {
    let reloads = 0;
    service.reloadPage = () => reloads++;
    let taken: { reload(): void } | undefined;
    let release = service.takeRefreshRequests((notice) => (taken = notice));
    service.start();
    watch();
    FakeEventSource.made[0].emit('change', {
      data: JSON.stringify({ seq: 3, kind: 'refresh', path: '' }),
    });
    assert.strictEqual(reloads, 0, 'the page stays as it is');
    taken?.reload();
    assert.strictEqual(reloads, 1, 'and reloads when the card says so');
    release();
  });

  test("a page on a site honours a refresh request only from the site's own realm", function (assert) {
    let reloads = 0;
    service.reloadPage = () => reloads++;
    let site = 'http://public-events.test/sites/owner/quiz/';
    service.siteRealm = () => site;
    service.start();
    watch();
    let drawnOn = FakeEventSource.made.find((made) =>
      made.url.startsWith(REALM),
    )!;
    let own = FakeEventSource.made.find((made) => made.url === `${site}_live`);
    assert.ok(own, "the page follows its site's own realm for its requests");
    drawnOn.emit('change', {
      data: JSON.stringify({ seq: 3, kind: 'refresh', path: '' }),
    });
    assert.strictEqual(
      reloads,
      0,
      'a realm the site draws on cannot reload it',
    );
    own!.emit('change', {
      data: JSON.stringify({ seq: 4, kind: 'refresh', path: '' }),
    });
    assert.strictEqual(reloads, 1, 'its own realm can');
  });

  test('a stream that closes after it opened is reopened from the last event id', async function (assert) {
    service.timing = { pollMs: 5, retryFirstMs: 1 };
    service.start();
    watch();
    let first = FakeEventSource.made[0];
    first.emit('open');
    first.emit('change', {
      data: JSON.stringify({ seq: 4, kind: 'written', path: 'Card/1' }),
      lastEventId: 'e1:4',
    });
    // A reconnect the browser gave up on, as after a deploy's 502.
    first.readyState = FakeEventSource.CLOSED;
    first.emit('error');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(FakeEventSource.made.length, 2, 'it opens again');
    assert.strictEqual(
      FakeEventSource.made[1].url,
      `${REALM}_live?lastEventId=${encodeURIComponent('e1:4')}`,
      'from where it stopped',
    );
  });

  test('the poll stops for good when the realm refuses it', async function (assert) {
    let originalFetch = globalThis.fetch;
    (globalThis as any).EventSource = undefined;
    try {
      service.timing = { pollMs: 5, retryFirstMs: 1 };
      let asked = 0;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        if (
          !String(input instanceof Request ? input.url : input).includes(
            '_live',
          )
        ) {
          return originalFetch(input, init);
        }
        asked++;
        return new Response(null, { status: 401 });
      }) as typeof fetch;
      service.start();
      watch();
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.strictEqual(asked, 1, 'a refused poll is not asked again');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a poll the realm asks to wait waits that long', async function (assert) {
    let originalFetch = globalThis.fetch;
    (globalThis as any).EventSource = undefined;
    try {
      service.timing = { pollMs: 5, retryFirstMs: 1 };
      let asked = 0;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        if (
          !String(input instanceof Request ? input.url : input).includes(
            '_live',
          )
        ) {
          return originalFetch(input, init);
        }
        asked++;
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      }) as typeof fetch;
      service.start();
      watch();
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(
        asked,
        1,
        'one ask in the second the realm named, not one per poll interval',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a relay waits a short random time, so a crowd does not re-read at once', async function (assert) {
    let originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      service.relaySpreadMs = 200;
      service.start();
      watch();
      FakeEventSource.made[0].emit('change', {
        data: JSON.stringify({ seq: 1, kind: 'indexed', path: 'Card/1' }),
      });
      assert.strictEqual(received.length, 0, 'not relayed at once');
      await settled();
      assert.strictEqual(received.length, 1, 'relayed after the wait');
    } finally {
      Math.random = originalRandom;
    }
  });
  // Waits, a second at most, until `done` holds.
  async function waitFor(done: () => boolean) {
    let deadline = Date.now() + 1_000;
    while (!done() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  // Answers the realm's poll with `window` while a test runs, and everything
  // else as the page would.
  async function withPoll(
    window: (url: string) => unknown,
    body: (asked: string[]) => Promise<void>,
  ) {
    let originalFetch = globalThis.fetch;
    let asked: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      let url = String(input instanceof Request ? input.url : input);
      if (!url.includes('_live')) {
        return originalFetch(input, init);
      }
      asked.push(url);
      return new Response(JSON.stringify(window(url)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await body(asked);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  test("a channel followed by poll hears the channel's current messages first", async function (assert) {
    (globalThis as any).EventSource = undefined;
    service.timing = { pollMs: 5, retryFirstMs: 1 };
    let heard: unknown[] = [];
    await withPoll(
      () => ({
        v: 1,
        epoch: 'c1',
        head: 7,
        from: 0,
        events: [
          { seq: 3, kind: 'indexed', path: 'QuizNight/x7k2' },
          {
            seq: 5,
            kind: 'message',
            path: 'QuizNight/x7k2',
            key: 'red:1',
            body: { team: 'red', choice: 'B' },
          },
          {
            seq: 7,
            kind: 'message',
            path: 'QuizNight/x7k2',
            key: 'blue:1',
            body: { team: 'blue', choice: 'A' },
          },
        ],
      }),
      async () => {
        let unfollow = service.followChannel(
          `${REALM}QuizNight/x7k2`,
          REALM,
          (message) => heard.push(message.body),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        unfollow();
      },
    );
    assert.deepEqual(
      heard,
      [
        { team: 'red', choice: 'B' },
        { team: 'blue', choice: 'A' },
      ],
      'the latest per key, once each',
    );
  });

  test('a stream that closes after it opened is carried by the poll, from the last event id, until it opens again', async function (assert) {
    service.timing = { pollMs: 5, retryFirstMs: 40 };
    await withPoll(
      () => ({
        v: 1,
        epoch: 'e1',
        head: 6,
        from: 0,
        events: [
          { seq: 4, kind: 'indexed', path: 'Card/old' },
          { seq: 5, kind: 'indexed', path: 'Card/1' },
          { seq: 6, kind: 'indexed', path: 'Card/2' },
        ],
      }),
      async (asked) => {
        service.start();
        watch();
        let first = FakeEventSource.made[0];
        first.emit('open');
        first.emit('change', {
          data: JSON.stringify({ seq: 4, kind: 'indexed', path: 'Card/old' }),
          lastEventId: 'e1:4',
        });
        // Turned away on a reconnect, as a realm at its stream cap does.
        first.readyState = FakeEventSource.CLOSED;
        first.emit('error');
        await waitFor(() => received.length >= 3);
        assert.ok(asked.length > 0, 'the page polls while the stream is down');
        assert.deepEqual(
          received.map((event) => (event as any).invalidations?.[0]),
          [`${REALM}Card/old`, `${REALM}Card/1`, `${REALM}Card/2`],
          'and hears what changed after the last event the stream brought, once',
        );
        await waitFor(() => FakeEventSource.made.length > 1);
        let second = FakeEventSource.made[1];
        assert.ok(second, 'the stream is tried again');
        second.emit('open');
        let polls = asked.length;
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.strictEqual(
          asked.length,
          polls,
          'and the poll stops once it opens',
        );
      },
    );
  });

  test("a channel's reset is spread like the realm's, and a card withdrawn stops the channel", async function (assert) {
    let originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      service.relaySpreadMs = 200;
      let card = `${REALM}QuizNight/x7k2`;
      service.followChannel(card, REALM, () => undefined);
      await settled();
      received.length = 0;
      let handle = messageService.subscribe(REALM, (event) =>
        received.push(event),
      );
      let source = FakeEventSource.made.find((made) =>
        made.url.includes('channel='),
      )!;
      source.emit('change', {
        data: JSON.stringify({ seq: 9, kind: 'reset', path: '', spread: 400 }),
      });
      assert.strictEqual(received.length, 0, 'not relayed at once');
      await settled();
      assert.strictEqual(received.length, 1, 'relayed after the wait');
      source.emit('change', {
        data: JSON.stringify({
          seq: 10,
          kind: 'withdrawn',
          path: 'QuizNight/x7k2',
        }),
      });
      assert.true(source.closed, 'the channel stops following the card');
      await settled();
      handle();
    } finally {
      Math.random = originalRandom;
    }
  });

  test('a service going away closes the card channels it follows', function (assert) {
    service.followChannel(`${REALM}QuizNight/x7k2`, REALM, () => undefined);
    let source = FakeEventSource.made.find((made) =>
      made.url.includes('channel='),
    )!;
    run(() => service.destroy());
    assert.true(source.closed);
  });
});
