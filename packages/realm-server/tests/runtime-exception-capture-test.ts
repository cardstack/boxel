import { module, test } from 'qunit';
import { basename } from 'path';
import { EventEmitter } from 'events';
import { attachRuntimeExceptionCapture } from '../prerender/runtime-exception-capture.ts';
import {
  titleForConsoleErrorEntry,
  stackHeaderForConsoleErrorEntry,
} from '../prerender/render-runner.ts';
import type { ConsoleErrorEntry } from '../prerender/page-pool.ts';

// Verifies the V8-layer uncaught-exception capture wired up in
// `runtime-exception-capture.ts`. We test against a fake CDP client
// (an EventEmitter that records `send` calls) so the test stays at
// the contract level — no Chrome, no puppeteer page, no realm. The
// integration with the prerender pipeline is exercised separately
// in `prerendering-test.ts`.
//
// The interesting behaviors:
//
//   1. On `Runtime.exceptionThrown`, the recorder is called with the
//      exceptionId so a follow-up `Runtime.exceptionRevoked` can
//      find and tag the matching entry.
//
//   2. On `Runtime.exceptionRevoked`, the recorder is called with
//      the same exceptionId. The recorder's job is to **tag** the
//      previously-recorded entry as revoked (NOT delete it). The
//      whitepaper-class render bug fits the "thrown then revoked"
//      pattern (RSVP / Backburner attaches a late `.catch` that
//      retracts V8's uncaught status), and an earlier iteration of
//      this module dropped these entries as "transient noise" — but
//      that was actively discarding the actionable stack. Now we
//      keep the entry; render-runner tags the title with
//      "(revoked by late .catch)" so the lifecycle is visible.
//
//   3. Stack frames from `exceptionDetails.stackTrace.callFrames`
//      flow into the `ConsoleErrorEntry.stackFrames` array so the
//      render-runner can format them as a Node-style stack on the
//      surfaced error doc.
//
//   4. When the recorder reports it's at storage limit (`add`
//      returns false), we don't track the exceptionId — so a later
//      revocation for that exceptionId is a no-op rather than
//      tagging some other entry by accident.

class FakeCDPClient extends EventEmitter {
  sentMethods: string[] = [];

  // CDPSession#send(method, params) — we only care about
  // `Runtime.enable`. Resolves immediately like a happy path.
  async send(method: string, _params?: unknown): Promise<unknown> {
    this.sentMethods.push(method);
    return undefined;
  }
}

class FakePage {
  client: FakeCDPClient;
  constructor(client: FakeCDPClient) {
    this.client = client;
  }
  async createCDPSession(): Promise<FakeCDPClient> {
    return this.client;
  }
}

interface RecorderCall {
  type: 'thrown' | 'revoked';
  exceptionId: number;
  entry?: ConsoleErrorEntry;
}

function makeRecorder(opts: { atLimit?: boolean } = {}) {
  let calls: RecorderCall[] = [];
  let entriesByExceptionId = new Map<number, ConsoleErrorEntry>();
  return {
    calls,
    entriesByExceptionId,
    recordThrown(exceptionId: number, entry: ConsoleErrorEntry): boolean {
      calls.push({ type: 'thrown', exceptionId, entry });
      if (opts.atLimit) return false;
      entriesByExceptionId.set(exceptionId, entry);
      return true;
    },
    // Mirrors the production recorder's behavior: keep the entry
    // and tag it as revoked, rather than deleting it. Tests that
    // care about the lifecycle assert on `entry.revoked === true`.
    recordRevoked(exceptionId: number): void {
      calls.push({ type: 'revoked', exceptionId });
      let existing = entriesByExceptionId.get(exceptionId);
      if (existing) {
        existing.revoked = true;
      }
    },
  };
}

function buildExceptionThrownEvent(opts: {
  exceptionId: number;
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  callFrames?: Array<{
    url: string;
    lineNumber: number;
    columnNumber: number;
  }>;
  exception?: {
    description?: string;
    value?: unknown;
  };
}) {
  return {
    timestamp: 0,
    exceptionDetails: {
      exceptionId: opts.exceptionId,
      text: opts.text,
      lineNumber: opts.lineNumber ?? 10,
      columnNumber: opts.columnNumber ?? 20,
      url: opts.url,
      stackTrace: opts.callFrames ? { callFrames: opts.callFrames } : undefined,
      exception: opts.exception,
    },
  };
}

