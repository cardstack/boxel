import { RealmPaths } from './paths';
import { Loader } from './loader';
import type { RunnerOpts } from './search-index';
import type { Readable } from 'stream';

export interface ResponseWithNodeStream extends Response {
  nodeStream?: Readable;
}

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';
const PACKAGES_FAKE_ORIGIN = 'https://packages/';

function getNativeFetch(): typeof fetch {
  if (isFastBoot) {
    let optsId = (globalThis as any).runnerOptsId;
    if (optsId == null) {
      throw new Error(`Runner Options Identifier was not set`);
    }
    let getRunnerOpts = (globalThis as any).getRunnerOpts as (
      optsId: number,
    ) => RunnerOpts;
    return getRunnerOpts(optsId)._fetch;
  } else {
    return fetch.bind(globalThis);
  }
}

export type Handler = (req: Request) => Promise<ResponseWithNodeStream | null>;

export class VirtualNetwork {
  private handlers: Handler[] = [];
  private urlMappings: [string, string][] = [];

  private resolveImport = (moduleIdentifier: string) => {
    if (!isUrlLike(moduleIdentifier)) {
      moduleIdentifier = new URL(moduleIdentifier, PACKAGES_FAKE_ORIGIN).href;
    }
    return moduleIdentifier;
  };

  private shimmingLoader = new Loader(() => {
    throw new Error('This loader should never call fetch');
  }, this.resolveImport);

  constructor() {
    this.mount(async (request) => {
      if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
        return this.shimmingLoader.fetch(request);
      }

      return null;
    });
  }

  createLoader() {
    return new Loader(this.fetch, this.resolveImport);
  }

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    this.shimmingLoader.shimModule(moduleIdentifier, module);
  }

  addURLMapping(from: URL, to: URL) {
    this.urlMappings.push([from.href, to.href]);
  }

  private nativeFetch(...args: Parameters<typeof fetch>) {
    return getNativeFetch()(...args);
  }

  resolveURLMapping(
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
          return toPath.fileURL(
            sourcePath.local(absoluteURL, { preserveQuerystring: true }),
          ).href;
        }
      }
    }
    return undefined;
  }

  mount(handler: Handler) {
    this.handlers.push(handler);
  }

  fetch: typeof fetch = async (
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ) => {
    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let internalRequest = await this.mapRequest(request, 'virtual-to-real');
    let response = await this.runFetch(internalRequest, init);
    if (internalRequest !== request) {
      Object.defineProperty(response, 'url', {
        value:
          this.resolveURLMapping(response.url, 'real-to-virtual') ??
          response.url,
      });
    }
    return response;
  };

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
        if (response.status > 300 && response.status < 400) {
          response.headers.set(
            'Location',
            this.resolveURLMapping(
              response.headers.get('Location')!,
              'virtual-to-real',
            )!,
          );
        }
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

  private async runFetch(request: Request, init?: RequestInit) {
    for (let handler of this.handlers) {
      let response = await handler(request);
      if (response) {
        return response;
      }
    }

    return this.nativeFetch(request, init);
  }
}

function isUrlLike(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('.') ||
    moduleIdentifier.startsWith('/') ||
    moduleIdentifier.startsWith('http://') ||
    moduleIdentifier.startsWith('https://')
  );
}

async function getContentOfReadableStream(
  requestBody: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array | null> {
  if (requestBody) {
    let isPending = true;
    let arrayLegnth = 0;
    let unit8Arrays = [];
    let reader = requestBody.getReader();
    do {
      let readableResults = await reader.read();

      if (readableResults.value) {
        arrayLegnth += readableResults.value.length;
        unit8Arrays.push(readableResults.value);
      }

      isPending = !readableResults.done;
    } while (isPending);
    let mergedArray = new Uint8Array(arrayLegnth);
    unit8Arrays.forEach((array) => mergedArray.set(array));
    return mergedArray;
  }
  return null;
}

async function buildRequest(url: string, originalRequest: Request) {
  if (url === originalRequest.url) {
    return originalRequest;
  }

  // To reach the goal of creating a new Request but with a different url it is
  // usually enough to create a new Request object with the new url and the same
  // properties as the original request, but there are issues when the body is
  // a ReadableStream - browser reports the following error:
  // "TypeError: Failed to construct 'Request': The `duplex` member must be
  // specified for a request with a streaming body." Even adding the `duplex`
  // property will not fix the issue - the browser request being made to
  // our local server then expects HTTP/2 connection which is currently not
  // supported in our local server. To avoid all these issues, we resort to
  // reading the body of the original request and creating a new Request with
  // the new url and the body as a Uint8Array.

  let body = null;
  if (originalRequest.body) {
    body = await getContentOfReadableStream(originalRequest.clone().body);
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
