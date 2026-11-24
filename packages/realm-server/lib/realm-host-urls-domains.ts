import { getPublishedRealmDomainOverrides } from '@cardstack/runtime-common/constants';
import {
  domainHostFromKey,
  domainHostOf,
  isOnDomain,
  parseDomainHost,
  type DomainHost,
} from './domain-host.ts';

// The domains a host URL can be on (ADR 033 §1.6). A Boxel Space host URL is
// a subdomain of the Space domain, a site name is a subdomain of the site
// domain, and a custom domain is one the deployment allows for one realm.
//
// The code that writes a host URL and the resolver read this one config, so a
// host URL that the writer accepts is also one the resolver looks up.

// How a host URL was given out. These are the values of
// `realm_host_urls.kind`.
export type HostURLKind = 'boxel-space' | 'site-name' | 'custom-domain';

export interface HostURLDomainsConfig {
  // The Space and site domains. Each may carry a port, as it does in local
  // development (`localhost:4201`).
  boxelSpace?: string;
  boxelSite?: string;
  // The custom domains the deployment allows, keyed by the URL of the realm
  // each one is allowed for.
  customDomains?: Record<string, string>;
}

// The parts of a host URL that `HostURLDomains.check` accepted. `host` and
// `pathPrefix` are in the form `realm_host_urls` stores them (ADR 033 §1.1).
// `subdomain` is the Space subdomain or the site name.
export type AcceptedHostURL =
  | {
      kind: 'boxel-space';
      host: string;
      pathPrefix: string;
      subdomain: string;
    }
  | { kind: 'site-name'; host: string; pathPrefix: '/'; subdomain: string }
  | { kind: 'custom-domain'; host: string; pathPrefix: '/' };

export type HostURLDomainCheck =
  | { accepted: AcceptedHostURL }
  | { refused: string };

export class HostURLDomains {
  #boxelSpace: DomainHost | undefined;
  #boxelSite: DomainHost | undefined;
  #customDomains: { realmURL: string; domain: DomainHost }[];

