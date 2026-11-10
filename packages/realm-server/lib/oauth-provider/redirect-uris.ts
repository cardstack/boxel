// The rules for an openly registered client's redirect URIs (ADR 021 §1.4),
// shared by dynamic registration and client ID metadata documents. Each check
// is synchronous and reads only the URI and the hosts given, since a client
// ID metadata document is checked inside the library's metadata validator,
// which can't wait.

import { parseListedOrigin } from '@cardstack/secure-origin/security/app-origins.js';

// The loopback hosts a native client may redirect to over plain HTTP, written
// as `URL.hostname` writes them (RFC 8252 §7.3). The library's own list.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The hosts where Boxel serves its own pages or users' files. An openly
// registered client may not redirect to one, nor be identified by a URL on
// one: anyone can publish a page there, and consent would name the client by
// a domain that reads as Boxel's own.
export interface BoxelHosts {
  // Matched as written.
  exact: ReadonlySet<string>;
  // Matched with every subdomain.
  domains: readonly string[];
}

// Builds the hosts from the server's existing settings: the realm server's
// URL, the secure origin, the app origins listed for the secure origin, and
// the domains users publish sites on. A loopback host among them is left out,
// since development serves Boxel on loopback and a native client redirects
// there.
export function boxelHosts({
  serverURL,
  secureOriginURL,
  appOrigins = [],
  publishedDomains = [],
}: {
  serverURL: URL;
  secureOriginURL?: URL;
  // In the `--secureOriginAppOrigin` syntax: a host starting with `*.` stands
  // for every subdomain of the rest, and a port of `*` for every port.
  appOrigins?: readonly string[];
  // Each a host, with or without a port, such as `boxel.site` or
  // `localhost:4201`.
  publishedDomains?: readonly string[];
}): BoxelHosts {
  let exact = new Set<string>();
  let domains: string[] = [];
  let add = (host: string, withSubdomains: boolean) => {
    let normalized = normalizeHost(host);
    if (!normalized || LOOPBACK_HOSTS.has(normalized)) {
      return;
    }
    if (withSubdomains) {
      domains.push(normalized);
    } else {
      exact.add(normalized);
    }
  };
  add(serverURL.hostname, false);
  if (secureOriginURL) {
    add(secureOriginURL.hostname, false);
  }
  for (let origin of appOrigins) {
    let pattern = parseListedOrigin(origin);
    if (!pattern) {
      throw new Error(`${origin} is not an app origin`);
    }
    // A pattern for every subdomain refuses the domain itself too: refusing a
    // host Boxel may not serve costs a client nothing it needs.
    add(pattern.host, pattern.subdomains);
  }
  for (let domain of publishedDomains) {
    let url = URL.parse(`https://${domain}`);
    if (!url || url.host !== domain.toLowerCase()) {
      throw new Error(`${domain} is not a published-site domain`);
    }
    add(url.hostname, true);
  }
  return Object.freeze({ exact: Object.freeze(exact), domains });
}

// Whether a URL's host is one of Boxel's own. Its port and any user
// information play no part, and neither do the letter case or a trailing dot
// it is written with.
export function isOnBoxelHost(url: URL, hosts: BoxelHosts): boolean {
  let host = normalizeHost(url.hostname);
  if (!host || LOOPBACK_HOSTS.has(host)) {
    return false;
  }
  return (
    hosts.exact.has(host) ||
    hosts.domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  );
}

// Whether a redirect URI is plain HTTP on a loopback host, which a native
// client uses on whatever port is free (RFC 8252 §7.3).
export function isLoopbackRedirect(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

// Why a redirect URI is refused, or undefined when it is allowed. Allowed:
// HTTPS on a host that isn't Boxel's, or plain HTTP on a loopback host. A
// private-use scheme such as `cursor://` is refused, since any app on the
// device can claim one (RFC 8252 §8.1). So is user information, which only
// serves to make a URI read as another host.
export function redirectURIRefusal(
  uri: unknown,
  hosts: BoxelHosts,
): string | undefined {
  if (typeof uri !== 'string') {
    return 'each redirect URI must be a string';
  }
  let url = URL.parse(uri);
  if (!url) {
    return 'each redirect URI must be an absolute URL';
  }
  if (url.hash || uri.includes('#')) {
    return 'a redirect URI must not have a fragment';
  }
  if (url.username || url.password) {
    return 'a redirect URI must not have user information';
  }
  if (url.protocol === 'http:') {
    return isLoopbackRedirect(url)
      ? undefined
      : 'a plain HTTP redirect URI must be on localhost, 127.0.0.1 or [::1]';
  }
  if (url.protocol !== 'https:') {
    return 'a redirect URI must use https, or http on a loopback address';
  }
  if (isOnBoxelHost(url, hosts)) {
    return "a redirect URI must not be on one of Boxel's own hosts";
  }
  return undefined;
}

// The application type a client is registered as, which Boxel decides from
// its redirect URIs, never from what the client declares. The library matches
// a loopback redirect on any port only for a native client, and refuses an
// HTTPS loopback redirect for one, so a client is native exactly when every
// redirect URI is plain HTTP on a loopback host.
export function applicationTypeFor(
  redirectURIs: readonly string[],
): 'native' | 'web' {
  return redirectURIs.length > 0 &&
    redirectURIs.every((uri) => {
      let url = URL.parse(uri);
      return Boolean(url && isLoopbackRedirect(url));
    })
    ? 'native'
    : 'web';
}

// A host in one spelling: lower case, with one trailing dot dropped (a fully
// qualified name names the same host). Undefined for no host.
function normalizeHost(host: string): string | undefined {
  let lower = host.toLowerCase();
  let normalized = lower.endsWith('.') ? lower.slice(0, -1) : lower;
  return normalized || undefined;
}
