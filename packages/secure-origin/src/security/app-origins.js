/* eslint-env browser */
// Whether `origin` is one of the app origins the realm server lists for the
// credential fields. A listed origin whose host starts with `*.` stands for
// every subdomain of the rest, and one whose port is `*` for every port of
// its host, as each does in `frame-ancestors`.
export function isListedOrigin(origin, listed) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) {
    return false;
  }
  return listed.some((entry) => {
    if (entry === origin) {
      return true;
    }
    let pattern = parseListedOrigin(entry);
    return Boolean(
      pattern &&
      (pattern.subdomains || pattern.anyPort) &&
      url.protocol === pattern.protocol &&
      (pattern.subdomains
        ? url.hostname.endsWith(`.${pattern.host}`)
        : url.hostname === pattern.host) &&
      (pattern.anyPort || url.port === pattern.port),
    );
  });
}

// The parts of a listed origin: its scheme, its host without a leading `*.`,
// whether it stands for every subdomain of that host, and its port, `*`
// standing for any. The host is a domain name, an IPv4 address, or a
// bracketed IPv6 address, which has no subdomains. Undefined for anything
// that isn't an origin of that shape.
export function parseListedOrigin(entry) {
  let match =
    /^([a-z][a-z0-9+.-]*:)\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::(\d+|\*))?$/.exec(
      entry,
    );
  if (!match || (match[2] && match[3].startsWith('['))) {
    return undefined;
  }
  return {
    protocol: match[1],
    subdomains: Boolean(match[2]),
    host: match[3],
    anyPort: match[4] === '*',
    port: match[4] === '*' ? '' : (match[4] ?? ''),
  };
}
