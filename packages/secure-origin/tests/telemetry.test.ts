import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { timedFetch } from '../src/security/session.js';
import {
  SecureTelemetry,
  scriptURL,
  scrubMessage,
  type TelemetryEvent,
  type WedgeEvent,
} from '../src/telemetry/instrument.ts';
import { endpointLabel, pageLabel } from '../src/telemetry/labels.ts';

const REALM_SERVER = 'https://realm-server.example.test/';
const MATRIX = 'https://matrix.example.test/';
const KEY = '0b6c1e9e-5a1f-4c47-9d0e-2f5b8f6f1a3c';

describe('endpoint labels', () => {
  test('each realm-server endpoint the pages call has its label', () => {
    for (let [path, label] of [
      ['_user-keys', '_user-keys'],
      [`_user-keys/${KEY}`, '_user-keys/:id'],
      [`_key-shares?key=${KEY}`, '_key-shares'],
      [
        '_key-shares?realm=https%3A%2F%2Frealm.example%2Fmine%2F',
        '_key-shares',
      ],
      [`_key-shares/${KEY}/swap`, '_key-shares/:id/swap'],
      ['_key-write-tickets', '_key-write-tickets'],
      ['_secure-window/context', '_secure-window/context'],
      ['_secure-window/realms', '_secure-window/realms'],
      ['_secure-origin', '_secure-origin'],
      ['_secure-session', '_secure-session'],
      ['_secure-session/google', '_secure-session/google'],
      ['_secure-session/login-token', '_secure-session/login-token'],
      ['_secure-session/renewal', '_secure-session/renewal'],
      ['_secure-sessions/password-change', '_secure-sessions/password-change'],
    ]) {
      assert.equal(endpointLabel(`${REALM_SERVER}${path}`), label, path);
    }
  });

  test('each Matrix endpoint the pages call has its label', () => {
    let api = `${MATRIX}_matrix/client/v3/`;
    for (let [path, label] of [
      ['register', 'register'],
      ['register/available?username=alice', 'register/available'],
      ['register/email/requestToken', 'register/email/requestToken'],
      [
        'account/password/email/requestToken',
        'account/password/email/requestToken',
      ],
      [
        `profile/${encodeURIComponent('@alice:example.test')}/displayname`,
        'profile/:id/displayname',
      ],
      ['logout', 'logout'],
    ]) {
      assert.equal(
        endpointLabel(`${api}${path}`),
        `_matrix/client/v3/${label}`,
        path,
      );
    }
  });

  test('anything else is other, and no label copies a segment it was not written with', () => {
    for (let url of [
      `${REALM_SERVER}_user-keys/${KEY}/extra`,
      `${REALM_SERVER}_unknown-endpoint`,
      `${REALM_SERVER}mine/my-card.json`,
      `${MATRIX}_matrix/client/v3/rooms/!secret:example/send`,
      `${MATRIX}_matrix/client/v1/register`,
      'not a url',
    ]) {
      assert.equal(endpointLabel(url), 'other', url);
    }
  });

  test('pages are named by their path, never by a key id', () => {
    assert.equal(pageLabel('index'), 'keys');
    assert.equal(pageLabel('keys.index'), 'keys');
    assert.equal(pageLabel('keys.share'), 'keys/share');
    assert.equal(pageLabel('sign-in'), 'sign-in');
    assert.equal(pageLabel('nowhere'), 'other');
    assert.equal(pageLabel('constructor'), 'other');
    assert.equal(pageLabel(undefined), 'other');
  });
});