module(basename(import.meta.filename), function () {
  test('records Runtime.exceptionThrown into the recorder', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    assert.strictEqual(
      client.sentMethods[0],
      'Runtime.enable',
      'Runtime.enable is sent before any other CDP traffic',
    );
    assert.true(
      client.sentMethods.includes('Runtime.enable'),
      'Runtime.enable was sent on the CDP session',
    );

    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 7,
        text: 'TypeError: Cannot convert undefined or null to object',
        url: 'http://example.com/script.js',
        callFrames: [
          {
            url: 'http://example.com/throw-site.js',
            lineNumber: 100,
            columnNumber: 5,
          },
        ],
      }),
    );

    assert.strictEqual(
      recorder.calls.length,
      1,
      'recordThrown called exactly once',
    );
    let call = recorder.calls[0];
    assert.strictEqual(call.type, 'thrown', 'first call is a recordThrown');
    assert.strictEqual(
      call.exceptionId,
      7,
      'exceptionId flows through to the recorder so it can match a later revoke',
    );
    let entry = call.entry!;
    assert.strictEqual(
      entry.source,
      'exception',
      'entry source distinguishes Runtime.exceptionThrown from console.error',
    );
    assert.strictEqual(entry.type, 'error', 'entry type is error');
    assert.ok(
      entry.text.includes(
        'TypeError: Cannot convert undefined or null to object',
      ),
      `entry text carries the exception message, got: ${entry.text}`,
    );
    assert.deepEqual(
      entry.location,
      { url: 'http://example.com/script.js', lineNumber: 10, columnNumber: 20 },
      'entry location carries the report-script coords',
    );
    assert.deepEqual(
      entry.stackFrames,
      [
        {
          url: 'http://example.com/throw-site.js',
          lineNumber: 100,
          columnNumber: 5,
        },
      ],
      'entry stackFrames carries CDP callFrames',
    );
  });

  test('tags the entry as revoked on Runtime.exceptionRevoked (does NOT delete)', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 42,
        text: 'TypeError: late-catch',
      }),
    );
    let initialEntry = recorder.entriesByExceptionId.get(42);
    assert.ok(initialEntry, 'entry recorded after exceptionThrown');
    assert.notOk(initialEntry?.revoked, 'entry is not yet flagged as revoked');

    client.emit('Runtime.exceptionRevoked', {
      reason: 'Handler added to rejected promise',
      exceptionId: 42,
    });

    // Critical: the entry STAYS in the bucket. Earlier behavior
    // was to delete it, which discarded the actionable stack for
    // the whitepaper-class render bug (RSVP attached a late
    // `.catch` → V8 retracted the uncaught status → we dropped
    // the only signal the operator had).
    let afterRevoke = recorder.entriesByExceptionId.get(42);
    assert.ok(
      afterRevoke,
      'entry survives revoke — `additionalErrors` will still surface it',
    );
    assert.true(
      afterRevoke?.revoked,
      'entry is tagged revoked so render-runner can mark the title',
    );
    assert.strictEqual(
      recorder.calls.length,
      2,
      'one recordThrown + one recordRevoked (no extra activity)',
    );
    assert.strictEqual(
      recorder.calls[1].type,
      'revoked',
      'second call is the revoke-driven recordRevoked',
    );
    assert.strictEqual(
      recorder.calls[1].exceptionId,
      42,
      'recordRevoked carries the same exceptionId as the original recordThrown',
    );
  });

  test('forwards Runtime.exceptionRevoked to the recorder regardless of prior throws', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    // The capture module is intentionally a thin translator: it
    // forwards every CDP event to the recorder and lets the recorder
    // decide what to do. So a revoke for an exceptionId we never saw
    // a throw for still reaches the recorder; the recorder's own
    // bookkeeping (no entry under that id → nothing to tag) is
    // what makes it a no-op end-to-end.
    client.emit('Runtime.exceptionRevoked', {
      reason: 'Handler added to rejected promise',
      exceptionId: 999,
    });

    assert.strictEqual(
      recorder.calls.length,
      1,
      'recordRevoked is forwarded even without a matching prior recordThrown',
    );
    assert.strictEqual(
      recorder.calls[0].type,
      'revoked',
      'the forwarded call is a recordRevoked',
    );
    assert.strictEqual(
      recorder.calls[0].exceptionId,
      999,
      'exceptionId is preserved verbatim — recorder uses it to look up state',
    );
    assert.false(
      recorder.entriesByExceptionId.has(999),
      'recorder state stays empty when there was nothing to tag',
    );
  });

  test('forwards Runtime.exceptionThrown to the recorder even when storage is full', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    // Recorder simulates storage at limit: returns false from
    // recordThrown without retaining the entry, so a follow-up
    // revoke would have nothing to clean up.
    let recorder = makeRecorder({ atLimit: true });

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 13,
        text: 'TypeError: ignored',
      }),
    );

    assert.strictEqual(
      recorder.calls.length,
      1,
      'recordThrown is forwarded; the recorder decides whether to keep the entry',
    );
    assert.false(
      recorder.entriesByExceptionId.has(13),
      'at-limit recorder dropped the entry; no leftover state for a later revoke',
    );
  });

  test('treats missing ExceptionDetails as a no-op', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    client.emit('Runtime.exceptionThrown', { timestamp: 0 } as any);

    assert.strictEqual(
      recorder.calls.length,
      0,
      'malformed exceptionThrown payload does not invoke recorder',
    );
  });

  test('falls back to a default text when ExceptionDetails has no text', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({ exceptionId: 1, text: '' }),
    );

    let entryText = recorder.calls[0]?.entry?.text ?? '';
    assert.ok(
      entryText.length > 0,
      `entry text falls back to a non-empty default, got: ${entryText}`,
    );
  });

  test('prefers exception.description over the generic CDP text label when no separate stack frames are available', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    // CDP frequently sets `text` to a generic label like "Uncaught"
    // or "Uncaught (in promise)" while the actionable message lives
    // on the RemoteObject's `description`. With no separate
    // `stackTrace.callFrames` available, the full description
    // (including its inline stack) is the only signal we have, so
    // the entry preserves it verbatim — losing the embedded frames
    // here would mean the surfaced error doc has no stack info at
    // all.
    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 100,
        text: 'Uncaught (in promise)',
        exception: {
          description:
            "TypeError: Cannot read properties of undefined (reading 'foo')\n    at Component.bar (chunk.js:42)",
        },
      }),
    );

    let entry = recorder.calls[0]?.entry;
    assert.strictEqual(
      entry?.text,
      "TypeError: Cannot read properties of undefined (reading 'foo')\n    at Component.bar (chunk.js:42)",
      `entry.text keeps the full description when no callFrames are present, got: ${entry?.text}`,
    );
  });

  test("trims the inline stack from exception.description when callFrames will populate the entry's own stack field", async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    // V8 bakes a multi-line stack into `description` for thrown
    // Errors. When CDP also reports the same stack via
    // `stackTrace.callFrames` (which the entry surfaces in its own
    // `stack` field downstream), keeping the full description in
    // `text` would duplicate the frames AND make the message awkward
    // for `#formatConsoleError` to append a location suffix to. So
    // we strip everything after the header line.
    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 101,
        text: 'Uncaught (in promise)',
        exception: {
          description:
            "TypeError: Cannot read properties of undefined (reading 'foo')\n    at Component.bar (chunk.js:42)\n    at Component.baz (chunk.js:84)",
        },
        callFrames: [
          { url: 'chunk.js', lineNumber: 41, columnNumber: 0 },
          { url: 'chunk.js', lineNumber: 83, columnNumber: 0 },
        ],
      }),
    );

    let entry = recorder.calls[0]?.entry;
    assert.strictEqual(
      entry?.text,
      "TypeError: Cannot read properties of undefined (reading 'foo')",
      `entry.text is just the header line so message and stack stay separated, got: ${entry?.text}`,
    );
    assert.strictEqual(
      entry?.stackFrames?.length,
      2,
      'frames still flow into stackFrames so the stack lives in its own field',
    );
  });

  test('falls back to exception.value when description is missing (primitive throw)', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    // `throw 'boom'` produces a RemoteObject with `value` set to the
    // primitive but no `description`. We stringify the value as a
    // fallback so we never surface a bare "Uncaught" entry.
    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 101,
        text: 'Uncaught',
        exception: { value: 'boom-as-primitive' },
      }),
    );

    let entry = recorder.calls[0]?.entry;
    assert.strictEqual(
      entry?.text,
      'boom-as-primitive',
      'entry.text uses exception.value when description is absent',
    );
  });

  test('treats an empty stackTrace.callFrames as no stack (undefined, not empty array)', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 50,
        text: 'TypeError: empty stack',
        callFrames: [],
      }),
    );

    let entry = recorder.calls[0]?.entry;
    assert.strictEqual(
      entry?.stackFrames,
      undefined,
      'empty callFrames maps to undefined stackFrames so render-runner falls back cleanly',
    );
  });

  test('drops stack frames that are missing a url', async function (assert) {
    let client = new FakeCDPClient();
    let page = new FakePage(client);
    let recorder = makeRecorder();

    await attachRuntimeExceptionCapture({
      page: page as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    client.emit(
      'Runtime.exceptionThrown',
      buildExceptionThrownEvent({
        exceptionId: 51,
        text: 'TypeError: mixed frames',
        callFrames: [
          { url: '', lineNumber: 1, columnNumber: 2 },
          {
            url: 'http://example.com/real.js',
            lineNumber: 10,
            columnNumber: 20,
          },
          { url: '', lineNumber: 3, columnNumber: 4 },
        ],
      }),
    );

    let entry = recorder.calls[0]?.entry;
    assert.deepEqual(
      entry?.stackFrames,
      [
        {
          url: 'http://example.com/real.js',
          lineNumber: 10,
          columnNumber: 20,
        },
      ],
      'frames without a url are filtered out — only resolvable sites survive',
    );
  });

  test('resolves silently when CDP session creation throws', async function (assert) {
    let recorder = makeRecorder();
    let throwingPage = {
      async createCDPSession() {
        throw new Error('target closed');
      },
    };

    // Must not throw — best-effort observability shouldn't break the
    // render path. The recorder should also see no calls.
    await attachRuntimeExceptionCapture({
      page: throwingPage as any,
      getAffinityKey: () => 'test-affinity',
      pageId: 'page-1',
      recorder,
    });

    assert.strictEqual(
      recorder.calls.length,
      0,
      'no recorder activity when CDP attach failed',
    );
  });

  // The render-runner-side serialization is the other half of the
  // keep-revoked contract: once the recorder tags an entry with
  // `revoked: true`, the title and stack-header functions need to
  // surface that lifecycle so operators looking at the error doc
  // can tell a thrown-then-revoked exception apart from a plain
  // uncaught one. These functions are otherwise only exercised
  // through the full prerender pipeline, which we can't reliably
  // hit in a unit-style fixture (Ember's runloop catches synthetic
  // throws before V8 sees them as uncaught).
  test('titleForConsoleErrorEntry distinguishes revoked exceptions', function (assert) {
    assert.strictEqual(
      titleForConsoleErrorEntry({
        type: 'error',
        text: 'TypeError: boom',
        source: 'exception',
      }),
      'Uncaught exception',
      'plain uncaught exception',
    );
    assert.strictEqual(
      titleForConsoleErrorEntry({
        type: 'error',
        text: 'TypeError: boom',
        source: 'exception',
        revoked: true,
      }),
      'Uncaught exception (revoked by late .catch)',
      'revoked exception keeps the entry but marks the lifecycle',
    );
    assert.strictEqual(
      titleForConsoleErrorEntry({
        type: 'error',
        text: 'console.error message',
        source: 'console',
      }),
      'Console error',
      'console-source error is unrelated to the revoked branch',
    );
  });

  test('stackHeaderForConsoleErrorEntry distinguishes revoked exceptions', function (assert) {
    assert.strictEqual(
      stackHeaderForConsoleErrorEntry({
        type: 'error',
        text: 'TypeError: boom',
        source: 'exception',
      }),
      'UncaughtException',
    );
    assert.strictEqual(
      stackHeaderForConsoleErrorEntry({
        type: 'error',
        text: 'TypeError: boom',
        source: 'exception',
        revoked: true,
      }),
      'UncaughtExceptionRevoked',
    );
    assert.strictEqual(
      stackHeaderForConsoleErrorEntry({
        type: 'assert',
        text: 'assertion failed',
        source: 'console',
      }),
      'AssertionError',
    );
  });
});
