import { afterAll } from 'vitest';
import * as ContentTagGlobal from 'content-tag';
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
