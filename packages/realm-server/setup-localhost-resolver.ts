// In environment mode, Node.js fetch() (backed by undici) may fail to resolve
// *.localhost subdomains because getaddrinfo() doesn't always handle them per
// RFC 6761.  This module installs a global undici dispatcher that short-circuits
// DNS for *.localhost → 127.0.0.1 so that inter-service fetch() calls through
// Traefik work reliably.

import { isEnvironmentMode } from './lib/dev-service-registry';

if (isEnvironmentMode()) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require('undici') as typeof import('undici');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dns = require('dns');

    const agent = new undici.Agent({
      connect: {
        lookup(
          hostname: string,
          options: any,
          cb: (...args: any[]) => void,
        ) {
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
