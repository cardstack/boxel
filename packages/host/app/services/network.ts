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

import config from '@cardstack/host/config/environment';

import { shimExternals } from '../lib/externals';
import { authErrorEventMiddleware } from '../utils/auth-error-guard';
import { scheduleNativeTimeout } from '../utils/render-timer-stub';

import { createServerRequestTimingMiddleware } from './client-telemetry';

import type LoaderService from './loader-service';
import type RealmService from './realm';
import type SessionService from './session';

export default class NetworkService extends Service {
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare session: SessionService;

  virtualNetwork = this.makeVirtualNetwork();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  get fetch() {
    return this.virtualNetwork.fetch;
  }

  get resolveImport() {
    return this.virtualNetwork.resolveImport;
  }

  get authedFetch() {
    // The timing middleware is innermost (last): it wraps each real network
    // attempt, so an auth-retry (the authorization middleware re-running the
    // chain on a 401) is observed as a separate, retried-flagged attempt. It
    // is a passive no-op whenever telemetry is disabled.
    return fetcher(
      this.fetch,
      [
        authorizationMiddleware(this.realm),
        authErrorEventMiddleware(),
        createServerRequestTimingMiddleware(getOwner(this)!),
      ],
      this.virtualNetwork,
    );
  }

  get mount() {
    return this.virtualNetwork.mount.bind(this.virtualNetwork);
  }

  private makeVirtualNetwork() {
    let virtualNetwork = new VirtualNetwork(globalThis.fetch, {
      // Native (un-stubbed) timer so the fetch retry path's header-timeout
      // abort and retry backoff still fire during prerender, where
      // render-timer-stub disables the global setTimeout — otherwise a stalled
      // fetch there can neither abort nor retry and hangs the render. Outside
      // prerender this is the global setTimeout, so behavior is unchanged.
      scheduleFetchTimer: (callback, ms) => scheduleNativeTimeout(callback, ms),
    });
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
    return virtualNetwork;
  }

  resetState = () => {
    this.virtualNetwork = this.makeVirtualNetwork();
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
