// The host part of a URL in the one form the realm server compares hosts in:
// lowercased, without a trailing dot on the hostname, and without the port
// when it is the default one. `host` is the hostname with the port, when
// there is one.
export interface DomainHost {
  host: string;
  hostname: string;
  port: string;
}

export function domainHostOf(url: URL): DomainHost {
  let hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return {
    host: url.port ? `${hostname}:${url.port}` : hostname,
    hostname,
    port: url.port,
  };
}

// A domain as configuration gives it: a bare host (`example.test`, with a
// port or not) or a URL (`https://example.test/`). Undefined when it can't be
// parsed.
export function parseDomainHost(domain: string): DomainHost | undefined {
  try {
    return domainHostOf(
      new URL(domain.includes('://') ? domain : `https://${domain}`),
    );
  } catch {
    return undefined;
  }
}

// Whether `host` is on a configured `domain`. A domain configured with a port
// matches only that port. One configured without a port matches its hostname
// on any port, as local development serves it on one.
export function isOnDomain(host: DomainHost, domain: DomainHost): boolean {
  return domain.port
    ? host.host === domain.host
    : host.hostname === domain.hostname;
}
