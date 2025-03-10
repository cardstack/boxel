import { RealmPaths } from './paths';
import { baseRealm } from './index';
import {
  PackageShimHandler,
  PACKAGES_FAKE_ORIGIN,
  type ModuleLike,
  ModuleDescriptor,
} from './package-shim-handler';
import type { Readable } from 'stream';
import { fetcher, type FetcherMiddlewareHandler } from './fetcher';
export interface ResponseWithNodeStream extends Response {
  nodeStream?: Readable;
}

export type Handler = (req: Request) => Promise<Response | null>;

export class VirtualNetwork {
  private handlers: Handler[] = [];
  private urlMappings: [string, string][] = [];
  private importMap: Map<string, (rest: string) => string> = new Map();

  constructor(nativeFetch = globalThis.fetch.bind(globalThis)) {
    this.nativeFetch = nativeFetch;
    this.mount(this.packageShimHandler.handle);
  }

  resolveImport = (moduleIdentifier: string) => {
    for (let [prefix, handler] of this.importMap) {
      if (moduleIdentifier.startsWith(prefix)) {
        return handler(moduleIdentifier.slice(prefix.length));
      }
    }
    if (!isUrlLike(moduleIdentifier)) {
      moduleIdentifier = new URL(moduleIdentifier, PACKAGES_FAKE_ORIGIN).href;
    }
    return moduleIdentifier;
  };

  private packageShimHandler = new PackageShimHandler(this.resolveImport);

  shimModule(moduleIdentifier: string, module: ModuleLike) {
    this.packageShimHandler.shimModule(moduleIdentifier, module);
  }

  shimAsyncModule(descriptor: ModuleDescriptor) {
    this.packageShimHandler.shimAsyncModule(descriptor);
  }

  addURLMapping(from: URL, to: URL) {
    this.urlMappings.push([from.href, to.href]);
  }

  addImportMap(prefix: string, handler: (rest: string) => string): void {
    this.importMap.set(prefix, handler);
  }

  private nativeFetch: typeof globalThis.fetch;

  private resolveURLMapping(
    url: string,
    direction: 'virtual-to-real' | 'real-to-virtual',
  ): string | undefined {
    let absoluteURL = new URL(url);
    for (let [virtual, real] of this.urlMappings) {
      let sourcePath = new RealmPaths(
        new URL(direction === 'virtual-to-real' ? virtual : real),
      );
      if (sourcePath.inRealm(absoluteURL)) {
        let toPath = new RealmPaths(
          new URL(direction === 'virtual-to-real' ? real : virtual),
        );
        if (absoluteURL.href.endsWith('/')) {
          return toPath.directoryURL(sourcePath.local(absoluteURL)).href;
        } else {
          let local = sourcePath.local(absoluteURL, {
            preserveQuerystring: true,
          });
          let resolved = toPath.fileURL(local).href;

          // A special case for root realm urls with missing trailing slash, for
          // example http://localhost:4201/base – we want the mapped url also not to have a trailing slash
          // (so that the realm handler knows it needs to redirect to the correct url with a trailing slash)
          if (local === '' && !absoluteURL.pathname.endsWith('/')) {
            resolved = resolved.replace(/\/$/, '');
          }
          return resolved;
        }
      }
    }
    return undefined;
  }

  mount(handler: Handler, opts?: { prepend: boolean }) {
    if (opts?.prepend) {
      this.handlers.unshift(handler);
    } else {
      this.handlers.push(handler);
    }
  }

