/* eslint-env browser */
// Whether `origin` is one of the app origins the realm server lists for the
// credential fields. A listed origin whose host starts with `*.` stands for
// every subdomain of the rest, as it does in `frame-ancestors`.
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
    let match = /^([a-z][a-z0-9+.-]*:)\/\/\*\.([^/:]+)(?::(\d+))?$/.exec(entry);
    return Boolean(
      match &&
      url.protocol === match[1] &&
      url.hostname.endsWith(`.${match[2]}`) &&
      url.port === (match[3] ?? ''),
    );
  });
}
