import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type ClientTelemetryService from '@cardstack/host/services/client-telemetry';
import type { ClientErrorEvent } from '@cardstack/host/services/client-telemetry';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';
import { suspendGlobalErrorHook } from '../helpers/uncaught-exceptions';

// A `window` error event shaped like the one a browser dispatches for an
// uncaught throw.
//
// An ErrorEvent dispatched at the window invokes `window.onerror`, and two
// harnesses hook it: QUnit, whose uncaught-exception path this module suspends,
// and — under the test runner that CI uses — testem's client, which reports
// anything reaching `window.onerror` to its server as a "Global error" and fails
// the run. Suspending QUnit's hook does nothing about testem's. So the property
// itself is detached for the length of each dispatch, which covers every such
// handler including ones no test knows about. `assertNoGlobalErrorReported`
// keeps this honest without depending on which runner is driving.
function dispatchUncaught(
  error: unknown,
  location: { filename?: string; lineno?: number; colno?: number } = {},
) {
  let message = (error as { message?: unknown })?.message;
  let savedOnError = window.onerror;
  window.onerror = null;
  try {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: `Uncaught ${typeof message === 'string' ? message : String(error)}`,
        filename: location.filename ?? '',
        lineno: location.lineno ?? 0,
        colno: location.colno ?? 0,
        error,
      }),
    );
  } finally {
    window.onerror = savedOnError;
  }
}

