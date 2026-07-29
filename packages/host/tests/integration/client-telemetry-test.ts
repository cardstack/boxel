import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type ClientTelemetryService from '@cardstack/host/services/client-telemetry';
import type { ClientErrorEvent } from '@cardstack/host/services/client-telemetry';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';
import { suspendGlobalErrorHook } from '../helpers/uncaught-exceptions';

// A `window` error event shaped like the one a browser dispatches for an
// uncaught throw. The module suspends QUnit's global error hook, so these
// synthetic throws are collected rather than failing the suite.
function dispatchUncaught(
  error: unknown,
  location: { filename?: string; lineno?: number; colno?: number } = {},
) {
  let message = (error as { message?: unknown })?.message;
  window.dispatchEvent(
    new ErrorEvent('error', {
      message: `Uncaught ${typeof message === 'string' ? message : String(error)}`,
      filename: location.filename ?? '',
      lineno: location.lineno ?? 0,
      colno: location.colno ?? 0,
      error,
    }),
  );
}

// QUnit routes every `window.onerror` call through its uncaught-exception hook,
// which this module's suspension collects and the suite's diagnostics log. That
// is what proves a single dispatch behaves like a real uncaught throw, but a
// test that throws hundreds of times does not need hundreds of log lines to make
// its point.
function quietly(body: () => void) {
  let saved = window.onerror;
  window.onerror = null;
  try {
    body();
  } finally {
    window.onerror = saved;
  }
}

function dispatchRejection(reason: unknown) {
  // The event constructor needs a promise. Keep it handled so dispatching a
  // synthetic rejection doesn't leave a real one behind.
  let promise = Promise.reject(reason);
  promise.catch(() => {});
  window.dispatchEvent(
    new PromiseRejectionEvent('unhandledrejection', { promise, reason }),
  );
}

// An error carrying a stack this test wrote, so the frame parse and the frame
// bounds can be asserted against known input rather than against whatever
// shape the engine and the build happen to produce.
function errorWithStack(message: string, frames: string[]): Error {
  let error = new Error(message);
  error.stack = [`Error: ${message}`, ...frames].join('\n');
  return error;
}

function frames(count: number, width = 1): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `    at frame${i} (https://realm.example/my-realm/${'d'.repeat(width)}.gts:${i + 1}:1)`,
  );
}

