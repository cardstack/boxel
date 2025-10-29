import Koa from 'koa';
import Router from '@koa/router';
import { logger } from '@cardstack/runtime-common';
import { fetchRequestFromContext, fullRequestURL } from '../middleware';

type ServerInfo = {
  url: string;
  capacity: number;
  activeRealms: Set<string>;
  registeredAt: number;
  lastSeenAt: number;
};

type Registry = {
  servers: Map<string, ServerInfo>; // key: serverUrl
  realms: Map<string, string[]>; // realm -> array of serverUrls (deque semantics)
  lastAccessByRealm: Map<string, number>;
};

const log = logger('prerender-manager');

function now() {
  return Date.now();
}

function normalizeURL(u: string): string {
  // ensure no trailing slash
  try {
    let url = new URL(u);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch (e) {
    return u.replace(/\/$/, '');
  }
}

async function ping(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs).unref?.();
    const res = await fetch(url, { method: 'GET', signal: ac.signal });
    clearTimeout(t as any);
    return res.ok;
  } catch (e) {
    return false;
  }
}

function clientURLFromContext(ctxt: Koa.Context): string | null {
  let headerUrl = ctxt.get('X-Prerender-Server-Url');
  if (headerUrl) {
    return normalizeURL(headerUrl);
  }
  let ip = ctxt.req.socket.remoteAddress || '';
  if (!ip) {
    return null;
  }
  // strip IPv6 prefix if present
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const defaultPort = Number(process.env.PRERENDER_SERVER_DEFAULT_PORT ?? 4221);
  const scheme = 'http';
  return `${scheme}://${ip}:${defaultPort}`;
}