describe('scrubbing an error message', () => {
  test("a refused request keeps only its status and code, never the server's words", () => {
    let thrown = Object.assign(new Error('The key "Stripe live" is gone'), {
      status: 404,
      code: 'not-found',
    });
    assert.equal(
      scrubMessage('Error: The key "Stripe live" is gone', thrown),
      'request failed: status 404 (not-found)',
    );
    let matrix = Object.assign(new Error('Invalid password hunter2'), {
      status: 403,
      errcode: 'M_FORBIDDEN',
    });
    assert.equal(
      scrubMessage('Error: Invalid password hunter2', matrix),
      'request failed: status 403 (M_FORBIDDEN)',
    );
  });

  test('anything quoted, any URL and any Matrix ID or email address is cut', () => {
    let scrubbed = scrubMessage(
      `SyntaxError: Unexpected token 'k', "key=sk_live_123" is not valid JSON at https://realm.example/mine/?realm=x for @alice:example.test or bob@example.test`,
    );
    for (let secret of [
      'sk_live_123',
      'realm.example',
      'alice',
      'bob@example',
    ]) {
      assert.ok(!scrubbed.includes(secret), `${secret} in ${scrubbed}`);
    }
    assert.match(scrubbed, /^SyntaxError: Unexpected token \*/);
  });
});

describe('a script URL as a wedge reports it', () => {
  test("keeps a script file's origin and path, never its query or fragment", () => {
    assert.equal(
      scriptURL('https://secure.example.test/assets/shell-1a2b.js?v=3#x'),
      'https://secure.example.test/assets/shell-1a2b.js',
    );
    assert.equal(
      scriptURL('http://localhost:4208/src/shell/app.gts'),
      'http://localhost:4208/src/shell/app.gts',
    );
  });

  test("never the document's own address, or a URL that isn't a script file's", () => {
    for (let value of [
      `https://secure.example.test/keys/${KEY}/share`,
      'https://secure.example.test/reset-password?token=abc',
      'blob:https://secure.example.test/0b6c1e9e',
      'data:text/javascript,alert(1)',
      'not a url',
      '',
      undefined,
      42,
    ]) {
      assert.equal(scriptURL(value), '', String(value));
    }
  });
});

// A `PerformanceObserver` whose entries the test delivers by hand.
class FakeObserver {
  static supportedEntryTypes: string[] = [];
  static live = new Set<FakeObserver>();
  type: string | undefined;
  callback: (list: { getEntries(): PerformanceEntry[] }) => void;
  constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) {
    this.callback = callback;
  }
  observe({ type }: { type: string }) {
    this.type = type;
    FakeObserver.live.add(this);
  }
  disconnect() {
    FakeObserver.live.delete(this);
  }
  static deliver(type: string, entries: object[]) {
    for (let observer of FakeObserver.live) {
      if (observer.type === type) {
        observer.callback({
          getEntries: () => entries as PerformanceEntry[],
        });
      }
    }
  }
}

// A window whose timers the test runs by hand.
class FakeWindow {
  timers = new Map<number, () => void>();
  timeouts = new Map<number, () => void>();
  PerformanceObserver: typeof FakeObserver | undefined;
  listeners = new Map<string, Set<(event: Event) => void>>();
  nextTimer = 1;
  document = {
    visibilityState: 'visible',
    listeners: new Map<string, Set<() => void>>(),
    addEventListener(type: string, fn: () => void) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      this.listeners.get(type)?.delete(fn);
    },
  };
  setInterval(fn: () => void) {
    let id = this.nextTimer++;
    this.timers.set(id, fn);
    return id;
  }
  clearInterval(id: number) {
    this.timers.delete(id);
  }
  setTimeout(fn: () => void) {
    let id = this.nextTimer++;
    this.timeouts.set(id, fn);
    return id;
  }
  // Runs the timeouts pending now; those they set wait for the next call.
  runTimeouts() {
    let pending = [...this.timeouts];
    for (let [id, fn] of pending) {
      this.timeouts.delete(id);
      fn();
    }
  }
  addEventListener(type: string, fn: (event: Event) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: Event) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string) {
    for (let fn of this.listeners.get(type) ?? []) {
      fn(new Event(type));
    }
  }
  tick() {
    for (let fn of [...this.timers.values()]) {
      fn();
    }
  }
}

