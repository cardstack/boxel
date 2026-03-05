import { afterAll, afterEach, beforeEach, expect } from 'vitest';
import * as ContentTagGlobal from 'content-tag';
import QUnit from 'qunit';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import 'decorator-transforms/globals';
import '../setup-logger';

(globalThis as any).__environment = 'test';
(globalThis as any).ContentTagGlobal = ContentTagGlobal;

// Match the QUnit test entrypoint behavior so timers don't keep Vitest workers alive.
{
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const handle = originalSetTimeout(...args);
    if (typeof (handle as any)?.unref === 'function') {
      (handle as any).unref();
    }
    return handle;
  }) as typeof setTimeout;
  global.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const handle = originalSetInterval(...args);
    if (typeof (handle as any)?.unref === 'function') {
      (handle as any).unref();
    }
    return handle;
  }) as typeof setInterval;
}

type CompatAssert = {
  test: { testName: string };
  ok(value: unknown, message?: string): void;
  notOk(value: unknown, message?: string): void;
  true(value: unknown, message?: string): void;
  false(value: unknown, message?: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
  notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  throws(fn: () => unknown, expected?: unknown, message?: string): void;
  rejects(
    fnOrPromise: (() => Promise<unknown>) | Promise<unknown>,
    expected?: unknown,
    message?: string,
  ): Promise<void>;
  expect(count: number): void;
  step(step: string): void;
  verifySteps(expected: string[], message?: string): void;
  codeEqual(actual: string, expected: string, message?: string): void;
  pushResult(result: { result: boolean; message?: string }): void;
  _actualAssertions: number;
  _expectedAssertions?: number;
  _steps: string[];
};

function assertWithMatcher(
  matcher: unknown,
  actual: unknown,
  message?: string,
): void {
  if (matcher === undefined) {
    return;
  }
  if (typeof matcher === 'string') {
    expect(String(actual), message).toContain(matcher);
    return;
  }
  if (matcher instanceof RegExp) {
    expect(String(actual), message).toMatch(matcher);
    return;
  }
  if (typeof matcher === 'function') {
    if ('prototype' in matcher && (matcher as any).prototype instanceof Error) {
      expect(actual, message).toBeInstanceOf(matcher as new (...args: any[]) => Error);
      return;
    }
    let matched = Boolean((matcher as (value: unknown) => unknown)(actual));
    expect(matched, message).toBe(true);
    return;
  }
  if (typeof matcher === 'object') {
    expect(actual, message).toMatchObject(matcher as Record<string, unknown>);
  }
}

const compatAssert: CompatAssert = {
  test: { testName: '' },
  _actualAssertions: 0,
  _steps: [],
  ok(value, message) {
    this._actualAssertions++;
    expect(Boolean(value), message).toBe(true);
  },
  notOk(value, message) {
    this._actualAssertions++;
    expect(Boolean(value), message).toBe(false);
  },
  true(value, message) {
    this._actualAssertions++;
    expect(value, message).toBe(true);
  },
  false(value, message) {
    this._actualAssertions++;
    expect(value, message).toBe(false);
  },
  strictEqual(actual, expected, message) {
    this._actualAssertions++;
    expect(actual, message).toBe(expected);
  },
  notStrictEqual(actual, expected, message) {
    this._actualAssertions++;
    expect(actual, message).not.toBe(expected);
  },
  equal(actual, expected, message) {
    this._actualAssertions++;
    expect(actual, message).toEqual(expected);
  },
  notEqual(actual, expected, message) {
    this._actualAssertions++;
    expect(actual, message).not.toEqual(expected);
  },
  deepEqual(actual, expected, message) {
    this._actualAssertions++;
    expect(actual, message).toEqual(expected);
  },
  throws(fn, matcher, message) {
    this._actualAssertions++;
    if (message === undefined && typeof matcher === 'string') {
      message = matcher;
      matcher = undefined;
    }
    let thrown: unknown;
    try {
      fn();
      expect(false, message ?? 'expected function to throw').toBe(true);
      return;
    } catch (e) {
      thrown = e;
    }
    assertWithMatcher(matcher, thrown, message);
  },
  async rejects(fnOrPromise, matcher, message) {
    this._actualAssertions++;
    if (message === undefined && typeof matcher === 'string') {
      message = matcher;
      matcher = undefined;
    }
    let promise = typeof fnOrPromise === 'function' ? fnOrPromise() : fnOrPromise;
    try {
      await promise;
      expect(false, message ?? 'expected promise to reject').toBe(true);
      return;
    } catch (e) {
      assertWithMatcher(matcher, e, message);
    }
  },
  expect(count) {
    this._expectedAssertions = count;
  },
  step(step) {
    this._actualAssertions++;
    this._steps.push(step);
  },
  verifySteps(expected, message) {
    this._actualAssertions++;
    expect(this._steps, message).toEqual(expected);
    this._steps = [];
  },
  codeEqual(actual, expected, message = 'code should be equal') {
    (QUnit.assert as any).codeEqual.call(this, actual, expected, message);
  },
  pushResult(result) {
    this._actualAssertions++;
    expect(result.result, result.message).toBe(true);
  },
};

(globalThis as any).assert = compatAssert;

beforeEach((ctx) => {
  compatAssert.test = { testName: ctx.task.name };
  compatAssert._actualAssertions = 0;
  compatAssert._expectedAssertions = undefined;
  compatAssert._steps = [];
});

afterEach(() => {
  if (typeof compatAssert._expectedAssertions === 'number') {
    expect(compatAssert._actualAssertions).toBe(compatAssert._expectedAssertions);
  }
});

afterAll(async () => {
  const helpers = await import('./helpers');

  await helpers.stopTrackedPrerenderers();
  await helpers.closeTrackedServers();
  await helpers.destroyTrackedQueueRunners();
  await helpers.destroyTrackedQueuePublishers();
  await helpers.closeTrackedDbAdapters();

  try {
    const undici = (await import('undici')) as {
      getGlobalDispatcher?: () => { close?: () => Promise<void> };
    };
    await undici.getGlobalDispatcher?.()?.close?.();
  } catch {
    // best-effort cleanup
  }

  let handles = (process as any)._getActiveHandles?.() ?? [];
  for (let handle of handles) {
    if (
      handle &&
      typeof handle.kill === 'function' &&
      typeof handle.spawnfile === 'string' &&
      /chrome|chromium/i.test(handle.spawnfile)
    ) {
      try {
        handle.kill('SIGKILL');
        handle.unref?.();
      } catch {
        // best-effort cleanup
      }
    }
  }

  handles = (process as any)._getActiveHandles?.() ?? [];
  for (let handle of handles) {
    if (!handle || typeof handle.destroy !== 'function') {
      continue;
    }
    let websocketSymbol = Object.getOwnPropertySymbols(handle).find(
      (symbol) => symbol.description === 'websocket',
    );
    if (websocketSymbol) {
      try {
        handle[websocketSymbol]?.terminate?.();
        handle.destroy();
      } catch {
        // best-effort cleanup
      }
    }
  }

  handles = (process as any)._getActiveHandles?.() ?? [];
  for (let handle of handles) {
    if (!handle || typeof handle.destroy !== 'function') {
      continue;
    }
    if ((handle as any)._isStdio || (handle as any)._type === 'pipe') {
      continue;
    }
    try {
      handle.unref?.();
      handle.destroy();
    } catch {
      // best-effort cleanup
    }
  }
});
