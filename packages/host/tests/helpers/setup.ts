/* eslint-disable @cardstack/host/wrapped-setup-helpers-only */
// This is the one place we allow these to be used directly.

import { settled } from '@ember/test-helpers';

import {
  setupApplicationTest as emberSetupApplicationTest,
  setupRenderingTest as emberSetupRenderingTest,
} from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { clearHtmlComponentCache } from '@cardstack/host/lib/html-component';
import type ResetService from '@cardstack/host/services/reset';

import { clearRemoteRealmCache } from './realm-server-mock/routes';

import { cleanupMonacoEditorModels } from './index';

// Per-test set of fetch URLs currently in flight. Snapshotted by the
// unhandled-rejection diagnostics helper so we can see what was outstanding
// when an unowned rejection surfaced. Cleared in beforeEach.
let inFlightFetches = new Set<string>();

function setupFetchDebugging(hooks: NestedHooks) {
  let originalFetch: typeof globalThis.fetch | undefined;
  let wrappedFetch: typeof globalThis.fetch | undefined;

  hooks.beforeEach(function () {
    inFlightFetches = new Set<string>();
    if (!globalThis.fetch) {
      return;
    }
    originalFetch = globalThis.fetch;
    let boundFetch = globalThis.fetch.bind(globalThis);
    wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let { method, url } = describeFetchRequest(input, init);
      let tag = `${method} ${url}`;
      inFlightFetches.add(tag);
      try {
        return await boundFetch(input, init);
      } catch (error) {
        console.error(
          `[test-fetch] ${method} ${url} failed: ${formatErrorForLog(error)}`,
        );
        throw error;
      } finally {
        inFlightFetches.delete(tag);
      }
    };
    globalThis.fetch = wrappedFetch;
  });

  hooks.afterEach(function () {
    if (originalFetch && globalThis.fetch === wrappedFetch) {
      globalThis.fetch = originalFetch;
    }
    originalFetch = undefined;
    wrappedFetch = undefined;
    inFlightFetches = new Set<string>();
  });
}

// surface unhandled rejections during tests with full stacks + in-flight URLs
function setupUnhandledRejectionDiagnostics(hooks: NestedHooks) {
  let handler: ((event: PromiseRejectionEvent) => void) | undefined;
  let target: EventTarget | undefined;

  hooks.beforeEach(function () {
    target =
      typeof window !== 'undefined'
        ? (window as unknown as EventTarget)
        : typeof globalThis !== 'undefined'
          ? (globalThis as unknown as EventTarget)
          : undefined;
    if (!target) {
      return;
    }
    handler = (event: PromiseRejectionEvent) => {
      // Observation only — do NOT call event.preventDefault(). QUnit's own
      // unhandled-rejection handling must still run and fail the test.
      let inFlightSnapshot = Array.from(inFlightFetches);
      console.error(
        [
          '[test-unhandled-rejection]',
          formatRejectionReason(event.reason),
          inFlightSnapshot.length
            ? `in-flight fetches at rejection time (${inFlightSnapshot.length}):\n  ${inFlightSnapshot.join('\n  ')}`
            : 'in-flight fetches at rejection time: <none>',
        ].join('\n'),
      );
    };
    target.addEventListener(
      'unhandledrejection',
      handler as unknown as EventListener,
    );
  });

  hooks.afterEach(function () {
    if (target && handler) {
      target.removeEventListener(
        'unhandledrejection',
        handler as unknown as EventListener,
      );
    }
    handler = undefined;
    target = undefined;
  });
}

function formatRejectionReason(reason: unknown): string {
  let lines: string[] = [];
  let seen = new Set<unknown>();
  let current: unknown = reason;
  let depth = 0;
  while (current && !seen.has(current) && depth < 5) {
    seen.add(current);
    let prefix = depth === 0 ? 'reason' : `cause[${depth}]`;
    if (current instanceof Error) {
      let header = current.name
        ? `${current.name}: ${current.message}`
        : current.message;
      let stack = current.stack?.trim();
      lines.push(`${prefix}: ${header}`);
      if (stack) {
        lines.push(stack);
      }
      current = (current as { cause?: unknown }).cause;
    } else if (typeof current === 'string') {
      lines.push(`${prefix}: ${current}`);
      current = undefined;
    } else {
      try {
        lines.push(`${prefix}: ${JSON.stringify(current)}`);
      } catch (_e) {
        lines.push(`${prefix}: ${String(current)}`);
      }
      current = undefined;
    }
    depth++;
  }
  if (lines.length === 0) {
    lines.push(`reason: ${String(reason)}`);
  }
  return lines.join('\n');
}

function describeFetchRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) {
    return { method: input.method, url: input.url };
  }
  let url = input instanceof URL ? input.href : String(input);
  let method = init?.method ?? 'GET';
  return { method, url };
}

function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    let header = error.name ? `${error.name}: ${error.message}` : error.message;
    let stack = error.stack?.trim();
    if (stack && !stack.includes(header)) {
      return `${header}\n${stack}`;
    }
    return stack ?? header ?? 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    let serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch (_e) {
    // fall through to string coercion
  }
  return String(error);
}

export function setupApplicationTest(hooks: NestedHooks) {
  emberSetupApplicationTest(hooks);
  setupWindowMock(hooks);
  setupFetchDebugging(hooks);
  setupUnhandledRejectionDiagnostics(hooks);
  hooks.afterEach(async function () {
    resetServiceIfPresent(this.owner, 'service:ai-assistant-panel-service');
    resetServiceIfPresent(this.owner, 'service:matrix-service');
    resetServiceIfPresent(this.owner, 'service:operator-mode-state-service');
    await settled();
    (
      this.owner.lookup('service:reset') as ResetService | undefined
    )?.resetAll();
    cleanupMonacoEditorModels();
    clearHtmlComponentCache();
    clearRemoteRealmCache();
  });
}

export function setupRenderingTest(hooks: NestedHooks) {
  emberSetupRenderingTest(hooks);
  setupWindowMock(hooks);
  setupFetchDebugging(hooks);
  setupUnhandledRejectionDiagnostics(hooks);
  hooks.afterEach(async function () {
    await settled();
    (
      this.owner.lookup('service:reset') as ResetService | undefined
    )?.resetAll();
    cleanupMonacoEditorModels();
    clearHtmlComponentCache();
    clearRemoteRealmCache();
  });
}

function resetServiceIfPresent(
  owner: {
    __container__?: { cache?: Record<string, unknown> };
    lookup(name: string): unknown;
  },
  name: string,
) {
  (
    owner.__container__?.cache?.[name] as
      | { resetState?: () => void }
      | undefined
  )?.resetState?.();
}
