import { run } from '@ember/runloop';
import { settled } from '@ember/test-helpers';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type MessageService from '@cardstack/host/services/message-service';
import type PublicRealmEventsService from '@cardstack/host/services/public-realm-events';
import {
  REFRESH_REQUESTED_EVENT,
  type RefreshRequestedDetail,
  type TabChannel,
  type TabCoordination,
} from '@cardstack/host/services/public-realm-events';

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

module('Unit | Service | public-realm-events', function (hooks) {
  setupTest(hooks);

  let originalEventSource: unknown;
  let messageService: MessageService;
  let service: PublicRealmEventsService;
  let received: RealmEventContent[];

  hooks.beforeEach(function () {
    originalEventSource = (globalThis as any).EventSource;
    (globalThis as any).EventSource = FakeEventSource;
    FakeEventSource.made = [];
    messageService = this.owner.lookup(
      'service:message-service',
    ) as MessageService;
    service = this.owner.lookup(
      'service:public-realm-events',
    ) as PublicRealmEventsService;
    received = [];
  });

  hooks.afterEach(function () {
    (globalThis as any).EventSource = originalEventSource;
  });

  function watch() {
    return messageService.subscribe(REALM, (event) => received.push(event));
  }

  // Another tab of the same browser, with its own message bus.
  function makeTab(owner: any, browser: FakeBrowser) {
    let tab = owner
      .factoryFor('service:public-realm-events')
      .create() as PublicRealmEventsService;
    let bus = tabMessageService();
    Object.defineProperty(tab, 'messageService', { value: bus });
    tab.coordination = browser.coordination();
    return { tab, bus };
  }

  test("a realm the page watches gets its public feed, and each change reaches the realm's subscribers as an incremental index event", function (assert) {
    service.start();
    let unsubscribe = watch();
    assert.strictEqual(FakeEventSource.made.length, 1, 'one feed is opened');
    let source = FakeEventSource.made[0];
    assert.strictEqual(source.url, `${REALM}_public-events`);

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
      `${REALM}_public-events?lastEventId=${encodeURIComponent('e1:7')}`,
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

  test('an app that takes the refresh notice reloads when it chooses to', function (assert) {
    let reloads = 0;
    service.reloadPage = () => reloads++;
    let taken: RefreshRequestedDetail | undefined;
    let take = (event: Event) => {
      event.preventDefault();
      taken = (event as CustomEvent<RefreshRequestedDetail>).detail;
    };
    window.addEventListener(REFRESH_REQUESTED_EVENT, take);
    try {
      service.start();
      watch();
      FakeEventSource.made[0].emit('change', {
        data: JSON.stringify({ seq: 3, kind: 'refresh', path: '' }),
      });
      assert.strictEqual(reloads, 0, 'the page stays as it is');
      assert.strictEqual(taken?.realm, REALM, 'the notice names the realm');
      taken?.reload();
      assert.strictEqual(reloads, 1, 'and reloads when the app says so');
    } finally {
      window.removeEventListener(REFRESH_REQUESTED_EVENT, take);
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
});
