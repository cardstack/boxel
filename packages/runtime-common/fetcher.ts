type FetcherMiddlewareHandler = (
  req: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

export function fetcher(
  fetchImplementation: typeof globalThis.fetch,
  middlewareStack: FetcherMiddlewareHandler[],
): typeof globalThis.fetch {
  return async (urlOrRequest, init) => {
    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let i = 0;
    let fellThroughToFetchImplementation = false;
    let next = async () => {
      i = i + 1;
      let nextHandler = middlewareStack[i];
      if (nextHandler) {
        let response = nextHandler(request, next);
        return response;
      } else {
        fellThroughToFetchImplementation = true;
        return fetchImplementation(request);
      }
    };
    let handler = middlewareStack[i];
    let response = await handler(request, next);
    if (!fellThroughToFetchImplementation) {
      return await followRedirections(request, response, fetch);
    } else {
      return response;
    }
  };
}

export async function followRedirections(
  request: Request,
  result: Response,
  fetchImplementation: typeof fetch, // argument purposively not named `fetch` to avoid shadowing the global fetch
): Promise<Response> {
  const urlString = request.url;
  let redirectedHeaderKey = 'simulated-fetch-redirected'; // Temporary header to track if the request was redirected in the redirection chain

  if (result.status >= 300 && result.status < 400) {
    const location = result.headers.get('location');
    if (location) {
      request.headers.set(redirectedHeaderKey, 'true');
      return await fetchImplementation(new URL(location, urlString), request);
    }
  }

  // We are using Object.defineProperty because `url` and `redirected`
  // response properties are read-only. We are overriding these properties to
  // conform to the Fetch API specification where the `url` property is set to
  // the final URL and the `redirected` property is set to true if the request
  // was redirected. Normally, when using a native fetch, these properties are
  // set automatically by the client, but in this case, we are simulating the
  // fetch and need to set these properties manually.

  if (request.url && !result.url) {
    Object.defineProperty(result, 'url', { value: urlString });

    if (request.headers.get(redirectedHeaderKey) === 'true') {
      Object.defineProperty(result, 'redirected', { value: true });
      request.headers.delete(redirectedHeaderKey);
    }
  }

  return result;
}
