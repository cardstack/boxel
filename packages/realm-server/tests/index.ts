(globalThis as any).__environment = 'test';

// Strip the dev TLS env vars before any fixture realm-server is spun up.
// `env-vars.sh` exports these whenever the local mkcert cert exists, which
// is now the CI default. Without this delete, in-process fixture servers
// would bind the HTTPS+HTTP/2 dispatcher on their random `127.0.0.1:444X`
// ports and the dispatcher's plain-HTTP branch would 308-redirect every
// supertest request to `https://…`, breaking every assertion that expects
// `200`/`4xx`. In-process tests don't need TLS — they speak HTTP/1.1 to
// supertest directly.
delete process.env.REALM_SERVER_TLS_CERT_FILE;
delete process.env.REALM_SERVER_TLS_KEY_FILE;

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

import QUnit from 'qunit';
import { createRequire } from 'module';

// `require` doesn't exist in ESM scope; recreate it so the synchronous,
// order-preserving test-file loader and the lazy cleanup requires below keep
// working under native node.
const require = createRequire(import.meta.url);

// The qunit CLI used to provide the TAP reporter, autostart, and a
// failure-based exit code. Running under `node tests/index.ts` we wire them up
// here; autostart is disabled so every test file registers before we start.
QUnit.config.autostart = false;
(QUnit as any).reporters.tap.init(QUnit); // QUnit 2.x API missing from @types/qunit
(QUnit as any).on('runEnd', (data: { testCounts: { failed: number } }) => {
  process.exitCode = data.testCounts.failed > 0 ? 1 : 0;
});

// Track the running test through QUnit's public callback API so the
// unhandled-rejection handler below can attribute a leak without reaching
// into QUnit internals.
let currentTestName = '<no test running>';
QUnit.testStart(({ module, name }) => {
  currentTestName = module ? `${module} > ${name}` : name;
});
QUnit.testDone(() => {
  currentTestName = '<no test running>';
});

// Native Node aborts the whole suite on the first unhandled rejection, and
// its default dump names neither the test that leaked the promise nor a
// usable stack. Attribute it to the running test before re-raising so the
// failure stays fatal but becomes diagnosable instead of an opaque object
// printed by node:internal/process/promises.
process.on('unhandledRejection', (reason: unknown) => {
  let testName = currentTestName;
  let detail =
    reason instanceof Error
      ? (reason.stack ?? reason.message)
      : (() => {
          try {
            return JSON.stringify(reason);
          } catch {
            return String(reason);
          }
        })();
  console.error(
    `Unhandled promise rejection during test [${testName}]:\n${detail}`,
  );
  throw reason;
});

QUnit.config.testTimeout = 60000;
const testModules = process.env.TEST_MODULES?.trim();

if (testModules) {
  const modules = parseModules(testModules);
  if (modules.length > 0) {
    QUnit.config.filter = buildModuleFilter(modules);
    console.log(
      `Filtering tests to modules from TEST_MODULES: ${modules.join(', ')}`,
    );
  } else {
    console.warn(
      'TEST_MODULES was provided but no module names were parsed. Running full suite.',
    );
  }
}

// Cleanup here ensures lingering servers/prerenderers/queues don't keep the
// Node event loop alive after tests finish — and equivalently, don't leave
// hardcoded test ports (4444-4471, etc.) bound after a test is aborted by
// Ctrl+C or an abnormal exit (but not SIGKILL, which bypasses handlers).
async function runTrackedCleanup(): Promise<void> {
  const helpers = require('./helpers/index.ts') as {
    closeTrackedServers?: () => Promise<void>;
    stopTrackedPrerenderers?: () => Promise<void>;
    destroyTrackedQueueRunners?: () => Promise<void>;
    destroyTrackedQueuePublishers?: () => Promise<void>;
    closeTrackedDbAdapters?: () => Promise<void>;
  };
  await helpers.stopTrackedPrerenderers?.();
  await helpers.closeTrackedServers?.();
  await helpers.destroyTrackedQueueRunners?.();
  await helpers.destroyTrackedQueuePublishers?.();
  await helpers.closeTrackedDbAdapters?.();
}