interface Beacon {
  url: string;
  authorization: string | undefined;
  keepalive: boolean;
  body: {
    client_app: string;
    session_id: string;
    events: TelemetryEvent[];
  };
}

describe('the instrument', () => {
  let win: FakeWindow;
  let beacons: Beacon[];
  let clock: number;
  let session: { token: string; user: string } | undefined;
  let telemetry: SecureTelemetry;

  beforeEach(() => {
    win = new FakeWindow();
    beacons = [];
    clock = 0;
    session = undefined;
    telemetry = new SecureTelemetry({
      window: win as unknown as Window,
      serverURL: new URL(REALM_SERVER),
      session: () => session,
      now: () => clock,
      fetch: (async (url: URL, init: RequestInit) => {
        let headers = init.headers as Record<string, string>;
        beacons.push({
          url: String(url),
          authorization: headers.Authorization,
          keepalive: init.keepalive === true,
          body: JSON.parse(String(init.body)),
        });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
  });

  function events() {
    return beacons.flatMap((b) => b.body.events);
  }

  test('sends what built up each beat, as the secure origin, with the session when there is one', () => {
    telemetry.start();
    telemetry.pageOpened('sign-in');
    clock = 40;
    telemetry.pageRendered();
    win.tick();
    assert.equal(beacons.length, 1);
    let [first] = beacons;
    assert.equal(first!.url, `${REALM_SERVER}_client-telemetry`);
    assert.ok(first!.keepalive);
    assert.equal(first!.authorization, undefined, 'no session yet');
    assert.equal(first!.body.client_app, 'secure-origin');
    assert.ok(
      !('matrix_user_id' in first!.body),
      'the body names no user; the session does',
    );
    assert.deepEqual(
      first!.body.events.map((e) => [e.event_type, e.page]),
      [['page-load', 'sign-in']],
    );
    let load = first!.body.events[0] as Extract<
      TelemetryEvent,
      { event_type: 'page-load' }
    >;
    assert.equal(load.outcome, 'loaded');
    assert.equal(load.first_render_ms, 40);
    assert.equal(load.data_loaded_ms, null);

    session = { token: 'secret-session-token', user: '@alice:example.test' };
    telemetry.pageOpened('sign-out');
    telemetry.pageRendered();
    win.tick();
    assert.equal(beacons[1]!.authorization, 'Bearer secret-session-token');
    assert.ok(!JSON.stringify(beacons[1]!.body).includes('@alice'));
    assert.equal(beacons[1]!.body.session_id, first!.body.session_id);
    telemetry.stop();
  });

  test('a page that loads data reports when it loaded, failed, or found no session', () => {
    telemetry.start();
    telemetry.pageOpened('keys.index');
    let keys = telemetry.pageAwaitsData();
    clock = 30;
    telemetry.pageRendered();
    clock = 120;
    keys.loaded();
    keys.loadFailed(new Error('ignored: the load already ended'));

    clock = 200;
    telemetry.pageOpened('keys.share');
    let share = telemetry.pageAwaitsData();
    clock = 450;
    share.loadFailed(Object.assign(new Error('x'), { status: 503 }));

    telemetry.pageOpened('enter-key');
    telemetry.pageAwaitsData().signedOut();

    telemetry.pageOpened('share-key');
    telemetry.pageAwaitsData();
    telemetry.flushAll('close');

    let loads = events().filter((e) => e.event_type === 'page-load');
    assert.deepEqual(
      loads.map((e) => [
        e.page,
        e.navigation,
        e.outcome,
        e.first_render_ms,
        e.data_loaded_ms,
        e.failed_status,
      ]),
      [
        ['keys', 'document', 'loaded', 30, 120, null],
        ['keys/share', 'in-app', 'load-failed', null, null, 503],
        ['enter-key', 'in-app', 'signed-out', null, null, null],
        ['share-key', 'in-app', 'left', null, null, null],
      ],
    );
    telemetry.stop();
  });

  test('a page left mid-load reports nothing onto the page after it', () => {
    telemetry.start();
    telemetry.pageOpened('keys.share');
    let share = telemetry.pageAwaitsData();
    telemetry.pageOpened('keys.index');
    let keys = telemetry.pageAwaitsData();
    // The share page's load finishes after the user went back.
    share.loadFailed(Object.assign(new Error('x'), { status: 500 }));
    keys.loaded();
    telemetry.flushAll('test');
    assert.deepEqual(
      events()
        .filter((e) => e.event_type === 'page-load')
        .map((e) => [e.page, e.outcome]),
      [
        ['keys/share', 'left'],
        ['keys', 'loaded'],
      ],
    );
    telemetry.stop();
  });

  test('times each request by its label, and names the failed one a load ended on', async () => {
    let realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('_secure-window/context')) {
        return new Response('{}', {
          status: 404,
          headers: { 'content-length': '2' },
        });
      }
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    try {
      telemetry.start();
      telemetry.pageOpened('swap-key');
      let swap = telemetry.pageAwaitsData();
      await timedFetch(
        new URL(`_secure-window/context`, REALM_SERVER),
        { method: 'POST', headers: { Authorization: 'Bearer t' } },
        'realm-server',
      );
      await assert.rejects(
        timedFetch(
          new URL(`_matrix/client/v3/register`, MATRIX),
          { method: 'POST' },
          'matrix',
        ),
      );
      swap.loadFailed(new Error('no status'));
      telemetry.flushAll('test');
    } finally {
      globalThis.fetch = realFetch;
      telemetry.stop();
    }
    let requests = events().filter((e) => e.event_type === 'server-request');
    assert.deepEqual(
      requests.map((e) => [e.endpoint, e.method, e.status, e.resp_bytes]),
      [
        ['_secure-window/context', 'POST', 404, 2],
        ['_matrix/client/v3/register', 'POST', 0, 0],
      ],
    );
    assert.match(String(requests[0]!.correlation_id), /^[0-9a-f-]{36}$/);
    assert.equal(
      requests[1]!.correlation_id,
      null,
      'the Matrix server is never sent a correlation id',
    );
    let load = events().find((e) => e.event_type === 'page-load')!;
    assert.equal(load.failed_endpoint, '_matrix/client/v3/register');
    assert.equal(load.failed_status, 0);
  });

  test('a request goes out as given while nothing observes it', async () => {
    let realFetch = globalThis.fetch;
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      let init = { method: 'GET', headers: { Accept: 'x' } };
      await timedFetch(
        new URL('_secure-origin', REALM_SERVER),
        init,
        'realm-server',
      );
      assert.equal(seen, init);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('flushes everything on close and on pagehide, in batches under the caps', () => {
    telemetry.start();
    telemetry.pageOpened('keys.index');
    telemetry.pageAwaitsData();
    for (let i = 0; i < 390; i++) {
      // Each event is about 250 bytes, so a batch of them passes 60KB.
      telemetry.pageOpened('keys.index');
      telemetry.pageAwaitsData();
    }
    win.dispatch('pagehide');
    assert.ok(beacons.length > 1, 'more than one batch');
    for (let beacon of beacons) {
      assert.ok(
        new TextEncoder().encode(JSON.stringify(beacon.body)).length <=
          60 * 1024,
      );
      assert.ok(beacon.body.events.length <= 400);
    }
    assert.equal(events().length, 391, 'every page visit sent, as left');
    telemetry.stop();
  });

  test('a quiet window beacons a keepalive with its longest main-thread gap', () => {
    telemetry.start();
    clock = 100;
    win.tick();
    clock = 900;
    win.tick();
    clock = 25_000;
    win.tick();
    let keepalives = events().filter((e) => e.event_type === 'keepalive');
    assert.equal(keepalives.length, 1);
    assert.ok(keepalives[0]!.max_gap_ms >= 800);
    telemetry.stop();
  });

  test('a beacon that fails, or a session that can not be read, never throws', () => {
    let failing = new SecureTelemetry({
      window: win as unknown as Window,
      serverURL: new URL(REALM_SERVER),
      session: () => {
        throw new Error('storage blocked');
      },
      fetch: (() => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    failing.start();
    failing.pageOpened('sign-in');
    failing.pageRendered();
    assert.doesNotThrow(() => win.tick());
    assert.doesNotThrow(() => failing.flushAll('close'));
    failing.stop();
  });
  describe('wedges', () => {
    const SCRIPT = 'https://secure.example.test/assets/shell-1a2b.js';

    beforeEach(() => {
      FakeObserver.live.clear();
      FakeObserver.supportedEntryTypes = ['long-animation-frame', 'longtask'];
      win.PerformanceObserver = FakeObserver;
    });

    function wedges() {
      telemetry.flushAll('test');
      return events().filter((e): e is WedgeEvent => e.event_type === 'wedge');
    }

    // The main thread runs nothing from 100 until 12,100.
    function freeze() {
      clock = 100;
      win.tick();
      clock = 12_100;
      win.tick();
    }

    test('a freeze is attributed to the scripts that blocked it, by URL and function name alone', () => {
      telemetry.start();
      telemetry.pageOpened('keys.share');
      freeze();
      FakeObserver.deliver('long-animation-frame', [
        {
          startTime: 150,
          duration: 11_950,
          blockingDuration: 11_900,
          scripts: [
            {
              sourceURL: `${SCRIPT}?v=3#${KEY}`,
              sourceFunctionName: 'revealKey',
              sourceCharPosition: 1234,
              invoker: 'BUTTON#reveal-sk-live-SECRET.onclick',
              invokerType: 'event-listener',
              duration: 11_800,
            },
            {
              sourceURL: `https://secure.example.test/keys/${KEY}/share?token=sk-live-SECRET`,
              sourceFunctionName: 'inline',
              sourceCharPosition: 9,
              invoker: `https://secure.example.test/keys/${KEY}/share`,
              invokerType: 'classic-script',
              duration: 60,
            },
          ],
        },
      ]);
      win.runTimeouts();
      let [wedge, ...rest] = wedges();
      assert.equal(rest.length, 0);
      assert.ok(wedge);
      assert.equal(wedge.page, 'keys/share');
      assert.equal(wedge.duration_ms, 12_000);
      assert.equal(wedge.worst_gap_ms, 12_000);
      assert.equal(wedge.blocked_ms, 11_900);
      assert.equal(wedge.longtask_count, 1);
      assert.equal(wedge.top_frame_function, 'revealKey');
      assert.equal(wedge.top_frame_url, SCRIPT);
      assert.equal(wedge.top_frame_char, 1234);
      assert.equal(wedge.top_frame_blocked_ms, 11_800);
      assert.equal(
        wedge.top_frames,
        `revealKey @ ${SCRIPT}:1234  |  inline @ ?:9`,
      );
      assert.deepEqual(
        wedge.loaf_scripts.map((s) => [s.source_url, s.invoker_type]),
        [
          [SCRIPT, 'event-listener'],
          ['', 'classic-script'],
        ],
      );
      let sent = JSON.stringify(beacons.map((b) => b.body));
      for (let secret of [KEY, 'sk-live-SECRET', 'BUTTON', 'token=']) {
        assert.ok(!sent.includes(secret), `${secret} in ${sent}`);
      }
      telemetry.stop();
    });

    test('a gap no frame corroborates, as a wake from sleep leaves, is not a wedge', () => {
      telemetry.start();
      freeze();
      win.runTimeouts();
      win.runTimeouts();
      win.runTimeouts();
      win.runTimeouts();
      assert.equal(win.timeouts.size, 0, 'it stops retrying');
      assert.deepEqual(wedges(), []);
      telemetry.stop();
    });

    test('a short frame as the window wakes from sleep does not make the sleep a wedge', () => {
      telemetry.start();
      freeze();
      FakeObserver.deliver('long-animation-frame', [
        { startTime: 12_000, duration: 60, blockingDuration: 10 },
      ]);
      win.runTimeouts();
      win.runTimeouts();
      win.runTimeouts();
      assert.deepEqual(wedges(), []);
      telemetry.stop();
    });

    test('a freeze in the same frame as the heartbeat before it is a wedge', () => {
      telemetry.start();
      freeze();
      FakeObserver.deliver('long-animation-frame', [
        {
          startTime: 95,
          duration: 12_000,
          blockingDuration: 11_950,
          scripts: [
            {
              sourceURL: SCRIPT,
              sourceFunctionName: 'deriveKey',
              sourceCharPosition: 42,
              invokerType: 'user-callback',
              duration: 11_990,
            },
          ],
        },
      ]);
      win.runTimeouts();
      let [wedge] = wedges();
      assert.equal(wedge?.top_frame_function, 'deriveKey');
      assert.equal(wedge?.blocked_ms, 11_950);
      telemetry.stop();
    });

    test('a freeze spread over several frames is a wedge', () => {
      telemetry.start();
      freeze();
      FakeObserver.deliver('long-animation-frame', [
        { startTime: 110, duration: 4_000, blockingDuration: 3_950 },
        { startTime: 4_120, duration: 4_000, blockingDuration: 3_950 },
        { startTime: 8_130, duration: 3_960, blockingDuration: 3_910 },
      ]);
      win.runTimeouts();
      let [wedge] = wedges();
      assert.equal(wedge?.longtask_count, 3);
      assert.equal(wedge?.blocked_ms, 11_810);
      telemetry.stop();
    });

    test('a frame whose entry arrives after the heartbeat still corroborates it', () => {
      telemetry.start();
      freeze();
      win.runTimeouts();
      FakeObserver.deliver('long-animation-frame', [
        { startTime: 120, duration: 11_000, blockingDuration: 10_900 },
      ]);
      win.runTimeouts();
      let [wedge] = wedges();
      assert.equal(wedge?.blocked_ms, 10_900);
      assert.equal(wedge?.top_frame_url, '');
      assert.equal(wedge?.top_frame_char, -1);
      telemetry.stop();
    });

    test('where there is no LoAF, a longtask corroborates it and says how long it blocked', () => {
      FakeObserver.supportedEntryTypes = ['longtask'];
      telemetry.start();
      freeze();
      FakeObserver.deliver('longtask', [
        { startTime: 130, duration: 11_500 },
        { startTime: 20_000, duration: 400 },
      ]);
      win.runTimeouts();
      let [wedge] = wedges();
      assert.equal(wedge?.blocked_ms, 11_500);
      assert.equal(wedge?.longtask_count, 1);
      assert.equal(wedge?.top_frames, '');
      assert.deepEqual(wedge?.loaf_scripts, []);
      telemetry.stop();
    });

    test('with no observer the gap is reported as it is', () => {
      win.PerformanceObserver = undefined;
      telemetry.start();
      freeze();
      win.runTimeouts();
      let [wedge] = wedges();
      assert.equal(wedge?.duration_ms, 12_000);
      assert.equal(wedge?.longtask_count, 0);
      telemetry.stop();
    });

    test('a short gap, or one while the window is hidden, is not a wedge', () => {
      telemetry.start();
      clock = 100;
      win.tick();
      clock = 9_000;
      win.tick();
      win.document.visibilityState = 'hidden';
      clock = 60_000;
      win.tick();
      FakeObserver.deliver('long-animation-frame', [
        { startTime: 200, duration: 8_000, blockingDuration: 8_000 },
        { startTime: 30_000, duration: 11_000, blockingDuration: 11_000 },
      ]);
      win.runTimeouts();
      assert.deepEqual(wedges(), []);
      telemetry.stop();
    });

    test('stopping disconnects the observer', () => {
      telemetry.start();
      assert.equal(FakeObserver.live.size, 1);
      telemetry.stop();
      assert.equal(FakeObserver.live.size, 0);
    });
  });
});
