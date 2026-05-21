// In environment mode, Node.js fetch() (backed by undici) needs two
// adjustments to talk to *.localhost subdomains over HTTPS:
//
//   1. DNS: getaddrinfo() doesn't always resolve *.localhost per RFC 6761,
//      so the Agent's connect.lookup short-circuits *.localhost → 127.0.0.1
//      and inter-service fetch()es through Traefik resolve reliably.
//
//   2. TLS: the dev mkcert leaf advertises DNS:*.localhost as a SAN, but
//      tls.checkServerIdentity refuses two-label wildcards per RFC 6125
//      §7.2 — so the Agent's connect.checkServerIdentity wraps the default
//      check and accepts the *.localhost wildcard for single-label
//      .localhost hosts when the cert really does advertise it. Strict
//      validation is preserved for every other host/cert combination.
//
// NOTE: This runs before logger setup, so we check the env var directly instead
// of importing isEnvironmentMode() (which would trigger a logger import).

if (process.env.BOXEL_ENVIRONMENT) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const undici = require('undici') as typeof import('undici');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dns = require('dns');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wildcardTls = require('@cardstack/runtime-common/permissive-localhost-wildcard-tls');

    const agent = new undici.Agent({
      connect: {
        checkServerIdentity:
          wildcardTls.permissiveLocalhostWildcardCheckServerIdentity,
        lookup(hostname: string, options: any, cb: (...args: any[]) => void) {
          if (hostname?.endsWith('.localhost')) {
            if (options.all) {
              return cb(null, [{ address: '127.0.0.1', family: 4 }]);
            }
            return cb(null, '127.0.0.1', 4);
          }
          return dns.lookup(hostname, options, cb);
        },
      },
    });

    undici.setGlobalDispatcher(agent);
  } catch {
    // undici not available — native fetch will use system resolver
  }
}