export function buildPrerenderManagerApp(): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  registry: Registry;
  sweepServers: () => Promise<void>;
} {
  const app = new Koa<Koa.DefaultState, Koa.Context>();
  const router = new Router();
  const registry: Registry = {
    servers: new Map(),
    realms: new Map(),
    lastAccessByRealm: new Map(),
  };

  const multiplex = Math.max(1, Number(process.env.PRERENDER_MULTIPLEX ?? 1));
  const proxyTimeoutMs = Math.max(
    1000,
    Number(process.env.PRERENDER_SERVER_TIMEOUT_MS ?? 30000),
  );
  const healthcheckTimeoutMs = Math.max(
    100,
    Number(process.env.PRERENDER_HEALTHCHECK_TIMEOUT_MS ?? 1000),
  );
  const healthcheckIntervalMs = Math.max(
    0,
    Number(process.env.PRERENDER_HEALTHCHECK_INTERVAL_MS ?? 0),
  );

  // health
  router.head('/', async (ctxt) => {
    ctxt.status = 200;
  });
  router.get('/', async (ctxt) => {
    ctxt.set('Content-Type', 'application/json');
    ctxt.body = JSON.stringify({ ready: true });
    ctxt.status = 200;
  });

  // register server
  router.post('/prerender-servers', async (ctxt) => {
    try {
      let req = await fetchRequestFromContext(ctxt);
      let raw = await req.text();
      let requestBody: any = {};
      if (raw) {
        try {
          requestBody = JSON.parse(raw);
        } catch (e) {
          log.debug('Invalid JSON body on registration; treating as empty:', e);
        }
      }

      let attrs = requestBody?.data?.attributes || {};
      let capacity: number = Number(attrs.capacity ?? 4);
      let url: string | undefined = attrs.url;
      if (!url) {
        let inferred = clientURLFromContext(ctxt);
        if (!inferred) {
          log.warn('Registration rejected: cannot infer URL');
          ctxt.status = 400;
          ctxt.body = {
            errors: [{ status: 400, message: 'Cannot infer URL' }],
          };
          return;
        }
        url = inferred;
      }
      url = normalizeURL(url);

      let ok = await ping(url, 2000);
      if (!ok) {
        log.warn('Registration rejected: server not reachable at %s', url);
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: `Server not reachable at ${url}` }],
        };
        return;
      }

      let existing = registry.servers.get(url);
      if (existing) {
        existing.lastSeenAt = now();
        existing.capacity = capacity || existing.capacity;
        ctxt.status = 204;
        ctxt.set('X-Prerender-Server-Id', url); // optional id header for convenience
        return;
      }

      registry.servers.set(url, {
        url,
        capacity: capacity || 4,
        activeRealms: new Set(),
        registeredAt: now(),
        lastSeenAt: now(),
      });
      ctxt.status = 204;
      ctxt.set('X-Prerender-Server-Id', url);
    } catch (e) {
      log.error('Error in registration:', e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Registration error' }] };
    }
  });

  // unregister server
  router.delete('/prerender-servers', async (ctxt) => {
    let url = clientURLFromContext(ctxt);
    if (url) {
      url = normalizeURL(url);
      registry.servers.delete(url);
      // remove from realms mappings
      for (let [realm, list] of registry.realms) {
        let idx = list.indexOf(url);
        if (idx >= 0) {
          list.splice(idx, 1);
          if (list.length === 0) registry.realms.delete(realm);
        }
      }
    } else {
      log.warn('Cannot unregister server: cannot infer prerender server url');
    }
    ctxt.status = 204;
  });

  // realm disposal
  router.delete('/prerender-servers/realms/:encodedRealm', async (ctxt) => {
    let realm = decodeURIComponent(ctxt.params.encodedRealm);
    let url = clientURLFromContext(ctxt);
    if (url) {
      url = normalizeURL(url);
      let list = registry.realms.get(realm) || [];
      let idx = list.indexOf(url);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) registry.realms.delete(realm);
      // free capacity marker
      registry.servers.get(url)?.activeRealms.delete(realm);
    } else {
      log.warn('Cannot dispose realm: cannot infer prerender server url');
    }
    ctxt.status = 204;
  });

  // helper: choose server for realm
  function chooseServerForRealm(realm: string): string | null {
    let assigned = registry.realms.get(realm);
    if (assigned && assigned.length > 0) {
      // If we have fewer than multiplex servers assigned, try to add a new one and prefer returning it
      if (assigned.length < multiplex) {
        for (let [url, info] of registry.servers) {
          if (
            !assigned.includes(url) &&
            info.activeRealms.size < info.capacity
          ) {
            assigned.push(url);
            // prefer the newly added server to spread load
            return url;
          }
        }
      }
      // Otherwise rotate among the assigned set
      let next = assigned.shift()!;
      assigned.push(next);
      if (assigned.length > multiplex) {
        assigned.splice(0, assigned.length - multiplex);
      }
      return next;
    }
    // pick server with available capacity
    for (let [url, info] of registry.servers) {
      if (info.activeRealms.size < info.capacity) {
        // assign
        let list = registry.realms.get(realm) || [];
        if (!list.includes(url)) list.push(url);
        if (list.length > multiplex) list = list.slice(-multiplex);
        registry.realms.set(realm, list);
        info.activeRealms.add(realm);
        return url;
      }
    }
    // pressure mode: pick server owning globally LRU realm
    let lruRealm: string | undefined;
    let lruTime = Infinity;
    for (let [r, t] of registry.lastAccessByRealm) {
      if (t < lruTime) {
        lruTime = t;
        lruRealm = r;
      }
    }
    if (lruRealm) {
      let arr = registry.realms.get(lruRealm);
      let url = arr?.[0];
      if (url) {
        let list = registry.realms.get(realm) || [];
        if (!list.includes(url)) list.push(url);
        if (list.length > multiplex) list = list.slice(-multiplex);
        registry.realms.set(realm, list);
        // don't mark active until success
        return url;
      }
    }
    // fallback: any server
    let any = [...registry.servers.keys()][0];
    if (any) {
      let list = registry.realms.get(realm) || [];
      if (!list.includes(any)) list.push(any);
      if (list.length > multiplex) list = list.slice(-multiplex);
      registry.realms.set(realm, list);
      return any;
    }
    return null;
  }

  // health sweep: remove unreachable servers and clean up realm mappings
  async function sweepServers() {
    let toRemove: string[] = [];
    for (let [url] of registry.servers) {
      let ok = await ping(url, healthcheckTimeoutMs);
      if (!ok) {
        log.warn(
          'Health sweep: prerender server %s is unhealthy; scheduling removal',
          url,
        );
        toRemove.push(url);
      }
    }
    if (toRemove.length === 0) return;
    for (let url of toRemove) {
      log.warn('Health sweep: removing unreachable prerender server %s', url);
      registry.servers.delete(url);
      for (let [realm, list] of registry.realms) {
        let idx;
        while ((idx = list.indexOf(url)) !== -1) {
          list.splice(idx, 1);
        }
        if (list.length === 0) registry.realms.delete(realm);
      }
    }
  }

  // Schedule periodic health sweeps if configured. Use unref so this interval
  // won't keep the Node.js process alive on shutdown.
  if (healthcheckIntervalMs > 0) {
    const timer = setInterval(() => {
      sweepServers().catch((e) => log.warn('Health sweep error:', e));
    }, healthcheckIntervalMs);
    (timer as any).unref?.();
  }

  // proxy prerender
  router.post('/prerender', async (ctxt) => {
    try {
      // read body once
      const req = await fetchRequestFromContext(ctxt);
      const raw = await req.text().catch(() => '');
      let body: any = raw ? JSON.parse(raw) : {};
      let attrs = body?.data?.attributes || {};
      let realm: string | undefined = attrs.realm;
      if (!realm) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            { status: 400, message: 'Missing required attribute: realm' },
          ],
        };
        return;
      }
      let target = chooseServerForRealm(realm);
      if (!target) {
        ctxt.status = 503;
        ctxt.body = { errors: [{ status: 503, message: 'No servers' }] };
        return;
      }

      const targetURL = `${normalizeURL(target)}/prerender`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), proxyTimeoutMs).unref?.();
      const res = await fetch(targetURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Accept: ctxt.get('Accept') || 'application/vnd.api+json',
        },
        body: raw,
        signal: ac.signal,
      }).catch((e) => {
        log.warn('Upstream error:', e);
        return null as any;
      });
      clearTimeout(timer as any);
      if (!res) {
        ctxt.status = 502;
        ctxt.body = { errors: [{ status: 502, message: 'Upstream error' }] };
        return;
      }
      // on success, mark last access and active realm
      if (res.ok) {
        registry.lastAccessByRealm.set(realm, now());
        // ensure activeRealms marks include this assignment
        let assigned = registry.realms.get(realm) || [];
        for (let url of assigned) {
          if (url === target) {
            registry.servers.get(url)?.activeRealms.add(realm);
            break;
          }
        }
      }
      ctxt.status = res.status;
      // pass through response
      for (let [k, v] of res.headers) {
        // avoid setting hop-by-hop headers
        if (/^transfer-encoding|connection$/i.test(k)) continue;
        ctxt.set(k, v);
      }
      ctxt.set('x-boxel-prerender-target', target);
      ctxt.set('x-boxel-prerender-realm', realm);
      const buf = Buffer.from(await res.arrayBuffer());
      ctxt.body = buf;
    } catch (e) {
      log.error('Error in /prerender proxy:', e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Proxy error' }] };
    }
  });

  app
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      log.info(
        `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}`,
      );
      ctxt.res.on('finish', () => {
        log.info(
          `--> ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}: ${ctxt.status}`,
        );
        log.debug(JSON.stringify(ctxt.req.headers));
      });
      return next();
    })
    .use(router.routes());
  return { app, registry, sweepServers };
}
