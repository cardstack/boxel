// Node's `tls.checkServerIdentity` rejects two-label wildcard certs like
// `DNS:*.localhost` (RFC 6125 §7.2 requires a wildcard pattern to have at
// least three dot-separated parts, e.g. `*.example.com`). The dev cert
// `infra:ensure-dev-cert` provisions intentionally lists `*.localhost` so
// the realm-server can terminate TLS for arbitrary tenant subdomains
// (`<realm>.localhost:4201`), but Node-side `fetch()` against those
// subdomains fails with `ERR_TLS_CERT_ALTNAME_INVALID`.
//
// This helper wraps the default check: it defers to `tls.checkServerIdentity`
// first, and only overrides the result when the request is for a single-label
// `.localhost` host AND the cert actually advertises `DNS:*.localhost`. Every
// other host / cert combination keeps strict validation.

import type { PeerCertificate } from 'node:tls';

const SINGLE_LABEL_LOCALHOST_HOST = /^[^.]+\.localhost\.?$/i;
const WILDCARD_LOCALHOST_SAN_RE = /(?:^|,\s*)DNS:\*\.localhost(?:,|$)/i;

let cachedCheckServerIdentity:
  | ((host: string, cert: PeerCertificate) => Error | undefined)
  | undefined;

function defaultCheckServerIdentity(
  host: string,
  cert: PeerCertificate,
): Error | undefined {
  if (!cachedCheckServerIdentity) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedCheckServerIdentity = require('node:tls').checkServerIdentity;
  }
  return cachedCheckServerIdentity!(host, cert);
}

export function permissiveLocalhostWildcardCheckServerIdentity(
  host: string,
  cert: PeerCertificate,
): Error | undefined {
  let err = defaultCheckServerIdentity(host, cert);
  if (!err) {
    return undefined;
  }
  if (!SINGLE_LABEL_LOCALHOST_HOST.test(host)) {
    return err;
  }
  let san = cert.subjectaltname ?? '';
  if (!WILDCARD_LOCALHOST_SAN_RE.test(san)) {
    return err;
  }
  return undefined;
}