  // Every domain is parsed with `parseDomainHost`, as publishing parses a
  // custom domain. A domain that can't be parsed is left out.
  constructor(config: HostURLDomainsConfig) {
    this.#boxelSpace = config.boxelSpace
      ? parseDomainHost(config.boxelSpace)
      : undefined;
    this.#boxelSite = config.boxelSite
      ? parseDomainHost(config.boxelSite)
      : undefined;
    this.#customDomains = Object.entries(config.customDomains ?? {}).flatMap(
      ([realmURL, domain]) => {
        let parsed = parseDomainHost(domain);
        return parsed
          ? [{ realmURL: withTrailingSlash(realmURL), domain: parsed }]
          : [];
      },
    );
  }

  // The deployment's config: the published-realm domains, and the custom
  // domains of `PUBLISHED_REALM_DOMAIN_OVERRIDES`.
  static fromDeployment(
    domainsForPublishedRealms: { boxelSpace?: string; boxelSite?: string } = {},
    rawOverrides: string | undefined = process.env
      .PUBLISHED_REALM_DOMAIN_OVERRIDES,
  ): HostURLDomains {
    return new HostURLDomains({
      ...domainsForPublishedRealms,
      customDomains: getPublishedRealmDomainOverrides(rawOverrides),
    });
  }

  get isConfigured(): boolean {
    return Boolean(
      this.#boxelSpace || this.#boxelSite || this.#customDomains.length > 0,
    );
  }

  // Whether a host could carry a host URL. `host` is a request's host as
  // `hostKey` gives it.
  mayHaveHostURLs(host: string): boolean {
    let requestHost = domainHostFromKey(host);
    return (
      this.#customDomains.some(({ domain }) =>
        isOnDomain(requestHost, domain),
      ) ||
      [this.#boxelSpace, this.#boxelSite].some(
        (parent) =>
          parent !== undefined &&
          subdomainOf(requestHost, parent) !== undefined,
      )
    );
  }

  // The host of the Boxel Space whose subdomain is `subdomain`, or nothing
  // when no Boxel Space domain is configured.
  boxelSpaceHost(subdomain: string): string | undefined {
    return this.#boxelSpace
      ? `${subdomain}.${this.#boxelSpace.host}`
      : undefined;
  }

  // Whether a realm may have a host URL at `hostURL`, as far as its domain
  // tells. A custom domain must be allowed for this realm, and is served at
  // its root. A site name is served at the root of its subdomain. A Boxel
  // Space host URL is one path segment under its subdomain. The caller checks
  // the rest: whose Space it is, its path, and who claimed the site name.
  check(hostURL: URL, realmURL: string): HostURLDomainCheck {
    if (hostURL.protocol !== 'https:' && hostURL.protocol !== 'http:') {
      return { refused: 'A host URL must be an http or https URL' };
    }
    if (
      hostURL.username ||
      hostURL.password ||
      hostURL.search ||
      hostURL.hash
    ) {
      return {
        refused: 'A host URL must not have credentials, a query or a fragment',
      };
    }
    let requestHost = domainHostOf(hostURL);
    let pathPrefix = hostURL.pathname.endsWith('/')
      ? hostURL.pathname
      : `${hostURL.pathname}/`;
    let segments = pathPrefix.split('/').filter(Boolean);

    let custom = this.#customDomains.filter(({ domain }) =>
      isOnDomain(requestHost, domain),
    );
    if (custom.length > 0) {
      if (
        !custom.some((entry) => entry.realmURL === withTrailingSlash(realmURL))
      ) {
        return {
          refused: `The domain ${requestHost.host} is not allowed for this realm`,
        };
      }
      if (segments.length > 0) {
        return {
          refused: `A host URL on the custom domain ${requestHost.host} must be at its root`,
        };
      }
      return {
        accepted: {
          kind: 'custom-domain',
          host: requestHost.host,
          pathPrefix: '/',
        },
      };
    }

    // The Space and site domains can be the same domain, as they are in local
    // development. The path then tells them apart: a site is at the root of
    // its host, and a Space host URL is not.
    let siteName = this.#boxelSite
      ? subdomainOf(requestHost, this.#boxelSite)
      : undefined;
    if (siteName !== undefined && segments.length === 0) {
      return {
        accepted: {
          kind: 'site-name',
          host: requestHost.host,
          pathPrefix: '/',
          subdomain: siteName,
        },
      };
    }
    let spaceSubdomain = this.#boxelSpace
      ? subdomainOf(requestHost, this.#boxelSpace)
      : undefined;
    if (spaceSubdomain !== undefined && segments.length === 1) {
      return {
        accepted: {
          kind: 'boxel-space',
          host: requestHost.host,
          pathPrefix,
          subdomain: spaceSubdomain,
        },
      };
    }
    if (siteName !== undefined || spaceSubdomain !== undefined) {
      return {
        refused:
          'A site host URL must be at the root of its host, and a Boxel Space host URL must be one path segment',
      };
    }
    let allowed = [this.#boxelSpace, this.#boxelSite]
      .filter((domain): domain is DomainHost => domain !== undefined)
      .map((domain) => `a subdomain of ${domain.host}`);
    return {
      refused:
        allowed.length > 0
          ? `The host ${requestHost.host} is not a domain a host URL can be on. It must be ${[...new Set(allowed)].join(' or ')}, or a custom domain allowed for this realm`
          : `The host ${requestHost.host} is not a domain a host URL can be on`,
    };
  }
}

// The resolver's filter: hosts it returns false for are never looked up.
// Undefined when no domain is configured, which means every host is looked
// up.
export function hostURLDomainFilter(
  domains: HostURLDomains,
): ((host: string) => boolean) | undefined {
  if (!domains.isConfigured) {
    return undefined;
  }
  return (host) => domains.mayHaveHostURLs(host);
}

// The one label of `host` below `parent`, undefined when `host` is not a
// one-label subdomain of it. A parent configured with a port matches only
// that port, and one without matches any port, as `isOnDomain` does.
function subdomainOf(host: DomainHost, parent: DomainHost): string | undefined {
  if (parent.port && host.port !== parent.port) {
    return undefined;
  }
  let suffix = `.${parent.hostname}`;
  if (!host.hostname.endsWith(suffix)) {
    return undefined;
  }
  let label = host.hostname.slice(0, -suffix.length);
  return label && !label.includes('.') ? label : undefined;
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
