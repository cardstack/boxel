(globalThis as any).__environment = 'test';

// Ensure test timers don't hold the Node event loop open. Wrap setTimeout and
// setInterval to unref timers so the process can exit once work is done. This
// does have the effect of masking any issues where code should be clearing
// timers, however the tradeoff is that server tests finish immediately instead
// of getting into situations where they hang until CI times out.
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

import * as ContentTagGlobal from 'content-tag';
(globalThis as any).ContentTagGlobal = ContentTagGlobal;

import QUnit from 'qunit';

QUnit.config.testTimeout = 60000;

// Cleanup here ensures lingering servers/prerenderers/queues don't keep the
// Node event loop alive after tests finish.
QUnit.done(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const helpers = require('./helpers') as {
    closeTrackedServers?: () => Promise<void>;
    stopTrackedPrerenderers?: () => Promise<void>;
    destroyTrackedQueueRunners?: () => Promise<void>;
    destroyTrackedQueuePublishers?: () => Promise<void>;
    closeTrackedDbAdapters?: () => Promise<void>;
  };
  Promise.resolve().then(async () => {
    await helpers.stopTrackedPrerenderers?.();
    await helpers.closeTrackedServers?.();
    await helpers.destroyTrackedQueueRunners?.();
    await helpers.destroyTrackedQueuePublishers?.();
    await helpers.closeTrackedDbAdapters?.();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const undici = require('undici') as {
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
});

import 'decorator-transforms/globals';
import '../setup-logger'; // This should be first
import './atomic-endpoints-test';
import './auth-client-test';
import './billing-test';
import './card-dependencies-endpoint-test';
import './card-endpoints-test';
import './card-source-endpoints-test';
import './definition-lookup-test';
import './file-watcher-events-test';
import './indexing-test';
import './module-syntax-test';
import './permissions/permission-checker-test';
import './prerendering-test';
import './prerender-server-test';
import './prerender-manager-test';
import './prerender-proxy-test';
import './queue-test';
import './realm-endpoints-test';
import './realm-endpoints/dependencies-test';
import './realm-endpoints/directory-test';
import './realm-endpoints/info-test';
import './realm-endpoints/lint-test';
import './realm-endpoints/mtimes-test';
import './realm-endpoints/permissions-test';
import './realm-endpoints/publishability-test';
import './realm-endpoints/search-test';
import './realm-endpoints/user-test';
import './search-prerendered-test';
import './server-endpoints-test';
import './transpile-test';
import './types-endpoint-test';
import './virtual-network-test';
import './request-forward-test';
import './publish-unpublish-realm-test';
import './boxel-domain-availability-test';
import './get-boxel-claimed-domain-test';
import './claim-boxel-domain-test';
import './delete-boxel-claimed-domain-test';
import './realm-auth-test';
import './queries-test';
import './remote-prerenderer-test';
