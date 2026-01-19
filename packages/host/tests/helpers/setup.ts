/* eslint-disable cardstack-host/wrapped-setup-helpers-only */
// This is the one place we allow these to be used directly.

import {
  setupApplicationTest as emberSetupApplicationTest,
  setupRenderingTest as emberSetupRenderingTest,
} from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { cleanupMonacoEditorModels } from './index';

function setupFetchDebugging(hooks: NestedHooks) {
  let originalFetch: typeof globalThis.fetch | undefined;
  let wrappedFetch: typeof globalThis.fetch | undefined;

  hooks.beforeEach(function () {
    if (!globalThis.fetch) {
      return;
    }
    originalFetch = globalThis.fetch;
    let boundFetch = globalThis.fetch.bind(globalThis);
    wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let { method, url } = describeFetchRequest(input, init);
      try {
        return await boundFetch(input, init);
      } catch (error) {
        console.error(
          `[test-fetch] ${method} ${url} failed: ${formatErrorForLog(error)}`,
        );
        throw error;
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
  });
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
  hooks.afterEach(cleanupMonacoEditorModels);
}

export function setupRenderingTest(hooks: NestedHooks) {
  emberSetupRenderingTest(hooks);
  setupWindowMock(hooks);
  setupFetchDebugging(hooks);
  hooks.afterEach(cleanupMonacoEditorModels);
}
