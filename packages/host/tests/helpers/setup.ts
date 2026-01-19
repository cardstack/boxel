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
        console.error(`[test-fetch] ${method} ${url} failed`, error);
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
