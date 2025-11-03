import Koa from 'koa';
import Router from '@koa/router';
import { logger } from '@cardstack/runtime-common';
import { fetchRequestFromContext, fullRequestURL } from '../middleware';
import { format } from 'date-fns';

type ServerInfo = {
  url: string;
  capacity: number;
  activeRealms: Set<string>;
  registeredAt: number;
  lastSeenAt: number;
  lastAssignedAt: number;
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

function formatTimestampWithTimezone(timestamp: number): string {
  const date = new Date(timestamp);
  // Get timezone offset in hours and minutes
  const offset = -date.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offset) / 60);
  const offsetMinutes = Math.abs(offset) % 60;
  const offsetSign = offset >= 0 ? '+' : '-';
  const timezone = `UTC${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;

  // Format: YYYY-MM-DD HH:mm:ss (Timezone)
  const formattedDate = format(date, 'yyyy-MM-dd HH:mm:ss');

  return `${formattedDate} (${timezone})`;
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
    Number(process.env.PRERENDER_SERVER_TIMEOUT_MS ?? 60000),
  );
  const healthcheckTimeoutMs = Math.max(
    100,
    Number(process.env.PRERENDER_HEALTHCHECK_TIMEOUT_MS ?? 1000),
  );
  const healthcheckIntervalMs = Math.max(
    0,
    Number(process.env.PRERENDER_HEALTHCHECK_INTERVAL_MS ?? 0),
  );

  function urlFromQuery(ctxt: Koa.Context): string | undefined {
    let raw = (ctxt.query as Record<string, unknown>)?.['url'];
    if (typeof raw === 'string') {
      return raw;
    }
    if (Array.isArray(raw)) {
      return raw[0];
    }
    return undefined;
  }

  // health
  router.head('/', async (ctxt) => {
    ctxt.status = 200;
  });
  router.get('/', async (ctxt) => {
    ctxt.set('Content-Type', 'application/vnd.api+json');

    // Build the list of active servers with their realms
    let servers = [];
    for (let [serverUrl, serverInfo] of registry.servers) {
      let realms = [];
      for (let realm of serverInfo.activeRealms) {
        realms.push({
          url: realm,
          // Use the last access time if available, otherwise fall back to server registration time
          // (which represents when the realm was first assigned to this server)
          lastUsed: formatTimestampWithTimezone(
            registry.lastAccessByRealm.get(realm) || serverInfo.registeredAt,
          ),
        });
      }

      servers.push({
        type: 'prerender-server',
        id: serverUrl,
        attributes: {
          url: serverUrl,
          capacity: serverInfo.capacity,
          registeredAt: formatTimestampWithTimezone(serverInfo.registeredAt),
          lastSeenAt: formatTimestampWithTimezone(serverInfo.lastSeenAt),
          realms: realms,
        },
      });
    }

    ctxt.body = JSON.stringify({
      data: {
        type: 'prerender-manager-health',
        id: 'health',
        attributes: {
          ready: true,
        },
      },
      included: servers,
    });
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
        log.warn('Registration rejected: prerender server URL not provided');
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: 'URL is required' }],
        };
        return;
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
        lastAssignedAt: 0,
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
    let url = urlFromQuery(ctxt);
    if (!url) {
      log.warn('Cannot unregister server: missing url query parameter');
      ctxt.status = 400;
      ctxt.body = {
        errors: [
          {
            status: 400,
            message: 'Missing required query parameter: url',
          },
        ],
      };
      return;
    }
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
    ctxt.status = 204;
  });

  // realm disposal
  router.delete('/prerender-servers/realms/:encodedRealm', async (ctxt) => {
    let realm = decodeURIComponent(ctxt.params.encodedRealm);
    let url = urlFromQuery(ctxt);
    if (!url) {
      log.warn('Cannot dispose realm %s: missing url query parameter', realm);
      ctxt.status = 400;
      ctxt.body = {
        errors: [
          {
            status: 400,
            message: 'Missing required query parameter: url',
          },
        ],
      };
      return;
    }
    url = normalizeURL(url);
    let list = registry.realms.get(realm) || [];
    let idx = list.indexOf(url);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) registry.realms.delete(realm);
    // free capacity marker
    registry.servers.get(url)?.activeRealms.delete(realm);
    ctxt.status = 204;
  });

  function leastRecentlyUsedServerWithCapacity(options?: {
    exclude?: Iterable<string>;
  }): string | undefined {
    let excludeSet = new Set(options?.exclude ? [...options.exclude] : []);
    let best: { url: string; info: ServerInfo } | undefined;
    for (let [url, info] of registry.servers) {
      if (excludeSet.has(url)) {
        continue;
      }
      if (info.activeRealms.size >= info.capacity) {
        continue;
      }
      if (!best) {
        best = { url, info };
        continue;
      }
      if (info.lastAssignedAt < best.info.lastAssignedAt) {
        best = { url, info };
      }
    }
    return best?.url;
  }

  // helper: choose server for realm
  function chooseServerForRealm(realm: string): string | null {
    let assigned = registry.realms.get(realm);
    if (assigned && assigned.length > 0) {
      // If we have fewer than multiplex servers assigned, try to add a new one and prefer returning it
      if (assigned.length < multiplex) {
        let candidate = leastRecentlyUsedServerWithCapacity({
          exclude: assigned,
        });
        if (candidate) {
          assigned.push(candidate);
          if (assigned.length > multiplex) {
            assigned.splice(0, assigned.length - multiplex);
          }
          registry.realms.set(realm, assigned);
          let info = registry.servers.get(candidate);
          if (info) {
            info.activeRealms.add(realm);
            info.lastAssignedAt = now();
          }
          return candidate;
        }
      }
      // Otherwise rotate among the assigned set
      let next = assigned.shift()!;
      assigned.push(next);
      if (assigned.length > multiplex) {
        assigned.splice(0, assigned.length - multiplex);
      }
      registry.realms.set(realm, assigned);
      let info = registry.servers.get(next);
      if (info) {
        info.lastAssignedAt = now();
      }
      return next;
    }
    // pick server with available capacity
    {
      let candidate = leastRecentlyUsedServerWithCapacity();
      if (candidate) {
        let list = registry.realms.get(realm) || [];
        if (!list.includes(candidate)) list.push(candidate);
        if (list.length > multiplex) list = list.slice(-multiplex);
        registry.realms.set(realm, list);
        let info = registry.servers.get(candidate);
        if (info) {
          info.activeRealms.add(realm);
          info.lastAssignedAt = now();
        }
        return candidate;
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
        let info = registry.servers.get(url);
        if (info) {
          info.lastAssignedAt = now();
        }
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
      let info = registry.servers.get(any);
      if (info) {
        info.lastAssignedAt = now();
      }
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
      log.info(`proxying prerender request for ${attrs.url} to ${targetURL}`);
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
