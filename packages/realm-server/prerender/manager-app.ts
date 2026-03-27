import Koa from 'koa';
import Router from '@koa/router';
import { logger } from '@cardstack/runtime-common';
import { fetchRequestFromContext, fullRequestURL } from '../middleware';
import { format } from 'date-fns';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
  resolvePrerenderServerProxyTimeoutMs,
} from './prerender-constants';
import { fromAffinityKey, toAffinityKey } from './affinity';
import type { AffinityType } from '@cardstack/runtime-common';

type ServerInfo = {
  url: string;
  capacity: number;
  activeAffinities: Set<string>;
  warmedAffinities: Set<string>;
  status: 'active' | 'draining';
  registeredAt: number;
  lastSeenAt: number;
  lastAssignedAt: number;
};

type Registry = {
  servers: Map<string, ServerInfo>; // key: serverUrl
  affinities: Map<string, string[]>; // affinityKey (<type>:<value>) -> assigned serverUrls (deque semantics)
  lastAccessByAffinity: Map<string, number>;
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

export function buildPrerenderManagerApp(options?: {
  isDraining?: () => boolean;
}): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  registry: Registry;
  sweepServers: () => Promise<void>;
  chooseServerForAffinity: (
    affinityType: AffinityType,
    affinityValue: string,
    options?: { exclude?: Iterable<string> },
  ) => string | null;
} {
  const app = new Koa<Koa.DefaultState, Koa.Context>();
  const router = new Router();
  const registry: Registry = {
    servers: new Map(),
    affinities: new Map(),
    lastAccessByAffinity: new Map(),
  };
  let lastRegistrySnapshot: string | undefined;

  const multiplex = Math.max(1, Number(process.env.PRERENDER_MULTIPLEX ?? 1));
  const proxyTimeoutMs = resolvePrerenderServerProxyTimeoutMs();
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
  const discoveryWaitMs = Math.max(
    0,
    Number(process.env.PRERENDER_SERVER_DISCOVERY_WAIT_MS ?? 10000),
  );
  const discoveryPollMs = Math.max(
    50,
    Number(process.env.PRERENDER_SERVER_DISCOVERY_POLL_MS ?? 100),
  );

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
    return info.activeAffinities.size < info.capacity;
  }

  function isServerUsable(info: ServerInfo) {
    let stale = now() - info.lastSeenAt > heartbeatTimeoutMs;
    return !stale && info.status !== 'draining';
  }

  function normalizeServersForLog(): string {
    return JSON.stringify(
      [...registry.servers.values()].map((s) => ({
        url: s.url,
        status: s.status,
        capacity: s.capacity,
        activeAffinities: Array.from(s.activeAffinities),
        warmedAffinities: Array.from(s.warmedAffinities),
        lastSeenAt: s.lastSeenAt,
      })),
    );
  }

  function logRegistryIfChanged(reason: string) {
    let snapshot = JSON.stringify({
      servers: [...registry.servers.values()].map((s) => ({
        url: s.url,
        status: s.status,
        capacity: s.capacity,
        activeAffinities: Array.from(s.activeAffinities),
        warmedAffinities: Array.from(s.warmedAffinities),
      })),
      affinities: [...registry.affinities.entries()],
    });
    if (snapshot !== lastRegistrySnapshot) {
      lastRegistrySnapshot = snapshot;
      log.debug('Registry changed (%s): %s', reason, snapshot);
    }
  }

  function cleanupAssignments(): void {
    for (let [affinityKey, list] of registry.affinities) {
      let filtered: string[] = [];
      for (let url of list) {
        let info = registry.servers.get(url);
        if (info && isServerUsable(info)) {
          filtered.push(url);
        } else {
          registry.servers.get(url)?.activeAffinities.delete(affinityKey);
        }
      }
      if (filtered.length === 0) {
        registry.affinities.delete(affinityKey);
        logRegistryIfChanged('cleanup removed affinity');
        continue;
      }
      if (filtered.length !== list.length) {
        registry.affinities.set(affinityKey, filtered);
        logRegistryIfChanged('cleanup pruned assignments');
      }
    }
  }

  function pruneServer(url: string) {
    registry.servers.delete(url);
    logRegistryIfChanged('prune server');
    for (let [affinityKey, list] of registry.affinities) {
      let idx;
      while ((idx = list.indexOf(url)) !== -1) {
        list.splice(idx, 1);
      }
      if (list.length === 0) registry.affinities.delete(affinityKey);
    }
  }

  function recordHeartbeat({
    url,
    capacity,
    status,
    warmedAffinities,
  }: {
    url: string;
    capacity?: number;
    status?: 'active' | 'draining';
    warmedAffinities?: string[];
  }) {
    log.debug(
      `received heartbeat from ${url} status=${status} capacity=${capacity} warmedAffinities=${warmedAffinities ? warmedAffinities.join() : 'none'}`,
    );
    let existing = registry.servers.get(url);
    let changed = false;
    if (existing) {
      let warmSet = new Set(warmedAffinities ?? []);
      existing.lastSeenAt = now();
      if (capacity && capacity !== existing.capacity) {
        existing.capacity = capacity;
        changed = true;
      }
      if (status && status !== existing.status) {
        existing.status = status;
        changed = true;
      }
      if (
        warmedAffinities &&
        (warmedAffinities.some((r) => !existing.warmedAffinities.has(r)) ||
          existing.warmedAffinities.size !== warmSet.size)
      ) {
        existing.warmedAffinities = warmSet;
        changed = true;
      }
      if (warmSet.size === 0) {
        // server restarted; clear tracked active affinities and mappings
        for (let affinityKey of [...existing.activeAffinities]) {
          existing.activeAffinities.delete(affinityKey);
          let arr = registry.affinities.get(affinityKey) || [];
          let idx;
          while ((idx = arr.indexOf(url)) !== -1) {
            arr.splice(idx, 1);
          }
          if (arr.length === 0) {
            registry.affinities.delete(affinityKey);
            registry.lastAccessByAffinity.delete(affinityKey);
          } else {
            registry.affinities.set(affinityKey, arr);
          }
        }
      } else {
        // drop active affinities that are not warmed to free capacity
        for (let affinityKey of [...existing.activeAffinities]) {
          if (!warmSet.has(affinityKey)) {
            existing.activeAffinities.delete(affinityKey);
            let arr = registry.affinities.get(affinityKey) || [];
            let idx;
            while ((idx = arr.indexOf(url)) !== -1) {
              arr.splice(idx, 1);
            }
            if (arr.length === 0) {
              registry.affinities.delete(affinityKey);
              registry.lastAccessByAffinity.delete(affinityKey);
            } else {
              registry.affinities.set(affinityKey, arr);
            }
          }
        }
      }
      if (changed) {
        logRegistryIfChanged('heartbeat update');
      }
      return existing;
    }

    let info: ServerInfo = {
      url,
      capacity: capacity || 4,
      activeAffinities: new Set(),
      warmedAffinities: new Set(warmedAffinities ?? []),
      status: status ?? 'active',
      registeredAt: now(),
      lastSeenAt: now(),
      lastAssignedAt: 0,
    };
    registry.servers.set(url, info);
    logRegistryIfChanged('heartbeat add');
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
    if (options?.isDraining?.()) {
      ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
      ctxt.set(
        PRERENDER_SERVER_STATUS_HEADER,
        PRERENDER_SERVER_STATUS_DRAINING,
      );
      return;
    }
    ctxt.status = 200;
  });
  router.get('/', async (ctxt) => {
    if (options?.isDraining?.()) {
      ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
      ctxt.set(
        PRERENDER_SERVER_STATUS_HEADER,
        PRERENDER_SERVER_STATUS_DRAINING,
      );
    }
    ctxt.set('Content-Type', 'application/vnd.api+json');

    // Build the list of active servers with their affinities
    let servers = [];
    for (let [serverUrl, serverInfo] of registry.servers) {
      let affinities = [];
      for (let affinityKey of serverInfo.activeAffinities) {
        let parsed = fromAffinityKey(affinityKey);
        affinities.push({
          key: affinityKey,
          affinityType: parsed?.affinityType ?? 'realm',
          affinityValue: parsed?.affinityValue ?? affinityKey,
          // Use the last access time if available, otherwise fall back to server registration time.
          lastUsed: formatTimestampWithTimezone(
            registry.lastAccessByAffinity.get(affinityKey) ||
              serverInfo.registeredAt,
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
          warmedAffinities: Array.from(serverInfo.warmedAffinities.values()),
          affinities,
        },
      });
    }

    ctxt.body = JSON.stringify({
      data: {
        type: 'prerender-manager-health',
        id: 'health',
        attributes: {
          ready: registry.servers.size > 0,
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
      let warmedAffinities: string[] | undefined;
      if (Array.isArray(attrs.warmedAffinities)) {
        warmedAffinities = attrs.warmedAffinities.filter(
          (v: unknown): v is string => Boolean(v && typeof v === 'string'),
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

      recordHeartbeat({ url, capacity, status, warmedAffinities });
      ctxt.status = 204;
      ctxt.set('X-Prerender-Server-Id', url);
    } catch (e) {
      log.error('Error in heartbeat:', e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Heartbeat error' }] };
    }
  });

  // maintenance: clear affinity assignments and capacity tracking
  router.post('/prerender-maintenance/reset', async (ctxt) => {
    for (let [, info] of registry.servers) {
      info.activeAffinities.clear();
    }
    registry.affinities.clear();
    registry.lastAccessByAffinity.clear();
    log.warn(
      'Maintenance reset: cleared affinity assignments and activeAffinities',
    );
    ctxt.status = 204;
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
    // remove from affinity mappings
    for (let [affinityKey, list] of registry.affinities) {
      let idx = list.indexOf(url);
      if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) registry.affinities.delete(affinityKey);
      }
    }
    ctxt.status = 204;
  });

  // affinity disposal
  router.delete(
    '/prerender-servers/affinities/:encodedAffinity',
    async (ctxt) => {
      let affinityKey = decodeURIComponent(ctxt.params.encodedAffinity);
      let url = urlFromQuery(ctxt);
      if (!url) {
        log.warn(
          'Cannot dispose affinity %s: missing url query parameter',
          affinityKey,
        );
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
      let list = registry.affinities.get(affinityKey) || [];
      let idx = list.indexOf(url);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) registry.affinities.delete(affinityKey);
      // free capacity marker
      registry.servers.get(url)?.activeAffinities.delete(affinityKey);
      ctxt.status = 204;
    },
  );

  function leastRecentlyUsedServerWithCapacity(
    affinityKey: string,
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
      if (info.warmedAffinities.has(affinityKey)) {
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

  // helper: choose server for affinity
  function chooseServerForAffinity(
    affinityType: AffinityType,
    affinityValue: string,
    options?: { exclude?: Iterable<string> },
  ): string | null {
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    cleanupAssignments();
    let exclude = new Set(options?.exclude ? [...options.exclude] : []);
    let assigned = (registry.affinities.get(affinityKey) || []).filter(
      (url) => !exclude.has(url),
    );
    // If we have room to add another server for this affinity, try to expand the
    // assignment set before choosing among existing ones.
    if (assigned.length < multiplex) {
      let candidate = leastRecentlyUsedServerWithCapacity(affinityKey, {
        exclude: new Set([...assigned, ...exclude]),
      });
      if (candidate) {
        assigned.push(candidate);
        if (assigned.length > multiplex) {
          assigned.splice(0, assigned.length - multiplex);
        }
        registry.affinities.set(affinityKey, assigned);
        let info = registry.servers.get(candidate);
        if (info) {
          info.activeAffinities.add(affinityKey);
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
          info.warmedAffinities.has(affinityKey)
        );
      });
      let next = warmedPreferred ?? warmed;
      if (next) {
        assigned = assigned.filter((url) => url !== next);
        assigned.push(next);
        if (assigned.length > multiplex) {
          assigned.splice(0, assigned.length - multiplex);
        }
        registry.affinities.set(affinityKey, assigned);
        let info = registry.servers.get(next);
        if (info) {
          info.lastAssignedAt = now();
          info.activeAffinities.add(affinityKey);
        }
        return next;
      }
    }
    // pick server with available capacity, prefer warmed
    let candidate = leastRecentlyUsedServerWithCapacity(affinityKey, {
      exclude,
    });
    if (candidate) {
      let list = registry.affinities.get(affinityKey) || [];
      if (!list.includes(candidate)) list.push(candidate);
      if (list.length > multiplex) list = list.slice(-multiplex);
      registry.affinities.set(affinityKey, list);
      let info = registry.servers.get(candidate);
      if (info) {
        info.activeAffinities.add(affinityKey);
        info.lastAssignedAt = now();
      }
      return candidate;
    }
    // pressure mode: pick server owning globally LRU affinity (may evict to free capacity)
    let lruAffinity: string | undefined;
    let lruTime = Infinity;
    for (let [r, t] of registry.lastAccessByAffinity) {
      if (t < lruTime) {
        lruTime = t;
        lruAffinity = r;
      }
    }
    if (lruAffinity) {
      let arr = [...(registry.affinities.get(lruAffinity) || [])];
      while (arr.length > 0) {
        let url = arr.shift()!;
        let info = registry.servers.get(url);
        if (info && isServerUsable(info)) {
          // evict lru affinity from this server to free capacity
          info.activeAffinities.delete(lruAffinity);
          let existing = registry.affinities.get(lruAffinity) || [];
          let idx = existing.indexOf(url);
          if (idx > -1) existing.splice(idx, 1);
          if (existing.length === 0) {
            registry.affinities.delete(lruAffinity);
          } else {
            registry.affinities.set(lruAffinity, existing);
          }
          registry.lastAccessByAffinity.delete(lruAffinity);

          let list = registry.affinities.get(affinityKey) || [];
          if (!list.includes(url)) list.push(url);
          if (list.length > multiplex) list = list.slice(-multiplex);
          registry.affinities.set(affinityKey, list);
          info.activeAffinities.add(affinityKey);
          info.lastAssignedAt = now();
          log.warn(
            'Pressure-mode: evicted affinity %s from %s to assign %s',
            lruAffinity,
            url,
            affinityKey,
          );
          return url;
        }
        registry.servers.get(url)?.activeAffinities.delete(lruAffinity);
      }
      if (arr.length === 0) {
        registry.affinities.delete(lruAffinity);
      }
    }
    // fallback: any usable server (evict if needed)
    for (let [url, info] of registry.servers) {
      if (!isServerUsable(info)) continue;
      if (!hasCapacity(info) && info.activeAffinities.size > 0) {
        let evictAffinity: string | undefined;
        let oldest = Infinity;
        for (let r of info.activeAffinities) {
          let t = registry.lastAccessByAffinity.get(r) ?? 0;
          if (t < oldest) {
            oldest = t;
            evictAffinity = r;
          }
        }
        if (!evictAffinity) evictAffinity = [...info.activeAffinities][0];
        if (evictAffinity) {
          info.activeAffinities.delete(evictAffinity);
          let existing = registry.affinities.get(evictAffinity) || [];
          let idx = existing.indexOf(url);
          if (idx > -1) existing.splice(idx, 1);
          if (existing.length === 0) {
            registry.affinities.delete(evictAffinity);
          } else {
            registry.affinities.set(evictAffinity, existing);
          }
          registry.lastAccessByAffinity.delete(evictAffinity);
          log.warn(
            'Fallback eviction: evicted affinity %s from %s to assign %s',
            evictAffinity,
            url,
            affinityKey,
          );
        }
      }
      let list = registry.affinities.get(affinityKey) || [];
      if (!list.includes(url)) list.push(url);
      if (list.length > multiplex) list = list.slice(-multiplex);
      registry.affinities.set(affinityKey, list);
      info.activeAffinities.add(affinityKey);
      info.lastAssignedAt = now();
      return url;
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
    expired.forEach((url) => {
      pruneServer(url);
      log.debug('Pruned prerender server due to missed heartbeat: %s', url);
    });
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
      if (options?.isDraining?.()) {
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
        ctxt.body = {
          errors: [
            {
              status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
              message: 'Prerender manager draining',
            },
          ],
        };
        return;
      }
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
      let affinityType: AffinityType | undefined =
        attrs.affinityType === 'realm' || attrs.affinityType === 'user'
          ? attrs.affinityType
          : undefined;
      let affinityValue: string | undefined =
        typeof attrs.affinityValue === 'string' &&
        attrs.affinityValue.length > 0
          ? attrs.affinityValue
          : undefined;
      if (!affinityType) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message: 'Missing required attribute: affinityType',
            },
          ],
        };
        return;
      }
      if (!affinityValue) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message: 'Missing required attribute: affinityValue',
            },
          ],
        };
        return;
      }
      let affinityKey = toAffinityKey({ affinityType, affinityValue });
      if (registry.servers.size === 0 && discoveryWaitMs > 0) {
        let start = now();
        while (registry.servers.size === 0 && now() - start < discoveryWaitMs) {
          await delay(discoveryPollMs);
        }
      }
      if (registry.servers.size === 0) {
        log.debug('503 No servers: registry empty');
        ctxt.status = 503;
        ctxt.body = { errors: [{ status: 503, message: 'No servers' }] };
        return;
      }
      let attempts = new Set<string>();
      while (attempts.size < registry.servers.size) {
        let target = chooseServerForAffinity(affinityType, affinityValue, {
          exclude: attempts,
        });
        if (!target) {
          log.debug(
            '503 No servers: no usable target for affinity=%s (registered=%d): %s',
            affinityKey,
            registry.servers.size,
            normalizeServersForLog(),
          );
          ctxt.status = 503;
          ctxt.body = { errors: [{ status: 503, message: 'No servers' }] };
          return;
        }
        attempts.add(target);

        const targetURL = `${normalizeURL(target)}/${pathSuffix}`;
        let logTarget = attrs.url ?? attrs.command ?? '<unknown>';
        log.info(
          `proxying ${label} prerender request for ${logTarget} to ${targetURL}`,
        );
        let abortedDueToDrain = false;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), proxyTimeoutMs).unref?.();
        const drainPoll =
          options?.isDraining && proxyTimeoutMs > 50
            ? setInterval(
                () => {
                  if (options.isDraining!()) {
                    ac.abort();
                  }
                },
                Math.min(100, proxyTimeoutMs / 2),
              )
            : null;
        (drainPoll as any)?.unref?.();
        const res = await fetch(targetURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.api+json',
            Accept: ctxt.get('Accept') || 'application/vnd.api+json',
          },
          body: raw,
          signal: ac.signal,
        }).catch((e) => {
          if (e?.name === 'AbortError' && options?.isDraining?.()) {
            abortedDueToDrain = true;
          } else {
            log.warn('Upstream error:', e);
          }
          return null as any;
        });
        clearTimeout(timer as any);
        if (drainPoll) clearInterval(drainPoll as any);

        let draining =
          abortedDueToDrain ||
          res?.status === PRERENDER_SERVER_DRAINING_STATUS_CODE ||
          res?.headers.get(PRERENDER_SERVER_STATUS_HEADER) ===
            PRERENDER_SERVER_STATUS_DRAINING;
        let upstreamFailure = !res && !draining;
        let serverError =
          res && res.status >= 500 && res.status < 600 && !draining;
        if (!res || draining || serverError) {
          if (upstreamFailure || serverError) {
            pruneServer(target);
            attempts.delete(target);
            log.warn(
              'Pruned prerender server %s due to %s; registry now has %d servers',
              target,
              upstreamFailure ? 'upstream failure' : `status ${res?.status}`,
              registry.servers.size,
            );
          }
          if (draining) {
            markDraining(target);
          }
          // try next server if available
          if (attempts.size < registry.servers.size) {
            continue;
          }
          if (draining) {
            ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
            ctxt.set(
              PRERENDER_SERVER_STATUS_HEADER,
              PRERENDER_SERVER_STATUS_DRAINING,
            );
            ctxt.body = {
              errors: [
                {
                  status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
                  message: 'All prerender servers draining',
                },
              ],
            };
          } else if (upstreamFailure || serverError) {
            ctxt.status = 503;
            ctxt.body = { errors: [{ status: 503, message: 'No servers' }] };
          } else {
            ctxt.status = 502;
            ctxt.body = {
              errors: [{ status: 502, message: 'Upstream error' }],
            };
          }
          return;
        }

        // on success, mark last access and active affinity
        if (res.ok) {
          registry.lastAccessByAffinity.set(affinityKey, now());
          // ensure active affinity marks include this assignment
          let assigned = registry.affinities.get(affinityKey) || [];
          for (let url of assigned) {
            if (url === target) {
              registry.servers.get(url)?.activeAffinities.add(affinityKey);
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
        ctxt.set('x-boxel-prerender-affinity', affinityKey);
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
  router.post('/prerender-file-extract', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-file-extract', 'file-extract'),
  );
  router.post('/prerender-file-render', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-file-render', 'file-render'),
  );
  router.post('/run-command', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'run-command', 'command'),
  );

  let verboseManagerLogs =
    process.env.PRERENDER_MANAGER_VERBOSE_LOGS === 'true';
  app
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      if (verboseManagerLogs) {
        log.info(
          `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}`,
        );
      }
      ctxt.res.on('finish', () => {
        if (verboseManagerLogs) {
          log.info(
            `--> ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}: ${ctxt.status}`,
          );
          log.debug(JSON.stringify(ctxt.req.headers));
        }
      });
      return next();
    })
    .use(router.routes());
  return { app, registry, sweepServers, chooseServerForAffinity };
}
