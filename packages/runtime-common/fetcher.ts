import { buildWaiter, waitForPromise } from './test-waiters';
import type { VirtualNetwork } from './virtual-network';

const fetcherWaiter = buildWaiter('fetcher');

export type FetcherMiddlewareHandler = (
  req: Request,
  next: (onwardReq: Request) => Promise<Response>,
) => Promise<Response>;

export function fetcher(
  fetchImplementation: typeof globalThis.fetch,
  middlewareStack: FetcherMiddlewareHandler[],
  virtualNetwork?: VirtualNetwork,
): typeof globalThis.fetch {
  let instance: typeof globalThis.fetch = async (urlOrRequest, init) => {
    function buildNext(remainingHandlers: FetcherMiddlewareHandler[]) {
      let [nextHandler, ...rest] = remainingHandlers;
      return async (onwardReq: Request) => {
        let response;
        if (nextHandler) {
          response = await nextHandler(onwardReq, buildNext(rest));
        } else {
          // clone so retries/redirects can reuse the original Request
          response = await fetchImplementation(onwardReq.clone());
        }
        return await simulateNetworkBehaviors(onwardReq, response, instance);
      };
    }

    // Resolve scoped identifiers (e.g. `@cardstack/catalog/...`) before
    // `new Request(...)` would resolve them against `document.baseURI`
    // and produce a literal `https://<origin>/@cardstack/catalog/...` URL.
    // Mirrors VirtualNetwork.fetch — but every authedFetch caller funnels
    // through fetcher first, so the resolution has to happen here too.
    if (
      typeof urlOrRequest === 'string' &&
      virtualNetwork?.isRegisteredPrefix(urlOrRequest)
    ) {
      urlOrRequest = virtualNetwork.toURL(urlOrRequest).href;
    }

    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let token = fetcherWaiter.beginAsync();
    try {
      return responseWithWaiters(await buildNext(middlewareStack)(request));
    } finally {
      fetcherWaiter.endAsync(token);
    }
  };
  return instance;
}

async function simulateNetworkBehaviors(
  request: Request,
  result: Response,
  fetchImplementation: typeof fetch, // argument purposively not named `fetch` to avoid shadowing the global fetch
): Promise<Response> {
  if (result.url) {
    return result;
  }
  // We are using Object.defineProperty because `url` and `redirected`
  // response properties are read-only. We are overriding these properties to
  // conform to the Fetch API specification where the `url` property is set to
  // the final URL and the `redirected` property is set to true if the request
  // was redirected. Normally, when using a native fetch, these properties are
  // set automatically by the client, but in this case, we are simulating the
  // fetch and need to set these properties manually.
  Object.defineProperty(result, 'url', { value: request.url });
  if (result.status >= 300 && result.status < 400) {
    const location = result.headers.get('location');
    if (location) {
      let redirectedResponse = await fetchImplementation(
        new URL(location, request.url),
        request,
      );
      Object.defineProperty(redirectedResponse, 'redirected', {
        value: true,
      });
      return redirectedResponse;
    }
  }
  return result;
}

const asyncMethods = ['text', 'json', 'arrayBuffer', 'blob', 'formData'];

function responseWithWaiters(response: Response): Response {
  return new Proxy(response, {
    get(target, key) {
      let value = Reflect.get(target, key);
      if (typeof key === 'string' && typeof value === 'function') {
        // the Response methods are picky about their `this`, it cannot be
        // the Proxy.
        value = value.bind(target);
      }
      if (typeof key === 'string' && asyncMethods.includes(key)) {
        return async (...args: unknown[]) => {
          return waitForPromise(value(...args), `fetcher-body:${key}`);
        };
      }
      return value;
    },
  });
}

// Re-exported for backwards compatibility – these were previously defined here
// and may be consumed via deep imports from this module.
export { useTestWaiters, type Waiters } from './test-waiters';
