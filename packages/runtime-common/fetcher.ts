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
    return buildNext(middlewareStack)(request);
  };
  return instance;
}

export async function simulateNetworkBehaviors(
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