  unmount(handler: Handler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  fetch: typeof fetch = async (
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ) => {
    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let response = await this.runFetch(request, init);

    if (response.url !== request.url) {
      Object.defineProperty(response, 'url', {
        value:
          this.resolveURLMapping(response.url, 'real-to-virtual') ??
          response.url,
      });
    }
    return response;
  };

  private async runFetch(request: Request, init?: RequestInit) {
    let handlers: FetcherMiddlewareHandler[] = this.handlers.map((h) => {
      return async (request, next) => {
        let response = await h(request);
        if (response) {
          return response;
        }
        return next(request);
      };
    });

    handlers.push(async (request, next) => {
      return next(await this.mapRequest(request, 'virtual-to-real'));
    });

    return withRetries(new URL(request.url), () =>
      fetcher(this.nativeFetch, handlers)(request, init),
    );
  }

  // This method is used to handle the boundary between the real and virtual network,
  // when a request is made to the realm from the realm server - it maps requests
  // by changing their URL from real to virtual, as defined in the url mapping config
  // (e.g http://localhost:4201/base to https://cardstack.com/base) so that the realms
  // that have a virtual URL know that they are being requested
  async handle(
    request: Request,
    onMappedRequest?: (request: Request) => void,
  ): Promise<ResponseWithNodeStream> {
    let internalRequest = await this.mapRequest(request, 'real-to-virtual');
    if (onMappedRequest) {
      onMappedRequest(internalRequest);
    }

    for (let handler of this.handlers) {
      let response = await handler(internalRequest);
      if (response) {
        this.mapRedirectionURL(response);
        return response;
      }
    }
    return new Response(undefined, { status: 404 });
  }

  private async mapRequest(
    request: Request,
    direction: 'virtual-to-real' | 'real-to-virtual',
  ) {
    let remappedUrl = this.resolveURLMapping(request.url, direction);

    if (remappedUrl) {
      return await buildRequest(remappedUrl, request);
    } else {
      return request;
    }
  }

  private mapRedirectionURL(response: Response): void {
    if (response.status > 300 && response.status < 400) {
      let redirectionURL = response.headers.get('Location')!;
      let isRelativeRedirectionURL = !/^[a-z][a-z0-9+.-]*:|\/\//i.test(
        redirectionURL,
      ); // doesn't start with a protocol scheme and "//" (e.g., "http://", "https://", "//")

      let finalRedirectionURL;

      if (isRelativeRedirectionURL) {
        finalRedirectionURL = redirectionURL;
      } else {
        let remappedRedirectionURL = this.resolveURLMapping(
          redirectionURL,
          'virtual-to-real',
        );
        finalRedirectionURL = remappedRedirectionURL || redirectionURL;
      }
      response.headers.set('Location', finalRedirectionURL);
    }
  }

  createEventSource(url: string) {
    let mappedUrl = this.resolveURLMapping(url, 'virtual-to-real');
    return new EventSource(mappedUrl || url);
  }
}

export function isUrlLike(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('.') ||
    moduleIdentifier.startsWith('/') ||
    moduleIdentifier.startsWith('http://') ||
    moduleIdentifier.startsWith('https://')
  );
}

// This is to handle a very mysterious situation in our CI environment where
// fetches for base realm artifacts seem to vanish and we see "TypeError:
// Fetch failed" exceptions.
const maxAttempts = 5;
const backOffMs = 100;
async function withRetries(
  url: URL,
  fetchFn: () => ReturnType<typeof globalThis.fetch>,
) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchFn();
    } catch (err: any) {
      if (
        (globalThis as any).__environment !== 'test' ||
        (!baseRealm.inRealm(url) &&
          !url.href.startsWith('https://boxel-icons.boxel.ai/')) ||
        ++attempt > maxAttempts
      ) {
        throw err;
      }
      console.error(
        `Encountered fetch failed for ${
          url.href
        } retry attempt #${attempt} in ${attempt * backOffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, attempt * backOffMs));
    }
  }
}

async function buildRequest(url: string, originalRequest: Request) {
  if (url === originalRequest.url) {
    return originalRequest;
  }

  // To reach the goal of creating a new Request but with a different url it is
  // usually enough to create a new Request object with the new url and the same
  // properties as the original request, but there are issues when the body is
  // a ReadableStream - Chrome browser, for example, reports the following error:
  // "TypeError: Failed to construct 'Request': The `duplex` member must be
  // specified for a request with a streaming body." Even adding the `duplex`
  // property will not fix the issue - the browser request being made to
  // our local server then expects HTTP/2 connection which is currently not
  // supported in our local server. To avoid all these issues, we resort to
  // reading the body of the original request and creating a new Request with
  // the new url and the body as a Uint8Array.

  let body = null;

  if (['POST', 'PUT', 'PATCH'].includes(originalRequest.method)) {
    body = await originalRequest.clone().text();
  }

  return new Request(url, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body,
    referrer: originalRequest.referrer,
    referrerPolicy: originalRequest.referrerPolicy,
    mode: originalRequest.mode,
    credentials: originalRequest.credentials,
    cache: originalRequest.cache,
    redirect: originalRequest.redirect,
    integrity: originalRequest.integrity,
  });
}
