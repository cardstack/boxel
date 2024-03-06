import { RunnerOpts } from 'search-index';
import { RealmPaths } from './paths';
import { Realm } from './realm';

export type Fetch = (
  urlOrRequest: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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

export class RealmVirtualNetwork {
  private realms: Realm[] = [];
  private nativeFetch = getNativeFetch();

  addRealm(realm: Realm) {
    this.realms.push(realm);
  }

  fetch: Fetch = async (
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ) => {
    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let targetRealm = this.realms.find((realm) => {
      let paths = new RealmPaths(realm.url);

      return paths.inRealm(new URL(request.url));
    });

    let response;

    if (targetRealm) {
      response = await targetRealm.maybeHandle(request);

      if (response) {
        (response as any)[Symbol.for('intercepted-by-virtual-network')] = true;
      }
    }

    return response || this.nativeFetch(request, init);
  };
}
