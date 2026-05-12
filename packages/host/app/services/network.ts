import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  VirtualNetwork,
  authorizationMiddleware,
  baseRealm,
  fetcher,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import { shimExternals } from '../lib/externals';
import { authErrorEventMiddleware } from '../utils/auth-error-guard';

import type LoaderService from './loader-service';
import type RealmService from './realm';
import type ResetService from './reset';

export default class NetworkService extends Service {
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare reset: ResetService;

  virtualNetwork = this.makeVirtualNetwork();

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  get fetch() {
    return this.virtualNetwork.fetch;
  }

  get resolveImport() {
    return this.virtualNetwork.resolveImport;
  }

  get authedFetch() {
    return fetcher(this.fetch, [
      authorizationMiddleware(this.realm),
      authErrorEventMiddleware(),
    ]);
  }

  get mount() {
    return this.virtualNetwork.mount.bind(this.virtualNetwork);
  }

  private makeVirtualNetwork() {
    let virtualNetwork = new VirtualNetwork(globalThis.fetch);
    this.installH2OriginMappings(virtualNetwork);
    let resolvedBaseRealmURL = new URL(
      withTrailingSlash(config.resolvedBaseRealmURL),
    );
    // URL mapping kept for the fake https://cardstack.com/base/ → real URL.
    // addRealmMapping registers the @cardstack/base/ scoped prefix.
    virtualNetwork.addURLMapping(new URL(baseRealm.url), resolvedBaseRealmURL);
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      resolvedBaseRealmURL.href,
    );
    shimExternals(virtualNetwork);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${config.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    if (config.resolvedCatalogRealmURL) {
      virtualNetwork.addRealmMapping(
        '@cardstack/catalog/',
        config.resolvedCatalogRealmURL,
      );
    }
    if (config.resolvedSkillsRealmURL) {
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        config.resolvedSkillsRealmURL,
      );
    }
    if (config.resolvedOpenRouterRealmURL) {
      virtualNetwork.addRealmMapping(
        '@cardstack/openrouter/',
        config.resolvedOpenRouterRealmURL,
      );
    }
    return virtualNetwork;
  }

  // HTTP/2 alias re-route: when the prerender harness injects a JSON
  // list of {from, to} origin pairs as window.__realmH2OriginMappings__,
  // route realm-server fetches through the HTTPS/h2 listener(s) so
  // they multiplex over one connection per origin instead of
  // serializing through Chrome's HTTP/1.1 6-per-origin ceiling.
  // Canonical realm URLs (in card data) stay on the http origin — only
  // the wire fetch is rewritten. See the repo-root README's "HTTP/2 dev
  // access" section.
  private installH2OriginMappings(virtualNetwork: VirtualNetwork) {
    let raw = (globalThis as unknown as { __realmH2OriginMappings__?: string })
      .__realmH2OriginMappings__;
    for (let { from, to } of parseH2OriginMappings(raw)) {
      virtualNetwork.addURLMapping(from, to);
    }
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

// Parses the JSON-encoded h2 origin mappings injected by the prerender
// harness. Each entry must have a parseable `from` URL and a `to` URL
// whose scheme is `https:` and whose hostname is a loopback alias —
// this contains the `--ignore-certificate-errors` trust relaxation to
// local-dev only. A malformed input, an empty global, or a `to` that
// would redirect realm fetches off-loopback returns nothing.
export function parseH2OriginMappings(
  raw: string | undefined,
): Array<{ from: URL; to: URL }> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  let mappings: Array<{ from: URL; to: URL }> = [];
  for (let entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    let from = (entry as { from?: unknown }).from;
    let to = (entry as { to?: unknown }).to;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    let fromUrl: URL;
    let toUrl: URL;
    try {
      fromUrl = new URL(from);
      toUrl = new URL(to);
    } catch {
      continue;
    }
    if (toUrl.protocol !== 'https:') continue;
    if (!isLoopbackHostname(toUrl.hostname)) continue;
    if (fromUrl.origin === toUrl.origin) continue;
    mappings.push({ from: fromUrl, to: toUrl });
  }
  return mappings;
}

function isLoopbackHostname(hostname: string): boolean {
  let h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]'
  );
}
