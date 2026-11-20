import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import {
  PREFIX_REALMS,
  VirtualNetwork,
  authorizationMiddleware,
  fetcher,
} from '@cardstack/runtime-common';
import { mayBeLiveRender } from '@cardstack/runtime-common/render-context';

import config from '@cardstack/host/config/environment';

import { shimBundledBase } from '../lib/bundled-base';
import { shimExternals } from '../lib/externals';
import { RequestLimiter } from '../lib/request-limiter';
import { authErrorEventMiddleware } from '../utils/auth-error-guard';
import { scheduleNativeTimeout } from '../utils/render-timer-stub';

import { createServerRequestTimingMiddleware } from './client-telemetry';

import type LoaderService from './loader-service';
import type RealmService from './realm';
import type SessionService from './session';

// What a fetch ended with: the answer it got, or the error it failed with,
// either before its answer arrived or while its body was being read.
export type FetchResult = { response: Response } | { error: unknown };

export type FetchWatcher = (url: string, result: FetchResult) => void;

export default class NetworkService extends Service {
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare session: SessionService;

  virtualNetwork = this.makeVirtualNetwork();

  private watchers = new Set<FetchWatcher>();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  // Every fetch the app makes goes through here: `authedFetch` and the
  // loader build on it. It is the virtual network's fetch, seen by any
  // watchers (`watchFetches`).
  get fetch(): typeof globalThis.fetch {
    return this.watchedFetch;
  }

  private watchedFetch: typeof globalThis.fetch = async (input, init) => {
    if (this.watchers.size === 0) {
      return await this.virtualNetwork.fetch(input, init);
    }
    let url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    let response: Response;
    try {
      response = await this.virtualNetwork.fetch(input, init);
    } catch (error) {
      this.notifyWatchers(url, { error });
      throw error;
    }
    this.notifyWatchers(url, { response });
    if (response.body) {
      // A body that fails while it is read fails the fetch as surely as one
      // that never answered. A copy is read alongside the caller's, so the
      // watchers hear of it whether or not the caller reads the body.
      let watchers = [...this.watchers];
      response
        .clone()
        .arrayBuffer()
        .catch((error: unknown) =>
          this.notifyWatchers(url, { error }, watchers),
        );
    }
    return response;
  };

  private notifyWatchers(
    url: string,
    result: FetchResult,
    watchers: FetchWatcher[] = [...this.watchers],
  ) {
    for (let watcher of watchers) {
      try {
        watcher(url, result);
      } catch {
        // A watcher only observes; the fetch's caller still gets its result.
      }
    }
  }

  get resolveImport() {
    return this.virtualNetwork.resolveImport;
  }

  // How many writes sent through `authedFetch` have settled, whether they
  // succeeded or not. Monotonic, and never reset: a reader compares two
  // readings to learn whether a write settled between them.
  #writeCount = 0;

  get writeCount(): number {
    return this.#writeCount;
  }

  get authedFetch(): typeof globalThis.fetch {
    // The timing middleware is innermost (last): it wraps each real network
    // attempt, so an auth-retry (the authorization middleware re-running the
    // chain on a 401) is observed as a separate, retried-flagged attempt. It
    // is a passive no-op whenever telemetry is disabled.
    let authed = fetcher(
      this.fetch,
      [
        authorizationMiddleware(this.realm),
        authErrorEventMiddleware(),
        createServerRequestTimingMiddleware(getOwner(this)!),
      ],
      this.virtualNetwork,
    );
    return async (input, init) => {
      if (!isWriteRequest(input, init)) {
        return await authed(input, init);
      }
      try {
        return await authed(input, init);
      } finally {
        this.#writeCount++;
      }
    };
  }

  // Calls `watcher` with each fetch's URL and what it ended with, until the
  // returned function is called: its answer, or the error it failed with.
  // A fetch whose body then fails while it is read is reported again, with
  // that error. A watcher that throws is ignored.
  watchFetches(watcher: FetchWatcher): () => void {
    this.watchers.add(watcher);
    return () => {
      this.watchers.delete(watcher);
    };
  }

  get mount() {
    return this.virtualNetwork.mount.bind(this.virtualNetwork);
  }

