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

    for (let handler of this.handlers) {
      let response = await handler(request);
      if (response) {
        return response;
      }
    }

    return this.nativeFetch(request, init);
  };
}

function isUrlLike(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('.') ||
    moduleIdentifier.startsWith('/') ||
    moduleIdentifier.startsWith('http://') ||
    moduleIdentifier.startsWith('https://')
  );
}
