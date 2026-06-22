// In environment mode, Node.js fetch() (backed by undici) may fail to resolve
// *.localhost subdomains because getaddrinfo() doesn't always handle them per
// RFC 6761.  This module installs a global undici dispatcher that short-circuits
// DNS for *.localhost → 127.0.0.1 so that inter-service fetch() calls through
// Traefik work reliably.
//
// NOTE: This runs before logger setup, so we check the env var directly instead
// of importing isEnvironmentMode() (which would trigger a logger import).

import { createRequire } from 'module';

if (process.env.BOXEL_ENVIRONMENT) {
  try {
    // `require` doesn't exist in ESM scope; recreate it so undici stays a lazy,
    // optional load (the catch below tolerates it being absent).
    const require = createRequire(import.meta.url);
    const undici = require('undici') as typeof import('undici');
    const dns = require('dns');

    const agent = new undici.Agent({
      connect: {
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