// The instrument is gated off under `isTesting()` and only arms when a test
// opts in via `enableForTest()`. These tests drive its public emit API and
// assert the event shapes the realm-server ingest + Grafana dashboard depend
// on, without relying on the flush timer, a session token, or the network.
module('Integration | Service | client-telemetry', function (hooks) {
  setupRenderingTest(hooks);
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    autostart: true,
  });
  // Several tests dispatch uncaught errors and unhandled rejections on purpose;
  // QUnit would otherwise report each as a suite-level failure. The collector
  // doubles as proof the synthetic dispatch really did travel the global
  // error path.
  let { capturedExceptions } = suspendGlobalErrorHook(hooks);

  function telemetry(): ClientTelemetryService {
    return getService('client-telemetry') as ClientTelemetryService;
  }

  function clientErrors(svc: ClientTelemetryService): ClientErrorEvent[] {
    return svc
      .drainBufferForTest()
      .filter((e): e is ClientErrorEvent => e.event_type === 'client-error');
  }

  hooks.afterEach(function () {
    // Every test arms the instrument; make sure it is torn down so no interval
    // or observer leaks into the next test.
    telemetry().teardown();
    capturedExceptions.length = 0;
  });

  test('is disabled under tests until explicitly opted in', function (assert) {
    let svc = telemetry();
    assert.false(svc.isEnabled, 'dormant under isTesting() by default');
    svc.enableForTest();
    assert.true(svc.isEnabled, 'armed after enableForTest()');
  });

  test('records a server-request event with a normalized endpoint', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let req = new Request('https://realm.example/my-realm/_search', {
      method: 'POST',
    });
    let res = new Response('{}', {
      status: 200,
      headers: {
        'content-length': '2',
        'x-boxel-realm-url': 'https://realm.example/my-realm/',
      },
    });
    svc.recordServerRequestTiming(req, res, 42.7, true);

    let events = svc.drainBufferForTest();
    assert.strictEqual(events.length, 1, 'one event buffered');
    let e = events[0] as any;
    assert.strictEqual(e.event_type, 'server-request');
    assert.strictEqual(e.endpoint, '_search', 'underscore endpoint collapses');
    assert.strictEqual(e.method, 'POST');
    assert.strictEqual(e.status, 200);
    assert.strictEqual(e.duration_ms, 43, 'duration is rounded');
    assert.strictEqual(e.resp_bytes, 2);
    assert.true(e.retried, 'retried flag carried through');
    assert.strictEqual(e.realm, 'https://realm.example/my-realm/');
    assert.strictEqual(typeof e.ts, 'number', 'timestamp stamped');
  });

  test('normalizes a card GET to a low-cardinality label', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();
    svc.recordServerRequestTiming(
      new Request('https://realm.example/my-realm/Person/abc123', {
        method: 'GET',
      }),
      new Response(null, { status: 200 }),
      10,
      false,
    );
    let e = svc.drainBufferForTest()[0] as any;
    assert.strictEqual(
      e.endpoint,
      'GET card',
      'an instance id collapses to "GET card" (no per-id cardinality)',
    );
  });

  test('records a deserialize event with doc size and card type', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let doc: Record<string, unknown> = {
      data: { id: 'x' },
      included: [{}, {}],
    };
    // The fetch stamps the response byte size on the doc; the hook reads it
    // rather than re-serializing the document.
    Object.defineProperty(doc, Symbol.for('boxel-doc-response-bytes'), {
      value: 4096,
      enumerable: false,
    });
    svc.recordDeserialize({
      durationMs: 12.2,
      doc,
      resource: {
        meta: {
          adoptsFrom: {
            module: 'https://realm.example/my-realm/person',
            name: 'Person',
          },
          realmURL: 'https://realm.example/my-realm/',
        },
      } as any,
    });

    let e = svc.drainBufferForTest()[0] as any;
    assert.strictEqual(e.event_type, 'deserialize');
    assert.strictEqual(e.duration_ms, 12);
    assert.strictEqual(e.included_count, 2);
    assert.strictEqual(
      e.card_type,
      'https://realm.example/my-realm/person/Person',
      'the type is addressed by module and export, not a bare class name',
    );
    assert.strictEqual(e.realm, 'https://realm.example/my-realm/');
    assert.strictEqual(
      e.doc_bytes,
      4096,
      'doc size is read from the stamped response byte size',
    );
  });

  test('a recorded event carries the wedge breadcrumb shape', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();
    svc.recordEvent({
      event_type: 'wedge',
      duration_ms: 3000,
      worst_gap_ms: 3000,
      blocked_ms: 2900,
      longtask_count: 4,
      top_frame_function: 'compute',
      top_frame_url: 'https://realm.example/my-realm/person',
      top_frame_char: 120,
      top_frame_blocked_ms: 2800,
      top_frames: 'compute @ https://realm.example/my-realm/person:120',
      loaf_scripts: [
        {
          source_url: 'https://realm.example/my-realm/person',
          function_name: 'compute',
          char_position: 120,
          invoker: 'classAttribute',
          blocking_duration_ms: 2800,
        },
      ],
    });
    let e = svc.drainBufferForTest()[0] as any;
    assert.strictEqual(e.event_type, 'wedge');
    assert.strictEqual(e.blocked_ms, 2900);
    assert.strictEqual(
      e.top_frame_function,
      'compute',
      'the wedging frame is surfaced as a scalar field',
    );
    assert.strictEqual(e.loaf_scripts[0].function_name, 'compute');
  });

  test('records a client-error event for an uncaught window error', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let thrown = new Error('boom');
    dispatchUncaught(thrown, {
      filename: 'https://realm.example/my-realm/person.gts',
      lineno: 42,
      colno: 7,
    });

    let events = clientErrors(svc);
    assert.strictEqual(events.length, 1, 'one client-error event buffered');
    let e = events[0];
    assert.strictEqual(e.kind, 'error', 'the uncaught-throw channel');
    assert.strictEqual(
      e.message,
      'Error: boom',
      'the message names the error class, which message alone never carries',
    );
    assert.strictEqual(
      e.source_url,
      'https://realm.example/my-realm/person.gts',
    );
    assert.strictEqual(e.line, 42);
    assert.strictEqual(e.col, 7);
    assert.strictEqual(e.dedup_count, 1, 'a lone error accounts for itself');
    assert.strictEqual(typeof e.ts, 'number', 'timestamp stamped');

    let expected = (thrown.stack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    assert.deepEqual(
      e.stack.split('\n').slice(0, 5),
      expected.slice(0, 5),
      "the throw's own frames are carried, trimmed but otherwise verbatim",
    );
    assert.true(
      e.stack.includes(e.top_frame_function),
      'the scalar top frame is lifted out of the captured stack',
    );
    assert.strictEqual(
      capturedExceptions.length,
      1,
      'the synthetic throw travelled the real global error path',
    );
  });

  test('records a client-error event for an unhandled rejection', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    dispatchRejection(
      errorWithStack('rejected', [
        '    at reestablish (https://realm.example/my-realm/store.gts:9:15)',
        '    at caller (https://realm.example/my-realm/file.gts:3:1)',
      ]),
    );

    let e = clientErrors(svc)[0];
    assert.strictEqual(e.kind, 'unhandledrejection');
    assert.strictEqual(e.message, 'Error: rejected');
    assert.strictEqual(
      e.stack,
      'Error: rejected\n' +
        'at reestablish (https://realm.example/my-realm/store.gts:9:15)\n' +
        'at caller (https://realm.example/my-realm/file.gts:3:1)',
      'the whole stack rides along, one frame per line',
    );
    // A rejection carries no location of its own, so these come from the stack.
    assert.strictEqual(e.top_frame_function, 'reestablish');
    assert.strictEqual(
      e.source_url,
      'https://realm.example/my-realm/store.gts',
      'the throw site is parsed out of the first frame',
    );
    assert.strictEqual(e.line, 9);
    assert.strictEqual(e.col, 15);
  });

  test('the top frame is parsed out of every engine and url shape', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let cases: Array<[string, string, string, number, number]> = [
      // V8, the common shape.
      [
        '    at compute (https://realm.example/my-realm/person.gts:12:34)',
        'compute',
        'https://realm.example/my-realm/person.gts',
        12,
        34,
      ],
      // A url carrying parens and percent-escapes: the function name has to
      // survive them, because it is the grouping key.
      [
        '    at compute (webpack://app/(chunk%20a)/person.gts:12:34)',
        'compute',
        'webpack://app/(chunk%20a)/person.gts',
        12,
        34,
      ],
      // SpiderMonkey / JSC. The url's own `@` must not be mistaken for the
      // engine's function-name delimiter.
      [
        'compute@https://realm.example/my-realm/@cardstack/person.gts:12:34',
        'compute',
        'https://realm.example/my-realm/@cardstack/person.gts',
        12,
        34,
      ],
      // An anonymous V8 frame: a location and nothing else.
      [
        '    at https://realm.example/my-realm/person.gts:12:34',
        '',
        'https://realm.example/my-realm/person.gts',
        12,
        34,
      ],
      // A scoped package in a V8 location. The `@` belongs to the url here —
      // splitting on it would cut the url in half.
      [
        '    at https://realm.example/assets/@cardstack/boxel-ui.js:1:2',
        '',
        'https://realm.example/assets/@cardstack/boxel-ui.js',
        1,
        2,
      ],
      // An anonymous SpiderMonkey / JSC frame: the delimiter leads, so the
      // function name is empty and the url starts after it.
      [
        '@https://realm.example/my-realm/person.gts:12:34',
        '',
        'https://realm.example/my-realm/person.gts',
        12,
        34,
      ],
      // A method on a class, and an async frame — both are function names with
      // spaces or dots in them.
      [
        '    at async Store.reestablish (https://realm.example/my-realm/store.gts:7:9)',
        'async Store.reestablish',
        'https://realm.example/my-realm/store.gts',
        7,
        9,
      ],
    ];

    quietly(() => {
      cases.forEach(([frame], i) => {
        // The message is deliberately plain: a message that reads like a frame
        // would be a different test (the one below).
        dispatchUncaught(errorWithStack(`frame shape ${i}`, [frame]));
      });
    });

    let events = clientErrors(svc);
    assert.strictEqual(
      events.length,
      cases.length,
      'one event per frame shape',
    );
    events.forEach((e, i) => {
      let [frame, fn, url, line, col] = cases[i];
      assert.strictEqual(e.top_frame_function, fn, `function name of ${frame}`);
      assert.strictEqual(e.source_url, url, `url of ${frame}`);
      assert.strictEqual(e.line, line, `line of ${frame}`);
      assert.strictEqual(e.col, col, `col of ${frame}`);
    });
  });

  test('a message that reads like a frame is not mistaken for one', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    // The engine opens a stack with the message, which can be shaped exactly
    // like a frame. The real throw site is the frame below it.
    dispatchRejection(
      errorWithStack(
        'unable to load (https://realm.example/my-realm/other.gts:99:99)',
        ['    at compute (https://realm.example/my-realm/person.gts:12:34)'],
      ),
    );

    let e = clientErrors(svc)[0];
    assert.strictEqual(e.top_frame_function, 'compute');
    assert.strictEqual(
      e.source_url,
      'https://realm.example/my-realm/person.gts',
      'the location comes from the frame, not from the message above it',
    );
    assert.strictEqual(e.line, 12);
    assert.strictEqual(e.col, 34);
  });

  test('a deep stack keeps its top frames and stays within both bounds', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    dispatchRejection(errorWithStack('deep', frames(40)));
    let byFrameCount = clientErrors(svc)[0].stack.split('\n');
    assert.strictEqual(byFrameCount.length, 16, 'bounded by frame count');
    assert.strictEqual(
      byFrameCount[0],
      'Error: deep',
      'the top of the stack survives',
    );
    assert.strictEqual(
      byFrameCount[1],
      'at frame0 (https://realm.example/my-realm/d.gts:1:1)',
      'the throw site is the first frame kept',
    );
    assert.notOk(
      byFrameCount.some((f) => f.includes('frame20')),
      'the deep tail is what gets dropped',
    );

    // Frames wide enough that the character budget bites before the frame count
    // does — the same truncation from the deep end has to apply there too.
    dispatchRejection(errorWithStack('wide', frames(40, 400)));
    let byChars = clientErrors(svc)[0].stack;
    assert.true(byChars.length <= 2000, 'bounded by character budget');
    assert.true(
      byChars.startsWith('Error: wide\nat frame0 '),
      'still truncated from the deep end, not the top',
    );
  });

  test('an oversized message cannot starve the frames out of the stack', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    // An error carrying a response body or a serialized document runs to
    // thousands of characters, and that message is the stack's first line.
    dispatchRejection(errorWithStack('x'.repeat(4000), frames(3)));

    let e = clientErrors(svc)[0];
    let lines = e.stack.split('\n');
    assert.true(e.stack.length <= 2000, 'still within the character budget');
    assert.true(
      lines[0].endsWith('…'),
      'the oversized header is cut, and says so',
    );
    assert.strictEqual(
      lines[1],
      'at frame0 (https://realm.example/my-realm/d.gts:1:1)',
      'the throw site survives a header that would otherwise consume the whole budget',
    );
    assert.strictEqual(
      lines.length,
      4,
      'and so do the frames below it (header + 3)',
    );
    assert.strictEqual(
      e.top_frame_function,
      'frame0',
      'the location fields come from the stack as given, not from the bounded copy',
    );
    assert.strictEqual(e.source_url, 'https://realm.example/my-realm/d.gts');
    assert.strictEqual(e.line, 1);
    assert.strictEqual(
      e.message,
      `${`Error: ${'x'.repeat(4000)}`.slice(0, 300)}…`,
      'the message field keeps its own tighter budget',
    );
  });

  test('a rejection with no error object reports a message and no stack', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    dispatchRejection('plain string reason');
    let e = clientErrors(svc)[0];
    assert.strictEqual(e.message, 'plain string reason');
    assert.strictEqual(
      e.stack,
      '',
      'a reason that is not an error has no stack to report, and the instrument does not invent one from its own listener',
    );
    assert.strictEqual(e.top_frame_function, '');
    assert.strictEqual(e.source_url, '');
    assert.strictEqual(e.line, 0);

    dispatchRejection({ code: 42 });
    assert.strictEqual(
      clientErrors(svc)[0].message,
      '[object Object]',
      'an opaque reason still produces an event rather than being dropped',
    );
  });

  test('an error storm reports one event with a count and leaves other signals alone', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    svc.recordEvent({
      event_type: 'card-load',
      card_id: 'https://realm.example/my-realm/Person/1',
      realm: 'https://realm.example/my-realm/',
      loading_ms: 10,
      settle_ms: 12,
      num_loads: 1,
      loaded_ids: [],
      slowest_loads: [],
    });
    let looping = errorWithStack('render loop', frames(3));
    quietly(() => {
      for (let i = 0; i < 300; i++) {
        dispatchUncaught(looping);
      }
    });

    let buffered = svc.drainBufferForTest();
    let errors = buffered.filter((e) => e.event_type === 'client-error');
    assert.strictEqual(errors.length, 1, '300 identical throws, one event');
    assert.strictEqual(
      (errors[0] as ClientErrorEvent).dedup_count,
      300,
      'every occurrence is counted on the one event',
    );
    assert.strictEqual(
      buffered.filter((e) => e.event_type === 'card-load').length,
      1,
      'the storm did not evict the other signal types from the buffer',
    );
  });

  test('distinct errors past the window budget fold into one counted event', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    quietly(() => {
      for (let i = 0; i < 30; i++) {
        dispatchUncaught(errorWithStack(`distinct failure ${i}`, frames(2)));
      }
    });

    let errors = clientErrors(svc);
    assert.true(
      errors.length <= 12,
      `bounded to the per-window event budget (got ${errors.length})`,
    );
    assert.strictEqual(
      errors.reduce((sum, e) => sum + e.dedup_count, 0),
      30,
      'no occurrence is lost — the folded event counts the whole group',
    );
  });

  test('message_key collapses the ids a message varies by', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let base = 'unable to fetch https://realm.example/my-realm/Person/';
    quietly(() => {
      dispatchUncaught(errorWithStack(`${base}abc123: 404`, frames(2)));
      dispatchUncaught(errorWithStack(`${base}def456: 404`, frames(2)));
    });

    let errors = clientErrors(svc);
    assert.strictEqual(
      errors.length,
      1,
      'the same failure against a different instance is one error, not two',
    );
    assert.strictEqual(errors[0].dedup_count, 2);
    assert.strictEqual(
      errors[0].message_key,
      'Error: unable to fetch https://realm.example/my-realm/Person/*: 404',
      'the instance id collapses; the status code is short enough to survive',
    );
    assert.strictEqual(
      errors[0].message,
      `Error: ${base}abc123: 404`,
      'the message stays verbatim',
    );
  });

  test('the error channel is dormant until a test opts in', function (assert) {
    let svc = telemetry();
    assert.false(svc.isEnabled, 'precondition: dormant under isTesting()');
    quietly(() => dispatchUncaught(new Error('should not be recorded')));
    assert.strictEqual(
      svc.drainBufferForTest().length,
      0,
      'an uncaught error records nothing while the instrument is off',
    );
  });

  test('the error channel is silent inside a render context', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();
    let globals = globalThis as { __boxelRenderContext?: unknown };
    let saved = globals.__boxelRenderContext;
    globals.__boxelRenderContext = true;
    try {
      quietly(() => dispatchUncaught(new Error('a render that threw')));
      assert.strictEqual(
        clientErrors(svc).length,
        0,
        'a throw during a prerender is an indexing outcome, not a client fault',
      );
    } finally {
      globals.__boxelRenderContext = saved;
    }
  });

  test('teardown disarms the instrument and drops further events', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    assert.true(svc.isEnabled);
    svc.teardown();
    assert.false(svc.isEnabled, 'disarmed after teardown');
    svc.recordEvent({
      event_type: 'keepalive',
      window_ms: 1,
      max_gap_ms: 0,
    });
    assert.strictEqual(
      svc.drainBufferForTest().length,
      0,
      'recordEvent is a no-op once disarmed',
    );
    quietly(() => dispatchUncaught(new Error('after teardown')));
    assert.strictEqual(
      svc.drainBufferForTest().length,
      0,
      'the window error listeners are released with everything else',
    );
  });
});
