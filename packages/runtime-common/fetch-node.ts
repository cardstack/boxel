/**
 * Creates a fetch implementation that's appropriate for the current environment.
 * In Node.js, it enhances localhost subdomain resolution using Undici agent.
 * In browsers, it uses native fetch.
 */
export function createEnvironmentAwareFetch(): typeof globalThis.fetch {
  // Node.js environment - create enhanced fetch with Undici dispatcher
  try {
    // Check if undici and dns are available at runtime
    let undici: any;
    let dns: any;
    try {
      undici = require('undici');
      dns = require('dns');
    } catch (e) {
      // Undici not available - fallback to native fetch
      return globalThis.fetch.bind(globalThis);
    }

    const { Agent } = undici;

    // Create a custom agent with localhost subdomain resolution
    const agent = new Agent({
      connect: {
        // This replaces dns.lookup for sockets created by this Agent
        lookup(hostname: string, options: any, cb: any) {
          if (hostname?.endsWith('.localhost')) {
            if (options.all) {
              // Return array format if options.all is true
              return cb(null, [{ address: '127.0.0.1', family: 4 }], null);
            } else {
              // Return standard format otherwise
              return cb(null, '127.0.0.1', 4);
            }
          }
          // Use default DNS lookup for all other hostnames
          // Use a lazy-loaded function to avoid bundler issues
          function performDNSLookup() {
            try {
              return dns.lookup(hostname, options, cb);
            } catch (e) {
              return cb(new Error('DNS lookup failed'), null, null);
            }
          }
          return performDNSLookup();
        },
      },
    });

    // Create a custom fetch function that uses our agent
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      let fetch = globalThis.fetch.bind(globalThis);
      return fetch(input, {
        ...init,
        dispatcher: agent,
      } as any);
    };
  } catch (e) {
    // Fallback to native fetch if undici setup fails
    return globalThis.fetch.bind(globalThis);
  }
}
