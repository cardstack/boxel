import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type MessageService from '@cardstack/host/services/message-service';
import type PublicRealmEventsService from '@cardstack/host/services/public-realm-events';

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

  test("a realm the page watches gets its public feed, and each change reaches the realm's subscribers as an incremental index event", function (assert) {
    service.start();
    let unsubscribe = watch();
    assert.strictEqual(FakeEventSource.made.length, 1, 'one feed is opened');
    let source = FakeEventSource.made[0];
    assert.strictEqual(source.url, `${REALM}_public-events`);

    source.emit('open');
    source.emit('change', {
      data: JSON.stringify({ seq: 4, kind: 'written', path: 'QuizNight/lamb' }),
    });
    assert.deepEqual(received, [
      {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${REALM}QuizNight/lamb`],
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
});