for (let signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    runTrackedCleanup()
      .catch((error) => console.error(`Cleanup on ${signal} failed:`, error))
      .finally(() => {
        // Re-raise the signal with default disposition so the exit code
        // reflects it (SIGINT → 130, SIGTERM → 143).
        process.kill(process.pid, signal);
      });
  });
}

QUnit.done(() => {
  const helpers = require('./helpers/index.ts') as {
    closeTrackedServers?: () => Promise<void>;
    stopTrackedPrerenderers?: () => Promise<void>;
    destroyTrackedQueueRunners?: () => Promise<void>;
    destroyTrackedQueuePublishers?: () => Promise<void>;
    closeTrackedDbAdapters?: () => Promise<void>;
  };
  Promise.resolve()
    .then(async () => {
      await helpers.stopTrackedPrerenderers?.();
      await helpers.closeTrackedServers?.();
      await helpers.destroyTrackedQueueRunners?.();
      await helpers.destroyTrackedQueuePublishers?.();
      await helpers.closeTrackedDbAdapters?.();
      try {
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
    })
    .catch((error) => {
      console.error('QUnit.done cleanup failed:', error);
    });
});

import 'decorator-transforms/globals';
import '../setup-logger.ts'; // This should be first

const ALL_TEST_FILES: string[] = [
  './atomic-endpoints-test',
  './auth-client-test',
  './billing-test',
  './card-dependencies-endpoint-test',
  './card-endpoints-test',
  './card-source-endpoints-test',
  './codemod-context-search-test',
  './cpu-profiler-affinity-gate-test',
  './definition-lookup-test',
  './searchable-parity-diff-test',
  './file-watcher-events-test',
  './full-index-on-startup-test',
  './full-reindex-test',
  './http2-keepalive-test',
  './indexing-test',
  './lazy-mount-test',
  './listener-dispatcher-test',
  './module-cache-race-test',
  './module-syntax-test',
  './network-inflight-tracker-test',
  './permissions/permission-checker-test',
  './prerendering-test',
  './prerender-server-test',
  './prerender-manager-test',
  './prerender-host-shell-recycle-test',
  './prerender-artifact-sink-test',
  './prerender-affinity-activity-test',
  './prerender-batch-ownership-test',
  './prerender-cancellation-test',
  './async-semaphore-test',
  './page-pool-expansion-test',
  './page-pool-priority-test',
  './page-pool-eviction-recovery-test',
  './page-pool-standby-refill-test',
  './page-pool-cert-verifier-retry-test',
  './prerender-deadlock-test',
  './runtime-exception-capture-test',
  './clamp-serialized-error-test',
  './sanitize-for-jsonb-test',
  './is-json-content-type-test',
  './prerender-diagnostics-persistence-test',
  './prerender-proxy-test',
  './prerender-v8-prof-test',
  './queue-test',
  './finalize-orphan-reservations-test',
  './finalize-child-fatal-failure-test',
  './screenshot-card-test',
  './run-command-task-test',
  './realm-endpoints-test',
  './realm-endpoints/dependencies-test',
  './realm-advisory-locks-test',
  './realm-cleanup-transaction-test',
  './data-plane-write-lock-test',
  './realm-registry-backfill-test',
  './realm-registry-reconciler-test',
  './realm-registry-writes-test',
  './realm-file-changes-listener-test',
  './realm-index-updated-listener-test',
  './jobs-finished-listener-test',
  './realm-routing-test',
  './module-cache-invalidation-listener-test',
  './pg-adapter-subscribe-test',
  './module-cache-coordination-test',
  './realm-endpoints/archived-seal-test',
  './realm-endpoints/directory-test',
  './realm-endpoints/indexing-errors-test',
  './realm-endpoints/info-test',
  './realm-endpoints/invalidate-urls-test',
  './realm-endpoints/lint-test',
  './realm-endpoints/markdown-test',
  './realm-endpoints/mtimes-test',
  './realm-endpoints/permissions-test',
  './realm-endpoints/cancel-indexing-job-test',
  './realm-endpoints/publishability-test',
  './realm-endpoints/reindex-test',
  './realm-endpoints/search-test',
  './realm-endpoints/user-test',
  './server-endpoints/archive-realm-test',
  './server-endpoints/authentication-test',
  './server-endpoints/bot-commands-test',
  './server-endpoints/bot-registration-test',
  './server-endpoints/delete-realm-test',
  './server-endpoints/download-realm-test',
  './server-endpoints/federated-types-test',
  './server-endpoints/index-responses-test',
  './server-endpoints/maintenance-endpoints-test',
  './server-endpoints/queue-status-test',
  './server-endpoints/realm-lifecycle-test',
  './server-endpoints/run-command-endpoint-test',
  './server-endpoints/screenshot-card-endpoint-test',
  './server-endpoints/search-test',
  './serve-index-test',
  './server-config-test',
  './server-endpoints/info-test',
  './server-endpoints/stripe-session-test',
  './server-endpoints/stripe-webhook-test',
  './server-endpoints/user-and-catalog-test',
  './server-endpoints/incoming-webhook-test',
  './server-endpoints/webhook-commands-test',
  './server-endpoints/webhook-receiver-test',
  './transpile-test',
  './types-endpoint-test',
  './virtual-network-test',
  './request-forward-test',
  './openrouter-passthrough-test',
  './publish-unpublish-realm-test',
  './boxel-domain-availability-test',
  './get-boxel-claimed-domain-test',
  './claim-boxel-domain-test',
  './realm-identifiers-test',
  './bfm-card-references-test',
  './package-shim-handler-test',
  './command-parsing-utils-test',
  './query-matches-filter-test',
  './parse-search-url-test',
  './matches-filter-integration-test',
  './eq-containment-integration-test',
  './search-resource-helpers-test',
  './superseded-search-surface-removed-test',
  './search-entry-test',
  './search-entries-engine-test',
  './coerce-error-message-test',
  './realm-operations-test',
  './resolve-published-realm-url-test',
  './fallback-models-test',
  './host-routing-validation-test',
  './normalize-realm-meta-value-test',
  './job-scoped-search-cache-test',
  './consuming-realm-header-test',
  './delete-boxel-claimed-domain-test',
  './realm-auth-test',
  './queries-test',
  './remote-prerenderer-test',
  './runtime-dependency-tracker-test',
  './markdown-fallback-server-isolation-test',
  './sanitize-head-html-test',
  './node-realm-test',
  './session-room-queries-test',
  './indexing-event-sink-test',
  './skip-query-backed-expansion-test',
];

// TEST_FILES limits which test files are loaded (parsed and executed). Useful
// when measuring a single file's wall time or peak RSS in isolation —
// TEST_MODULES only filters which modules *run*, while every file still gets
// parsed. Accepts a comma-separated list of paths relative to this directory,
// with or without a leading `./` or trailing `.ts`.
const testFilesEnv = process.env.TEST_FILES?.trim();
const filesToLoad = testFilesEnv
  ? parseTestFiles(testFilesEnv)
  : ALL_TEST_FILES;

if (testFilesEnv) {
  console.log(
    `Loading only test files from TEST_FILES: ${filesToLoad.join(', ')}`,
  );
}

for (const file of filesToLoad) {
  // Explicit `.ts` — native `require` does no extension search for TypeScript.
  require(`${file}.ts`);
}

QUnit.start();

function parseTestFiles(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^['"]+|['"]+$/g, ''))
    .map((entry) => entry.replace(/\.ts$/, ''))
    .map((entry) => (entry.startsWith('./') ? entry : `./${entry}`));
}

function parseModules(value: string): string[] {
  return value
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^['"]+|['"]+$/g, ''));
}

function buildModuleFilter(modulesToMatch: string[]): string {
  const escaped = modulesToMatch.map((moduleName) => escapeRegex(moduleName));
  const pattern = `^(?:${escaped.join('|')})(?:\\s>\\s|:)`;
  return `/${pattern}/`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}
