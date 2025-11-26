import Koa from 'koa';
import Router from '@koa/router';
import { logger } from '@cardstack/runtime-common';
import { fetchRequestFromContext, fullRequestURL } from '../middleware';
import { format } from 'date-fns';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from './prerender-constants';

type ServerInfo = {
  url: string;
  capacity: number;
  activeRealms: Set<string>;
  warmedRealms: Set<string>;
  status: 'active' | 'draining';
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
  chooseServerForRealm: (
    realm: string,
    options?: { exclude?: Iterable<string> },
  ) => string | null;
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
  const heartbeatTimeoutMs = Math.max(
    1000,
    Number(
      process.env.PRERENDER_HEARTBEAT_TIMEOUT_MS ??
        process.env.PRERENDER_HEALTHCHECK_TIMEOUT_MS ??
        30000,
    ),
  );
  const heartbeatSweepIntervalMs = Math.max(
    0,
    Number(
      process.env.PRERENDER_HEARTBEAT_SWEEP_INTERVAL_MS ??
        process.env.PRERENDER_HEALTHCHECK_INTERVAL_MS ??
        5000,
    ),
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

  function hasCapacity(info: ServerInfo) {
    return info.activeRealms.size < info.capacity;
  }

  function isServerUsable(info: ServerInfo) {
    let stale = now() - info.lastSeenAt > heartbeatTimeoutMs;
    return !stale && info.status !== 'draining';
  }

  function cleanupAssignments(): void {
    for (let [realm, list] of registry.realms) {
      let filtered: string[] = [];
      for (let url of list) {
        let info = registry.servers.get(url);
        if (info && isServerUsable(info)) {
          filtered.push(url);
        } else {
          registry.servers.get(url)?.activeRealms.delete(realm);
        }
      }
      if (filtered.length === 0) {
        registry.realms.delete(realm);
        continue;
      }
      if (filtered.length !== list.length) {
        registry.realms.set(realm, filtered);
      }
    }
  }

  function pruneServer(url: string) {
    registry.servers.delete(url);
    for (let [realm, list] of registry.realms) {
      let idx;
      while ((idx = list.indexOf(url)) !== -1) {
        list.splice(idx, 1);
      }
      if (list.length === 0) registry.realms.delete(realm);
    }
  }

  function recordHeartbeat({
    url,
    capacity,
    status,
    warmedRealms,
  }: {
    url: string;
    capacity?: number;
    status?: 'active' | 'draining';
    warmedRealms?: string[];
  }) {
    let existing = registry.servers.get(url);
    if (existing) {
      existing.lastSeenAt = now();
      existing.capacity = capacity || existing.capacity;
      existing.status = status ?? 'active';
      existing.warmedRealms = new Set(warmedRealms ?? []);
      return existing;
    }

    let info: ServerInfo = {
      url,
      capacity: capacity || 4,
      activeRealms: new Set(),
      warmedRealms: new Set(warmedRealms ?? []),
      status: status ?? 'active',
      registeredAt: now(),
      lastSeenAt: now(),
      lastAssignedAt: 0,
    };
    registry.servers.set(url, info);
    return info;
  }

  function markDraining(url: string) {
    let info = registry.servers.get(url);
    if (info) {
      info.status = 'draining';
    }
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
          status: serverInfo.status,
          warmedRealms: Array.from(serverInfo.warmedRealms.values()),
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
      let status: 'active' | 'draining' =
        attrs.status === 'draining' ? 'draining' : 'active';
      let warmedRealms: string[] | undefined;
      if (Array.isArray(attrs.warmedRealms)) {
        warmedRealms = attrs.warmedRealms.filter((v: unknown): v is string =>
          Boolean(v && typeof v === 'string'),
        );
      }
      if (!url) {
        log.warn('Heartbeat rejected: prerender server URL not provided');
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: 'URL is required' }],
        };
        return;
      }
      url = normalizeURL(url);

      recordHeartbeat({ url, capacity, status, warmedRealms });
      ctxt.status = 204;
      ctxt.set('X-Prerender-Server-Id', url);
    } catch (e) {
      log.error('Error in heartbeat:', e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Heartbeat error' }] };
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

  function leastRecentlyUsedServerWithCapacity(
    realm: string,
    options?: {
      exclude?: Iterable<string>;
    },
  ): string | undefined {
    let excludeSet = new Set(options?.exclude ? [...options.exclude] : []);
    let bestWarm: { url: string; info: ServerInfo } | undefined;
    let best: { url: string; info: ServerInfo } | undefined;
    for (let [url, info] of registry.servers) {
      if (excludeSet.has(url)) {
        continue;
      }
      if (!isServerUsable(info) || !hasCapacity(info)) {
        continue;
      }
      if (info.warmedRealms.has(realm)) {
        if (!bestWarm || info.lastAssignedAt < bestWarm.info.lastAssignedAt) {
          bestWarm = { url, info };
        }
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
    return bestWarm?.url ?? best?.url;
  }

  // helper: choose server for realm
  function chooseServerForRealm(
    realm: string,
    options?: { exclude?: Iterable<string> },
  ): string | null {
    cleanupAssignments();
    let exclude = new Set(options?.exclude ? [...options.exclude] : []);
    let assigned = (registry.realms.get(realm) || []).filter(
      (url) => !exclude.has(url),
    );
    // If we have room to add another server for this realm, try to expand the
    // assignment set before choosing among existing ones.
    if (assigned.length < multiplex) {
      let candidate = leastRecentlyUsedServerWithCapacity(realm, {
        exclude: new Set([...assigned, ...exclude]),
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
    if (assigned.length > 0) {
      // prefer warmed entries in assigned set
      let warmed = assigned.find((url) => {
        let info = registry.servers.get(url);
        return info && isServerUsable(info) && hasCapacity(info);
      });
      let warmedPreferred = assigned.find((url) => {
        let info = registry.servers.get(url);
        return (
          info &&
          isServerUsable(info) &&
          hasCapacity(info) &&
          info.warmedRealms.has(realm)
        );
      });
      let next = warmedPreferred ?? warmed;
      if (next) {
        assigned = assigned.filter((url) => url !== next);
        assigned.push(next);
        if (assigned.length > multiplex) {
          assigned.splice(0, assigned.length - multiplex);
        }
        registry.realms.set(realm, assigned);
        let info = registry.servers.get(next);
        if (info) {
          info.lastAssignedAt = now();
          info.activeRealms.add(realm);
        }
        return next;
      }
    }
    // pick server with available capacity, prefer warmed
    let candidate = leastRecentlyUsedServerWithCapacity(realm, {
      exclude,
    });
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
      let arr = [...(registry.realms.get(lruRealm) || [])];
      while (arr.length > 0) {
        let url = arr.shift()!;
        let info = registry.servers.get(url);
        if (info && isServerUsable(info) && hasCapacity(info)) {
          arr.push(url);
          registry.realms.set(lruRealm, arr);
          let list = registry.realms.get(realm) || [];
          if (!list.includes(url)) list.push(url);
          if (list.length > multiplex) list = list.slice(-multiplex);
          registry.realms.set(realm, list);
          info.lastAssignedAt = now();
          return url;
        }
        registry.servers.get(url)?.activeRealms.delete(lruRealm);
      }
      if (arr.length === 0) {
        registry.realms.delete(lruRealm);
      }
    }
    // fallback: any usable server
    let anyCandidate = leastRecentlyUsedServerWithCapacity(realm, { exclude });
    if (anyCandidate) {
      let list = registry.realms.get(realm) || [];
      if (!list.includes(anyCandidate)) list.push(anyCandidate);
      if (list.length > multiplex) list = list.slice(-multiplex);
      registry.realms.set(realm, list);
      let info = registry.servers.get(anyCandidate);
      if (info) {
        info.lastAssignedAt = now();
      }
      return anyCandidate;
    }
    return null;
  }

  // health sweep: remove servers that have stopped heartbeating
  async function sweepServers() {
    let expired: string[] = [];
    for (let [url, info] of registry.servers) {
      let stale = now() - info.lastSeenAt > heartbeatTimeoutMs;
      if (stale) {
        log.warn(
          'Heartbeat sweep: prerender server %s is stale; removing',
          url,
        );
        expired.push(url);
      }
    }
    expired.forEach((url) => pruneServer(url));
  }

  // Schedule periodic heartbeat sweeps if configured. Use unref so this interval
  // won't keep the Node.js process alive on shutdown.
  if (heartbeatSweepIntervalMs > 0) {
    const timer = setInterval(() => {
      sweepServers().catch((e) => log.warn('Heartbeat sweep error:', e));
    }, heartbeatSweepIntervalMs);
    (timer as any).unref?.();
  }

  async function proxyPrerenderRequest(
    ctxt: Koa.Context,
    pathSuffix: string,
    label: string,
  ) {
    try {
      // read body once
      const req = await fetchRequestFromContext(ctxt);
      const raw = await req.text().catch(() => '');
      let body: any = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (e) {
          ctxt.status = 400;
          ctxt.body = {
            errors: [{ status: 400, message: 'Invalid JSON body' }],
          };
          return;
        }
      }
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
      if (registry.servers.size === 0) {
        ctxt.status = 503;
        ctxt.body = { errors: [{ status: 503, message: 'No servers' }] };
        return;
      }
      let attempts = new Set<string>();
      while (attempts.size < registry.servers.size) {
        let target = chooseServerForRealm(realm, { exclude: attempts });
        if (!target) {
          ctxt.status = 503;
          ctxt.body = { errors: [{ status: 503, message: 'No servers' }] };
          return;
        }
        attempts.add(target);

        const targetURL = `${normalizeURL(target)}/${pathSuffix}`;
        log.info(
          `proxying ${label} prerender request for ${attrs.url} to ${targetURL}`,
        );
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

        let draining =
          res?.status === PRERENDER_SERVER_DRAINING_STATUS_CODE ||
          res?.headers.get(PRERENDER_SERVER_STATUS_HEADER) ===
            PRERENDER_SERVER_STATUS_DRAINING;
        if (!res || draining) {
          if (draining) {
            markDraining(target);
          }
          // try next server if available
          if (attempts.size < registry.servers.size) {
            continue;
          }
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
        return;
      }
    } catch (e) {
      log.error(`Error in /${pathSuffix} proxy:`, e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Proxy error' }] };
    }
  }

  // proxy prerender endpoints
  router.post('/prerender-card', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-card', 'card'),
  );
  router.post('/prerender-module', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-module', 'module'),
  );

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
  return { app, registry, sweepServers, chooseServerForRealm };
}
