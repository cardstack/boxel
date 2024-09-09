export type FetcherMiddlewareHandler = (
  req: Request,
  next: (onwardReq: Request) => Promise<Response>,
) => Promise<Response>;

export function fetcher(
  fetchImplementation: typeof globalThis.fetch,
  middlewareStack: FetcherMiddlewareHandler[],
): typeof globalThis.fetch {
  let instance: typeof globalThis.fetch = async (urlOrRequest, init) => {
    function buildNext(remainingHandlers: FetcherMiddlewareHandler[]) {
      let [nextHandler, ...rest] = remainingHandlers;
      return async (onwardReq: Request) => {
        let response;
        if (nextHandler) {
          response = await nextHandler(onwardReq, buildNext(rest));
        } else {
          response = await fetchImplementation(onwardReq);
        }
        return await simulateNetworkBehaviors(onwardReq, response, instance);
      };
    }

    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let token = beginAsync();
    try {
      return responseWithWaiters(await buildNext(middlewareStack)(request));
    } finally {
      endAsync(token);
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
          return waitForPromise(value(...args), 'fetcher-body');
        };
      }
      return value;
    },
  });
}

let waitForPromise: Waiters['waitForPromise'] = (p) => {
  return p;
};

let beginAsync = (): unknown => {
  return 'token';
};

let endAsync = (_token: unknown): void => {
  // pass
};

export interface Waiters {
  buildWaiter(label: string): {
    beginAsync(): unknown;
    endAsync(token: unknown): void;
  };
  waitForPromise<T>(promise: Promise<T>, label?: string): Promise<T>;
}

export function useTestWaiters(w: Waiters) {
  ({ waitForPromise } = w);
  let waiter = w.buildWaiter('fetcher');
  beginAsync = waiter.beginAsync.bind(waiter);
  endAsync = waiter.endAsync.bind(waiter);
}
