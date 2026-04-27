import { module, test } from 'qunit';
import { basename } from 'path';
import { EventEmitter } from 'events';
import { attachRuntimeExceptionCapture } from '../prerender/runtime-exception-capture';
import type { ConsoleErrorEntry } from '../prerender/page-pool';

// Verifies the V8-layer uncaught-exception capture wired up in
// `runtime-exception-capture.ts`. We test against a fake CDP client
// (an EventEmitter that records `send` calls) so the test stays at
// the contract level — no Chrome, no puppeteer page, no realm. The
// integration with the prerender pipeline is exercised separately
// in `prerendering-test.ts`.
//
// The interesting behaviors:
//
//   1. On `Runtime.exceptionThrown`, we record an entry under a
//      stable key (`exception:${exceptionId}`) so a follow-up
//      `Runtime.exceptionRevoked` can find and remove it.
//
//   2. On `Runtime.exceptionRevoked`, we remove the previously-
//      recorded entry. This is the seam that catches RSVP /
//      Backburner late-`.catch` cases — V8 reports the throw at
//      Layer 1 but later retracts the "uncaught" status, so we
//      drop the entry to avoid surfacing transient noise.
//
//   3. Stack frames from `exceptionDetails.stackTrace.callFrames`
//      flow into the `ConsoleErrorEntry.stackFrames` array so the
//      render-runner can format them as a Node-style stack on the
//      surfaced error doc.
//
//   4. When the recorder reports it's at storage limit (`add`
//      returns false), we don't track the exceptionId — so a later
//      revocation for that exceptionId is a no-op rather than
//      removing some other entry by accident.

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
    recordRevoked(exceptionId: number): void {
      calls.push({ type: 'revoked', exceptionId });
      entriesByExceptionId.delete(exceptionId);
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

module(basename(__filename), function () {
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

  test('removes the entry on Runtime.exceptionRevoked', async function (assert) {
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
    assert.true(
      recorder.entriesByExceptionId.has(42),
      'entry recorded after exceptionThrown',
    );

    client.emit('Runtime.exceptionRevoked', {
      reason: 'Handler added to rejected promise',
      exceptionId: 42,
    });

    assert.false(
      recorder.entriesByExceptionId.has(42),
      'entry removed after exceptionRevoked — RSVP late-catch case dropped cleanly',
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
    // bookkeeping (no entry under that id → nothing to remove) is
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
      'recorder state stays empty when there was nothing to remove',
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

  test('prefers exception.description over the generic CDP text label', async function (assert) {
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
    // on the RemoteObject's `description`. The capture should pick
    // the description so the surfaced error doc carries the real
    // type + message instead of a useless label.
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
    assert.true(
      entry?.text.startsWith(
        "TypeError: Cannot read properties of undefined (reading 'foo')",
      ),
      `entry.text uses exception.description, got: ${entry?.text}`,
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
});
