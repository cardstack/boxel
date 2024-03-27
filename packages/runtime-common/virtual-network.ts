import { RealmPaths } from './paths';
import { Loader } from './loader';
import type { RunnerOpts } from './search-index';

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

export type Handler = (req: Request) => Promise<Response | null>;

export class VirtualNetwork {
  private nativeFetch = getNativeFetch();
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

  private resolveURLMapping(url: string): string | undefined {
    let absoluteURL = new URL(url);
    for (let [sourceURL, to] of this.urlMappings) {
      let sourcePath = new RealmPaths(new URL(sourceURL));
      if (sourcePath.inRealm(absoluteURL)) {
        let toPath = new RealmPaths(new URL(to));
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

    let internalRequest = this.mapRequest(request);
    let response = await this.runFetch(internalRequest, init);
    if (internalRequest !== request) {
      Object.defineProperty(response, 'url', { value: request.url });
    }
    return response;
  };

  private mapRequest(request: Request) {
    let remapped = this.resolveURLMapping(request.url);
    if (remapped) {
      return new Request(remapped, request);
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
