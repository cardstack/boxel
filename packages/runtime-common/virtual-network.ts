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

    let internalRequest = this.mapRequest(request, 'virtual-to-real');
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

  async handle(request: Request): Promise<ResponseWithNodeStream> {
    let internalRequest = this.mapRequest(request, 'real-to-virtual');
    for (let handler of this.handlers) {
      let response = await handler(internalRequest);
      if (response) {
        return response;
      }
    }
    return new Response(undefined, { status: 404 });
  }

  private mapRequest(
    request: Request,
    direction: 'virtual-to-real' | 'real-to-virtual',
  ) {
    let remapped = this.resolveURLMapping(request.url, direction);
    if (remapped) {
      let requestInit: RequestInit & { duplex?: 'half' | 'none' } = request; // duplex is in the fetch standard (https://fetch.spec.whatwg.org/#dom-requestinit-duplex) but currently is not being pickued up here, thus the type addition
      if (request.body) {
        requestInit.duplex = 'half'; //  The `duplex` member must be specified for a request with a streaming body. Otherwise the browser will throw an error (with the same message) when a request has a (streaming) body.
      }

      return new Request(remapped, requestInit);
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
