import QUnit from 'qunit';
import sinon, { type SinonFakeTimers } from 'sinon';
import { basename } from 'node:path';
import {
  IdleBrowserLifecycle,
  browserIdleTimeoutMs,
} from '../prerender/idle-browser-lifecycle.ts';

const { module, test } = QUnit;

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

module(basename(import.meta.filename), function (hooks) {
  let clock: SinonFakeTimers;
  let lifecycle: IdleBrowserLifecycle;
  hooks.beforeEach(function () {
    clock = sinon.useFakeTimers();
  });
  hooks.afterEach(async function () {
    await lifecycle?.stop();
    clock.restore();
  });

  test('idle release waits for the final active or queued request and resets after reuse', async function (assert) {
    let releases = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 1000,
      release: async () => {
        releases++;
      },
      onError: (error) => {
        throw error;
      },
    });
    const first = deferred(),
      second = deferred();
    const a = lifecycle.run(() => first.promise);
    const b = lifecycle.run(() => second.promise);
    await clock.tickAsync(2000);
    assert.strictEqual(releases, 0);
    first.resolve();
    await a;
    await clock.tickAsync(2000);
    assert.strictEqual(releases, 0);
    second.resolve();
    await b;
    await clock.tickAsync(900);
    await lifecycle.run(async () => {});
    await clock.tickAsync(900);
    assert.strictEqual(releases, 0);
    await clock.tickAsync(100);
    assert.strictEqual(releases, 1);
    assert.true(lifecycle.suspended);
    await clock.tickAsync(5000);
    assert.strictEqual(
      releases,
      1,
      'an asleep browser is not repeatedly closed',
    );
  });

  test('requests arriving during shutdown wait, then reuse normal rendering and idle again', async function (assert) {
    const closing = deferred();
    let releases = 0,
      runs = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 1000,
      release: async () => {
        releases++;
        if (releases === 1) await closing.promise;
      },
      onError: (error) => {
        throw error;
      },
    });
    await lifecycle.run(async () => {});
    await clock.tickAsync(1000);
    assert.true(lifecycle.suspended);
    const a = lifecycle.run(async () => {
      runs++;
    });
    const b = lifecycle.run(async () => {
      runs++;
    });
    await clock.tickAsync(2000);
    assert.strictEqual(runs, 0);
    closing.resolve();
    await Promise.all([a, b]);
    assert.strictEqual(runs, 2);
    assert.false(lifecycle.suspended);
    await clock.tickAsync(1000);
    assert.strictEqual(releases, 2);
  });

  test('failed requests still release their lease', async function (assert) {
    let releases = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 1000,
      release: async () => {
        releases++;
      },
      onError: (error) => {
        throw error;
      },
    });
    await assert.rejects(
      lifecycle.run(async () => {
        throw new Error('render failed');
      }),
      /render failed/,
    );
    await clock.tickAsync(1000);
    assert.strictEqual(releases, 1);
  });

  test('stop cancels pending idle cleanup', async function (assert) {
    let releases = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 1000,
      release: async () => {
        releases++;
      },
      onError: (error) => {
        throw error;
      },
    });
    await lifecycle.run(async () => {});
    await lifecycle.stop();
    await clock.tickAsync(2000);
    assert.strictEqual(releases, 0);
    await assert.rejects(
      lifecycle.run(async () => {}),
      /stopped/,
    );
  });

  test('stop during idle shutdown prevents queued requests resurrecting the browser', async function (assert) {
    const closing = deferred();
    let runs = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 1000,
      release: () => closing.promise,
      onError: (error) => {
        throw error;
      },
    });
    await lifecycle.run(async () => {});
    await clock.tickAsync(1000);
    const request = assert.rejects(
      lifecycle.run(async () => {
        runs++;
      }),
      /stopped/,
    );
    const stopped = lifecycle.stop();
    closing.resolve();
    await Promise.all([request, stopped]);
    assert.strictEqual(runs, 0);
  });

  test('a failed idle shutdown is reported and can be retried without poisoning future work', async function (assert) {
    const failure = new Error('close failed');
    const errors: unknown[] = [];
    let releases = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 1000,
      release: async () => {
        if (++releases === 1) throw failure;
      },
      onError: (error) => {
        errors.push(error);
      },
    });
    await lifecycle.run(async () => {});
    await clock.tickAsync(1000);
    assert.deepEqual(errors, [failure]);
    assert.false(lifecycle.suspended);
    assert.strictEqual(await lifecycle.run(async () => 'rendered'), 'rendered');
    await clock.tickAsync(1000);
    assert.true(lifecycle.suspended);
  });

  test('disabled policy preserves warm hosted behavior', async function (assert) {
    let releases = 0;
    lifecycle = new IdleBrowserLifecycle({
      timeoutMs: 0,
      release: async () => {
        releases++;
      },
      onError: (error) => {
        throw error;
      },
    });
    await lifecycle.run(async () => {});
    await clock.tickAsync(24 * 60 * 60 * 1000);
    assert.strictEqual(releases, 0);
  });

  test('timeout configuration rejects ambiguous or unsafe values', function (assert) {
    assert.strictEqual(browserIdleTimeoutMs({}), 0);
    assert.strictEqual(
      browserIdleTimeoutMs({ PRERENDER_BROWSER_IDLE_TIMEOUT_MS: '60000' }),
      60000,
    );
    assert.strictEqual(
      browserIdleTimeoutMs({ PRERENDER_BROWSER_IDLE_TIMEOUT_MS: '0' }),
      0,
    );
    for (const value of ['', '-1', '1.5', 'no', 'Infinity', '2147483648']) {
      assert.throws(
        () =>
          browserIdleTimeoutMs({ PRERENDER_BROWSER_IDLE_TIMEOUT_MS: value }),
        /must be an integer/,
      );
    }
  });
});
