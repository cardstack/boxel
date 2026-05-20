import { module, test } from 'qunit';
import { basename } from 'path';
import { serializeFatalReason } from '../lib/serialize-fatal-reason';

// Pure-function tests for the renderer that worker.ts hands to
// `writeSync(2, ...)` on the fatal-exit path (CS-11200). We can't
// reasonably unit-test the actual FD-level write behavior — that
// requires a real child_process.spawn + libuv-piped stderr, and the
// bug it fixes only manifests when the child does `process.exit(1)`
// before libuv flushes. The verifiable part is the serialization:
// the stack is preserved, and the `error.cause` chain (where Node
// fetch / undici / TLS errors actually live their reason) survives.

module(basename(__filename), function () {
  test('preserves the stack trace for an Error', function (assert) {
    let err = new Error('boom');
    let out = serializeFatalReason(err);
    assert.ok(
      /Error: boom/.test(out),
      'message+name appears in output',
    );
    assert.ok(
      /serialize-fatal-reason-test/.test(out),
      'stack frames are included',
    );
  });

  test('falls back to name+message when stack is absent', function (assert) {
    let err = new Error('no-stack');
    delete (err as { stack?: string }).stack;
    let out = serializeFatalReason(err);
    assert.strictEqual(out, 'Error: no-stack');
  });

  test('renders a non-Error value via String()', function (assert) {
    assert.strictEqual(serializeFatalReason('plain string'), 'plain string');
    assert.strictEqual(serializeFatalReason(42), '42');
    assert.strictEqual(serializeFatalReason(null), 'null');
    assert.strictEqual(serializeFatalReason(undefined), 'undefined');
  });

  test('walks the cause chain (Node fetch surfaces real reason on .cause)', function (assert) {
    let socketErr = new Error('ECONNRESET: socket hang up');
    delete (socketErr as { stack?: string }).stack;
    // Build via assignment rather than `new TypeError(msg, { cause })`
    // because the package's TS lib target predates ES2022's
    // ErrorOptions constructor signature.
    let fetchErr = new TypeError('fetch failed') as TypeError & {
      cause?: unknown;
    };
    fetchErr.cause = socketErr;
    delete (fetchErr as { stack?: string }).stack;
    let out = serializeFatalReason(fetchErr);
    assert.ok(
      /TypeError: fetch failed/.test(out),
      'top-level message included',
    );
    assert.ok(
      /Caused by: Error: ECONNRESET: socket hang up/.test(out),
      'cause is rendered with the Caused by prefix',
    );
  });

  test('handles a non-Error cause value', function (assert) {
    let err = new Error('outer') as Error & { cause?: unknown };
    err.cause = { code: 'ENOTFOUND', message: 'whatever' };
    let out = serializeFatalReason(err);
    assert.ok(/Caused by: \[object Object\]/.test(out));
  });

  test('does not loop on a self-referential cause', function (assert) {
    let err = new Error('cyclic') as Error & { cause?: unknown };
    err.cause = err;
    let out = serializeFatalReason(err);
    assert.ok(/Error: cyclic/.test(out));
    // 8 cause-line cap + the top-level line
    let causedByCount = (out.match(/Caused by:/g) ?? []).length;
    assert.ok(
      causedByCount <= 8,
      `cause chain capped at 8, saw ${causedByCount}`,
    );
  });
});