  private configureVirtualNetwork(virtualNetwork: VirtualNetwork) {
    // Registered from the shared declaration rather than one block per realm,
    // so this set cannot drift from the one the realm-server registers.
    //
    // The URLs come from `prefixRealmURLs`, which carries where each prefix
    // realm is served, rather than from the realm-list properties: a test build
    // trims the catalog and openrouter realms out of its lists for isolation
    // while the realm-server still serves them, and the prefix has to resolve
    // either way. A realm absent from this build has no entry and no prefix.
    // An `alias` additionally maps a `https://` spelling onto the same realm;
    // only the base realm has one.
    let prefixRealmURLs = (config.prefixRealmURLs ?? {}) as Record<
      string,
      string
    >;
    let configuredURLs = config as unknown as Record<string, string>;
    for (let { prefix, alias, hostConfigKey } of PREFIX_REALMS) {
      // Wherever the environment names the realm, that URL is what everything
      // else in the process resolves it to, so registering a prefix against
      // anything else would split the two. The map covers only the realms the
      // environment has trimmed from its lists — the catalog and openrouter
      // realms in a test build — which is the gap it was added for. Reading the
      // property here widens nothing, because nothing is written back.
      let servedAt = configuredURLs[hostConfigKey] ?? prefixRealmURLs[prefix];
      if (typeof servedAt !== 'string' || servedAt === '') {
        continue;
      }
      let resolvedRealmURL = new URL(withTrailingSlash(servedAt));
      if (alias) {
        virtualNetwork.addURLMapping(new URL(alias), resolvedRealmURL);
      }
      virtualNetwork.addRealmMapping(prefix, resolvedRealmURL.href);
    }
    shimExternals(virtualNetwork);
    shimBundledBase(virtualNetwork);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${config.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    // Some test fixture content (JSON card files under tests/cards/, embedded
    // card ids in test data) refers to the live test realm by its standard-
    // mode URL `https://localhost:4202/test/`. In environment mode the live
    // test realm is served at a per-environment Traefik hostname. Mapping
    // the standard-mode URL onto whatever the running test realm-server
    // serves lets the same fixture content resolve under either mode.
    // Gated on isTesting() so the mapping never reaches prod fetches.
    if (isTesting()) {
      let hardcodedTestRealmURL = new URL('https://localhost:4202/test/');
      let resolvedTestRealmURL = new URL(
        withTrailingSlash(config.resolvedTestRealmURL),
      );
      if (resolvedTestRealmURL.href !== hardcodedTestRealmURL.href) {
        virtualNetwork.addURLMapping(
          hardcodedTestRealmURL,
          resolvedTestRealmURL,
        );
      }
    }
  }

  private makeVirtualNetwork() {
    let virtualNetwork = new VirtualNetwork(
      this.limitedFetch(globalThis.fetch),
      {
        // Native (un-stubbed) timer so the fetch retry path's header-timeout
        // abort and retry backoff still fire during prerender, where
        // render-timer-stub disables the global setTimeout — otherwise a stalled
        // fetch there can neither abort nor retry and hangs the render. Outside
        // prerender this is the global setTimeout, so behavior is unchanged.
        scheduleFetchTimer: (callback, ms) =>
          scheduleNativeTimeout(callback, ms),
      },
    );
    this.configureVirtualNetwork(virtualNetwork);
    return virtualNetwork;
  }

  // The fetch the virtual network sends real requests through. With the
  // LIMIT_REQUESTS_IN_FLIGHT flag on, an interactive tab holds its requests
  // to each origin to a fixed number in flight and sends writes and auth
  // first (see lib/request-limiter.ts). A prerender tab, where the whole page
  // is a render (`mayBeLiveRender` is false), is left alone: the order this
  // queue chooses is for a person waiting on a write or a sign-in, and a render
  // has no such request. An interactive tab's own index render raises the
  // render context too, but names the element it renders into; its requests
  // share the tab's connection, so they stay counted. The flag is read for
  // each request, so a test that turns it on reaches a network built before
  // it did.
  private limitedFetch(
    nativeFetch: typeof globalThis.fetch,
  ): typeof globalThis.fetch {
    let limiter = new RequestLimiter((request) => nativeFetch(request));
    return (input, init) => {
      if (
        !config.featureFlags?.LIMIT_REQUESTS_IN_FLIGHT ||
        !mayBeLiveRender()
      ) {
        return nativeFetch(input, init);
      }
      return limiter.fetch(
        input instanceof Request && !init ? input : new Request(input, init),
      );
    };
  }

  // Returns this service's network to its just-booted configuration without
  // replacing it. The instance is handed to consumers that keep it — the
  // Loader folds cache keys through it, `fetcher` closes over it — so
  // swapping in a replacement would leave them naming through a network
  // nothing else consults, and their mapping-change subscriptions attached to
  // the discarded one. `reset()` clears the mappings and tells the
  // subscribers; re-registering restores the set every boot installs.
  resetState = () => {
    this.virtualNetwork.reset();
    this.configureVirtualNetwork(this.virtualNetwork);
  };
}

declare module '@ember/service' {
  interface Registry {
    network: NetworkService;
  }
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

// A request that can change what a realm holds: any method but the reads,
// where a POST carrying a QUERY method override is a read.
function isWriteRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  let method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS', 'QUERY'].includes(method)) {
    return false;
  }
  let headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  return headers.get('X-HTTP-Method-Override')?.toUpperCase() !== 'QUERY';
}
