import { SHIMMED_MODULE_FAKE_ORIGIN } from './loader';
import type { RunnerOpts } from './search-index';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

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

  private shimmedModules = new Map<string, Record<string, any>>();

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    this.shimmedModules.set(moduleIdentifier, module);
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

    if (request.url.startsWith(SHIMMED_MODULE_FAKE_ORIGIN)) {
      let shimmedModule = this.shimmedModules.get(
        request.url.replace(SHIMMED_MODULE_FAKE_ORIGIN, ''),
      );

      if (!shimmedModule) {
        throw new Error(
          `Shimmed module not found but it should've been: ${request.url}`,
        );
      }

      let response = new Response();
      (response as any)[Symbol.for('shimmed-module')] = shimmedModule;
      return response;
    }

    for (let handler of this.handlers) {
      let response = await handler(request);
      if (response) {
        return response;
      }
    }

    return this.nativeFetch(request, init);
  };
}