// A synthetic throw must stay invisible to whatever global error reporting the
// harness installed, or it fails the run it is supposed to be exercising. Probe
// with a handler of our own rather than trusting a specific runner's plumbing.
function assertNoGlobalErrorReported(
  assert: Assert,
  body: () => void,
  message: string,
) {
  let reported = 0;
  let savedOnError = window.onerror;
  window.onerror = () => {
    reported++;
    return true;
  };
  try {
    body();
  } finally {
    window.onerror = savedOnError;
  }
  assert.strictEqual(reported, 0, message);
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
  // Several tests dispatch unhandled rejections on purpose, and QUnit's own
  // listener would report each as a suite-level failure. The collector doubles as
  // proof that such a dispatch really does travel the global rejection path.
  // (Uncaught errors need no suspension here — `dispatchUncaught` detaches
  // `window.onerror` for the length of its dispatch, which is what every runner
  // hooks.)
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
    assertNoGlobalErrorReported(
      assert,
      () =>
        dispatchUncaught(thrown, {
          filename: 'https://realm.example/my-realm/person.gts',
          lineno: 42,
          colno: 7,
        }),
      "a synthetic throw stays invisible to the harness's global error reporting",
    );

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
    // Containment, not an exact count: the collector spans the module and the
    // app's own boot leaves incidental rejections in it (a mock-matrix fetch
    // that fails in the test environment), so a count would assert on unrelated
    // noise. What matters is that this rejection reached the global path at all —
    // which is why the module suspends that path in the first place.
    assert.true(
      capturedExceptions.some(
        (captured) => (captured as Error | undefined)?.message === 'rejected',
      ),
      'the synthetic rejection travelled the real global rejection path',
    );
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

    cases.forEach(([frame], i) => {
      // The message is deliberately plain: a message that reads like a frame
      // would be a different test (the one below).
      dispatchUncaught(errorWithStack(`frame shape ${i}`, [frame]));
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
    assert.strictEqual(
      byFrameCount.length,
      17,
      'bounded by frame count — 16 frames, plus the message above them',
    );
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
      `${`Error: ${'x'.repeat(4000)}`.slice(0, 299)}…`,
      'the message field keeps its own tighter budget',
    );
    assert.strictEqual(e.message.length, 300, 'the marker counts against it');
  });

  test('the frames survive every shape of oversized message', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    // The header budget has to key off "is this line a frame", and the cheap
    // tests for that are wrong in opposite directions: a message mentioning a
    // scoped module or a user id carries a bare `@`, and a message can span
    // lines, so bounding only the first one leaves the rest to crowd the frames
    // out. Each of these once emitted a stack with no frames at all.
    let bulk = 'x'.repeat(3000);
    let cases: Array<[string, string]> = [
      ['a plain oversized message', `failed to save: ${bulk}`],
      [
        'a message naming a scoped module',
        `cannot load @cardstack/boxel-ui/components: ${bulk}`,
      ],
      ['a message naming an account', `@user:localhost denied: ${bulk}`],
      [
        'a message spanning several lines',
        `failed to save\n${'y'.repeat(1200)}\n${'z'.repeat(1200)}`,
      ],
    ];

    cases.forEach(([label, message]) => {
      dispatchRejection(errorWithStack(message, frames(3)));
      let e = clientErrors(svc)[0];
      let lines = e.stack.split('\n');
      assert.true(e.stack.length <= 2000, `${label}: within budget`);
      assert.strictEqual(
        lines.filter((line) => line.startsWith('at frame')).length,
        3,
        `${label}: every frame survives`,
      );
      assert.strictEqual(
        e.top_frame_function,
        'frame0',
        `${label}: the throw site is still named`,
      );
    });
  });

  test('a stack of frames with no message at all keeps them', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    // SpiderMonkey and JSC write frames with no message line above them, so
    // there is no header to bound — the whole stack is frames.
    let error = new Error('firefox shaped');
    error.stack = [
      'computeTitle@https://realm.example/my-realm/person.gts:12:34',
      'render@https://realm.example/my-realm/card.gts:3:1',
    ].join('\n');
    dispatchRejection(error);

    let e = clientErrors(svc)[0];
    assert.strictEqual(
      e.stack,
      'computeTitle@https://realm.example/my-realm/person.gts:12:34\n' +
        'render@https://realm.example/my-realm/card.gts:3:1',
      'both frames kept, nothing mistaken for a header',
    );
    assert.strictEqual(e.top_frame_function, 'computeTitle');
  });

  test('two long messages sharing a prefix stay distinct errors', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    // A message carrying a serialized document is longer than the grouping key,
    // and two of them differ only at the end. Cutting the key to its budget
    // would merge them and report only the first.
    let prefix = `failed to save document ${'q'.repeat(400)}`;
    dispatchRejection(errorWithStack(`${prefix} cause: network`, frames(2)));
    dispatchRejection(errorWithStack(`${prefix} cause: conflict`, frames(2)));

    let errors = clientErrors(svc);
    assert.strictEqual(errors.length, 2, 'two errors, not one merged pair');
    assert.notStrictEqual(
      errors[0].message_key,
      errors[1].message_key,
      'their grouping keys differ even though the messages share a long prefix',
    );
    errors.forEach((e) => {
      assert.true(e.message_key.length <= 160, 'and each key stays bounded');
      assert.notOk(
        e.message_key.includes('\n'),
        'and stays on one line, since it is read in a table cell',
      );
    });
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
    for (let i = 0; i < 300; i++) {
      dispatchUncaught(looping);
    }

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

    for (let i = 0; i < 30; i++) {
      dispatchUncaught(errorWithStack(`distinct failure ${i}`, frames(2)));
    }

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
    // The folded event's message is only a sample of its group, so it has to say
    // so: otherwise it reads exactly like one error that looped that many times.
    let folded = errors.filter((e) => e.folded_signatures > 0);
    assert.strictEqual(folded.length, 1, 'exactly one event is a folded group');
    assert.strictEqual(
      folded[0].folded_signatures,
      30 - (errors.length - 1),
      'and it says how many distinct errors it stands for',
    );
    assert.true(
      errors
        .filter((e) => e.folded_signatures === 0)
        .every((e) => e.dedup_count === 1),
      'an unfolded event counts occurrences of its own error only',
    );
  });

  test('message_key collapses the ids a message varies by', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let base = 'unable to fetch https://realm.example/my-realm/Person/';
    dispatchUncaught(errorWithStack(`${base}abc123: 404`, frames(2)));
    dispatchUncaught(errorWithStack(`${base}def456: 404`, frames(2)));

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
    dispatchUncaught(new Error('should not be recorded'));
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
      dispatchUncaught(new Error('a render that threw'));
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
    dispatchUncaught(new Error('after teardown'));
    assert.strictEqual(
      svc.drainBufferForTest().length,
      0,
      'the window error listeners are released with everything else',
    );
  });
});
