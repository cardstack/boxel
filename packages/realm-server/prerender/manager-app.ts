import Koa from 'koa';
import Router from '@koa/router';
import { logger } from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  fullRequestURL,
} from '../middleware/index.ts';
import { format } from 'date-fns';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_HOST_SHELL_HASH_HEADER,
  PRERENDER_REQUEST_ID_HEADER,
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
  resolvePrerenderServerProxyTimeoutMs,
  sanitizePrerenderJobId,
  sanitizePrerenderRequestId,
} from './prerender-constants.ts';
import { randomUUID } from 'crypto';
import { fromAffinityKey, toAffinityKey } from './affinity.ts';
import type { AffinityType } from '@cardstack/runtime-common';

// Per-affinity vacancy reported by a prerender server in its heartbeat.
// Consumed by warm-vacancy-first routing (CS-10758): `idle: true` means
// every tab for this affinity has an empty render queue; `tabCount`
// tracks the affinity's claimed tabs.
//
// `maxPendingPriority` is the priority of the highest-priority queued
// waiter for this affinity (across both the per-tab queues and the
// per-affinity file-admission semaphore). Two distinct absent cases,
// both safe to treat as "no priority bar to clear":
//   - undefined / omitted: the server reported no queued waiters, OR
//     the server is older and predates this field.
//   - `0`: there are queued waiters but the highest is priority 0
//     (background work) — an incoming priority-10 request will jump
//     ahead of them.
// Used by `scoreCandidate` to route an incoming high-priority request
// away from servers whose existing queued work would otherwise
// leapfrog it. When absent, routing falls back to the warmth-only
// vacancy logic.
export type AffinityVacancy = {
  idle: boolean;
  tabCount: number;
  maxPendingPriority?: number;
};

type ServerInfo = {
  url: string;
  capacity: number;
  activeAffinities: Set<string>;
  warmedAffinities: Set<string>;
  // Populated from the `affinityVacancy` field of the server's heartbeat.
  // Older servers that predate CS-10758 won't include this field; in that
  // case the Map stays empty and callers should fall back to inferring
  // warmth from `warmedAffinities` without vacancy information.
  affinityVacancy: Map<string, AffinityVacancy>;
  status: 'active' | 'draining';
  registeredAt: number;
  lastSeenAt: number;
  lastAssignedAt: number;
};

type Registry = {
  servers: Map<string, ServerInfo>; // key: serverUrl
  affinities: Map<string, string[]>; // affinityKey (<type>:<value>) -> assigned serverUrls (deque semantics)
  lastAccessByAffinity: Map<string, number>;
  // Latest host-shell token reported by a realm server (POST /host-shell).
  // Echoed to prerender servers on every heartbeat response so they recycle
  // when it changes (host redeployed). Undefined until first reported; reset
  // on manager restart, re-learned from the next realm-server boot report.
  hostShellHash?: string;
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
    options?: { exclude?: Iterable<string>; priority?: number },
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
    affinityVacancy,
  }: {
    url: string;
    capacity?: number;
    status?: 'active' | 'draining';
    warmedAffinities?: string[];
    affinityVacancy?: Record<string, AffinityVacancy>;
  }) {
    log.debug(
      `received heartbeat from ${url} status=${status} capacity=${capacity} warmedAffinities=${warmedAffinities ? warmedAffinities.join() : 'none'}`,
    );
    let existing = registry.servers.get(url);
    let changed = false;
    let vacancyMap = affinityVacancy
      ? new Map<string, AffinityVacancy>(Object.entries(affinityVacancy))
      : undefined;
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
      // Always refresh vacancy — treat a missing `affinityVacancy` attribute
      // on this heartbeat as an explicit empty snapshot so a rollback to a
      // legacy server (or a server that temporarily stops reporting) can't
      // leave stale data cached in the registry.
      existing.affinityVacancy = vacancyMap ?? new Map();
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
      affinityVacancy: vacancyMap ?? new Map(),
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
          affinityVacancy: Object.fromEntries(serverInfo.affinityVacancy),
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
      let affinityVacancy: Record<string, AffinityVacancy> | undefined;
      if (
        attrs.affinityVacancy &&
        typeof attrs.affinityVacancy === 'object' &&
        !Array.isArray(attrs.affinityVacancy)
      ) {
        // Null-prototype target + explicit forbidden-key guard so an
        // untrusted heartbeat payload can't pollute Object.prototype via
        // keys like `__proto__` / `constructor` / `prototype`.
        let parsed: Record<string, AffinityVacancy> = Object.create(null);
        for (let [key, value] of Object.entries(attrs.affinityVacancy)) {
          if (
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
          ) {
            continue;
          }
          if (
            value &&
            typeof value === 'object' &&
            typeof (value as AffinityVacancy).idle === 'boolean' &&
            Number.isInteger((value as AffinityVacancy).tabCount) &&
            (value as AffinityVacancy).tabCount >= 0
          ) {
            let entry: AffinityVacancy = {
              idle: (value as AffinityVacancy).idle,
              tabCount: (value as AffinityVacancy).tabCount,
            };
            // Surface the highest queued priority so routing can avoid
            // servers whose existing waiters would leapfrog the
            // incoming request. Tolerate older heartbeats by leaving
            // the field unset when missing or malformed —
            // scoreCandidate falls back to the warmth-only logic.
            // Only accept non-negative safe integers: priority buckets
            // are integer-keyed (`pendingByPriority()`), and floats /
            // negatives / Numbers larger than 2^53 would all produce
            // misleading routing comparisons.
            let mpp = (value as AffinityVacancy).maxPendingPriority;
            if (
              typeof mpp === 'number' &&
              Number.isSafeInteger(mpp) &&
              mpp >= 0
            ) {
              entry.maxPendingPriority = mpp;
            }
            parsed[key] = entry;
          }
        }
        affinityVacancy = parsed;
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

      recordHeartbeat({
        url,
        capacity,
        status,
        warmedAffinities,
        affinityVacancy,
      });
      // Echo the current host-shell token so the server can recycle its
      // browser when the host is redeployed (see PRERENDER_HOST_SHELL_HASH_HEADER).
      if (registry.hostShellHash) {
        ctxt.set(PRERENDER_HOST_SHELL_HASH_HEADER, registry.hostShellHash);
      }
      ctxt.status = 204;
      ctxt.set('X-Prerender-Server-Id', url);
    } catch (e) {
      log.error('Error in heartbeat:', e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Heartbeat error' }] };
    }
  });

  // The realm server reports the host-shell token it is currently serving
  // (POST at boot, after it has fetched the new shell). A change means the
  // host was redeployed; prerender servers pick it up on their next heartbeat
  // and recycle. Storing the latest token (rather than counting) keeps this
  // robust across the manager's own restart in the deploy train — the next
  // realm-server boot re-reports the current token.
  router.post('/host-shell', async (ctxt) => {
    try {
      let req = await fetchRequestFromContext(ctxt);
      let raw = await req.text();
      let requestBody: any = {};
      if (raw) {
        try {
          requestBody = JSON.parse(raw);
        } catch (e) {
          log.debug('Invalid JSON body on /host-shell; treating as empty:', e);
        }
      }
      let hash = requestBody?.data?.attributes?.hash;
      if (typeof hash !== 'string' || hash.trim().length === 0) {
        ctxt.status = 400;
        ctxt.body = { errors: [{ status: 400, message: 'hash is required' }] };
        return;
      }
      // Normalize and bound the token before storing it: it is echoed into a
      // response header on every heartbeat, so a stray-whitespace variant would
      // spuriously read as a change, and an oversized value would bloat every
      // heartbeat response. The real token is a short hex digest, so anything
      // longer is malformed — reject rather than silently truncate (a truncated
      // token would never match and would recycle forever).
      hash = hash.trim();
      if (hash.length > 64) {
        ctxt.status = 400;
        ctxt.body = { errors: [{ status: 400, message: 'hash too long' }] };
        return;
      }
      if (registry.hostShellHash !== hash) {
        log.info(
          `host shell token changed (${registry.hostShellHash ?? 'none'} -> ${hash}); prerender servers will recycle on next heartbeat`,
        );
        registry.hostShellHash = hash;
      }
      ctxt.status = 204;
    } catch (e) {
      log.error('Error in /host-shell:', e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'host-shell error' }] };
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

  // Score a usable, non-excluded server for the requested affinity. Lower
  // score wins.
  //
  // CS-10758 priority chart — the primary scoring dimension is the
  // warm-vacancy bucket, evaluated per requested affinity:
  //
  //   ┌────────┬────────────────┬──────────────────────────────────────────┐
  //   │ bucket │ state          │ meaning                                  │
  //   ├────────┼────────────────┼──────────────────────────────────────────┤
  //   │   0    │ warm + idle    │ ideal — a warm tab ready to serve now    │
  //   │   1    │ cold + idle    │ pay a cold load once; subsequent reuse   │
  //   │   2    │ warm + busy    │ queue behind existing tab — last resort  │
  //   │   —    │ cold + busy    │ dropped; caller falls through to         │
  //   │        │                │ pressure-mode eviction below             │
  //   └────────┴────────────────┴──────────────────────────────────────────┘
  //
  // A lower bucket always wins over a higher one, regardless of other
  // signals: warm+idle beats cold+idle, cold+idle beats warm+busy. So a
  // warm+idle server *elsewhere* wins over a warm+busy server that's
  // currently assigned — stickiness does not override bucket priority.
  //
  // Ties *within* a bucket break by, in order:
  //   1. assignedPref — server already in the affinity's assigned list
  //      wins (soft stickiness; keeps continuity when all else is equal)
  //   2. load         — fewer active affinities wins (spread load)
  //   3. age          — oldest lastAssignedAt wins (coarse round-robin
  //                     across equally-loaded servers)
  //
  // Warmth is read from the per-server `affinityVacancy` map that the
  // prerender heartbeat populates (added in CS-10758 step 1). Servers that
  // predate that change send no `affinityVacancy`, so their map stays empty
  // and every affinity on them registers as cold — safe during a rolling
  // deploy: worst case the first visit to a legacy server re-warms its tab.
  type Candidate = {
    url: string;
    info: ServerInfo;
    bucket: 0 | 1 | 2;
    assignedPref: 0 | 1;
    // 0 when the incoming priority strictly beats this server's queued
    // waiters for the affinity (i.e. our request would jump to the
    // head of the queue), 1 otherwise. Tie-break ahead of `load` and
    // `age`, behind `bucket` and `assignedPref`. Always 0 when the
    // server has no pending entries, so the priority signal never
    // demotes a strictly-idle server.
    priorityPref: 0 | 1;
    load: number;
    age: number;
  };

  function scoreCandidate(
    url: string,
    info: ServerInfo,
    affinityKey: string,
    assignedSet: Set<string>,
    incomingPriority: number,
  ): Candidate | undefined {
    let vacancy = info.affinityVacancy.get(affinityKey);
    let warm = !!vacancy && vacancy.tabCount >= 1;
    let idle = vacancy?.idle === true;
    let bucket: 0 | 1 | 2;
    // Order matters: a warm-but-busy tab for the requested affinity must
    // classify as bucket 2 even when the server still has overall capacity
    // for other affinities. Checking `hasCapacity` first would collapse
    // warm+busy-with-capacity into bucket 1 alongside cold+idle and break
    // the cold+idle > warm+busy invariant that keeps us from queueing behind
    // a busy warm tab when an idle cold one is available elsewhere.
    if (warm && idle) {
      bucket = 0;
    } else if (warm && !idle) {
      bucket = 2;
    } else if (hasCapacity(info)) {
      bucket = 1;
    } else {
      return undefined; // cold + busy
    }
    // Priority preference: prefer servers where our request would not
    // sit behind higher- or equal-priority queued work. `mpp` undefined
    // means no waiters → preferred. Strictly greater incoming priority
    // beats whatever's queued (we'd land at the head). Otherwise we'd
    // queue behind existing work, so deprioritise. Older servers that
    // don't report `maxPendingPriority` map to undefined → treated as
    // preferred, matching the warmth-only routing fallback.
    let mpp = vacancy?.maxPendingPriority;
    let priorityPref: 0 | 1 =
      mpp === undefined || incomingPriority > mpp ? 0 : 1;
    return {
      url,
      info,
      bucket,
      assignedPref: assignedSet.has(url) ? 0 : 1,
      priorityPref,
      load: info.activeAffinities.size,
      age: info.lastAssignedAt,
    };
  }

  function pickByVacancy(
    affinityKey: string,
    excludeSet: Set<string>,
    assigned: readonly string[],
    incomingPriority: number,
  ): string | undefined {
    let assignedSet = new Set(assigned);
    let best: Candidate | undefined;
    for (let [url, info] of registry.servers) {
      if (excludeSet.has(url)) continue;
      if (!isServerUsable(info)) continue;
      let candidate = scoreCandidate(
        url,
        info,
        affinityKey,
        assignedSet,
        incomingPriority,
      );
      if (!candidate) continue;
      if (!best || isBetter(candidate, best)) {
        best = candidate;
      }
    }
    return best?.url;
  }

  function isBetter(a: Candidate, b: Candidate): boolean {
    if (a.bucket !== b.bucket) return a.bucket < b.bucket;
    if (a.assignedPref !== b.assignedPref)
      return a.assignedPref < b.assignedPref;
    // Priority preference is a soft tie-break ranked AFTER the bucket
    // and stickiness comparisons above. The invariant order (warm+idle
    // > cold+idle > warm+busy, defined in scoreCandidate) is preserved
    // because `bucket` is checked first — a `cold+idle` candidate
    // always beats a `warm+busy` one regardless of `priorityPref`,
    // even when the warm+busy server has a queue full of low-priority
    // work the incoming request would jump ahead of. Where priority
    // preference does kick in: among multiple candidates in the SAME
    // bucket (e.g. several warm+busy servers all serving the affinity),
    // it routes a priority-10 request to the one whose queued work is
    // all lower priority, so the incoming request lands at the head of
    // that server's queue instead of behind same-priority work
    // somewhere else.
    if (a.priorityPref !== b.priorityPref)
      return a.priorityPref < b.priorityPref;
    if (a.load !== b.load) return a.load < b.load;
    return a.age < b.age;
  }

  // helper: choose server for affinity
  function chooseServerForAffinity(
    affinityType: AffinityType,
    affinityValue: string,
    options?: { exclude?: Iterable<string>; priority?: number },
  ): string | null {
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    cleanupAssignments();
    let exclude = new Set(options?.exclude ? [...options.exclude] : []);
    let incomingPriority =
      typeof options?.priority === 'number' && Number.isFinite(options.priority)
        ? options.priority
        : 0;
    let assigned = (registry.affinities.get(affinityKey) || []).filter(
      (url) => !exclude.has(url),
    );
    // Full-fleet scan by vacancy priority. Stickiness to already-assigned
    // servers is a tie-breaker within a priority bucket, not a hard gate —
    // a warm+idle server elsewhere still beats a warm+busy assigned server,
    // even at multiplex=1. The multiplex cap is enforced by trimming the
    // assigned list after the pick, which may quietly shift assignment to
    // the better-scoring server.
    let candidate = pickByVacancy(
      affinityKey,
      exclude,
      assigned,
      incomingPriority,
    );
    if (candidate) {
      let list = [...assigned];
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
    // CS-10872: honor caller-supplied correlation ID; mint one if
    // absent (direct curl, test harnesses). Echo on every subsequent
    // log line so a single grep surfaces the full proxy story.
    // CS-10872: sanitize the inbound id so it can't carry
    // arbitrarily long / unusual payloads into log lines or
    // response headers. Fall back to a fresh UUID when invalid.
    let requestId =
      sanitizePrerenderRequestId(ctxt.get(PRERENDER_REQUEST_ID_HEADER)) ??
      randomUUID();
    ctxt.set(PRERENDER_REQUEST_ID_HEADER, requestId);
    // Optional indexing-job correlator threaded from the worker. When
    // present, gets stamped onto every proxying/proxied log line as
    // `[job: J.R]` and forwarded upstream so the prerender-server can
    // do the same — letting `|= "[job: J.R]"` filters return all four
    // services' lines for an indexing job.
    let jobId = sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER));
    let jobTag = jobId ? ` [job: ${jobId}]` : '';
    let proxyStart = now();
    // Propagate client-disconnect into the upstream fetch so the
    // prerender server can cancel whatever it was doing and free
    // the tab for another request. Without this, a worker that
    // aborts at 150 s leaves the prerender server rendering for
    // another ~15-20 s and discards the result — ~2x render budget
    // per timeout under saturation. `currentAc` is the attempt's
    // live AbortController, set at the top of each retry iteration
    // so the close listener aborts the right one.
    let clientAborted = false;
    let currentAc: AbortController | undefined;
    let clientAbortAffinity: string | undefined;
    let clientAbortTarget: string | undefined;
    const onClientClose = () => {
      // ServerResponse 'close' fires after the response is flushed on
      // normal completion (writableEnded=true) OR when the connection
      // is torn down prematurely (writableEnded=false). We want the
      // latter. Note: we listen on `ctxt.res`, NOT `ctxt.req` — Node
      // 17+ auto-destroys IncomingMessage after the body is consumed,
      // firing `req.close` long before the response is sent, which
      // would false-trigger this handler on every normal request.
      if (ctxt.res.writableEnded) return;
      if (clientAborted) return;
      clientAborted = true;
      log.info(
        `client-aborted after ${now() - proxyStart}ms requestId=${requestId} ` +
          `affinity=${clientAbortAffinity ?? '<unknown>'} ` +
          `target=${clientAbortTarget ?? '<unassigned>'}`,
      );
      currentAc?.abort();
    };
    ctxt.res.on('close', onClientClose);
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
      // Priority comes from the worker job (stamped onto the request
      // attributes by the wire-format threading). Pass through to
      // scoreCandidate so a high-priority request prefers servers
      // without higher-priority pending work. Defaults to the lowest
      // tier (0) when absent for back-compat with older callers /
      // direct curl. Only accept non-negative safe integers — priority
      // buckets are integer-keyed, and floats / negatives / values
      // beyond 2^53 would produce misleading routing comparisons.
      let incomingPriority =
        typeof attrs.priority === 'number' &&
        Number.isSafeInteger(attrs.priority) &&
        attrs.priority >= 0
          ? attrs.priority
          : 0;
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
      clientAbortAffinity = affinityKey;
      if (registry.servers.size === 0 && discoveryWaitMs > 0) {
        let start = now();
        while (registry.servers.size === 0 && now() - start < discoveryWaitMs) {
          if (clientAborted) return;
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
        // Short-circuit the retry loop on client abort — the
        // caller gave up, so don't waste another server's render
        // budget on a retry no one is waiting for.
        if (clientAborted) return;
        let target = chooseServerForAffinity(affinityType, affinityValue, {
          exclude: attempts,
          priority: incomingPriority,
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
        clientAbortTarget = target;
        let logTarget = attrs.url ?? attrs.command ?? '<unknown>';
        let queueMs = now() - proxyStart;
        log.info(
          `proxying ${label} prerender request for ${logTarget} to ${targetURL} requestId=${requestId} affinity=${affinityKey} attempt=${attempts.size} queueMs=${queueMs}${jobTag}`,
        );
        let abortedDueToDrain = false;
        const ac = new AbortController();
        // Expose this attempt's controller so the ctxt.res 'close'
        // listener can abort the current upstream fetch
        // immediately when the client disconnects. If the client
        // already disconnected before we got here, abort pre-flight
        // so the upstream server can drop the request as cheaply
        // as possible.
        currentAc = ac;
        if (clientAborted) {
          ac.abort();
          return;
        }
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
            [PRERENDER_REQUEST_ID_HEADER]: requestId,
            ...(jobId ? { [PRERENDER_JOB_ID_HEADER]: jobId } : {}),
          },
          body: raw,
          signal: ac.signal,
        }).catch((e) => {
          if (e?.name === 'AbortError' && clientAborted) {
            // Client gave up — not our fault, not the upstream's
            // fault. Don't prune, don't mark drain. The outer
            // `if (clientAborted) return;` below will short-circuit
            // and the client's HTTP connection is already dead so
            // nothing we write here matters.
            return null as any;
          }
          if (e?.name === 'AbortError' && options?.isDraining?.()) {
            abortedDueToDrain = true;
          } else {
            log.warn(
              `Upstream error requestId=${requestId} target=${targetURL}:`,
              e,
            );
          }
          return null as any;
        });
        clearTimeout(timer as any);
        if (drainPoll) clearInterval(drainPoll as any);
        // If the client aborted at any point during this attempt,
        // stop here — we've already told the upstream to bail via
        // `currentAc.abort()` and the response socket is already
        // closed.
        if (clientAborted) return;

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
        // Re-echo after res.headers iteration so the manager's ID
        // wins over any header passthrough from the prerender-server.
        ctxt.set(PRERENDER_REQUEST_ID_HEADER, requestId);
        const buf = Buffer.from(await res.arrayBuffer());
        ctxt.body = buf;
        let proxyMs = now() - proxyStart;
        log.info(
          `proxied ${label} requestId=${requestId} affinity=${affinityKey} target=${target} status=${res.status} proxyMs=${proxyMs}${jobTag}`,
        );
        return;
      }
    } catch (e) {
      log.error(`Error in /${pathSuffix} proxy requestId=${requestId}:`, e);
      ctxt.status = 500;
      ctxt.body = { errors: [{ status: 500, message: 'Proxy error' }] };
    } finally {
      // Always detach the close listener; otherwise a later route
      // on this same socket (keep-alive) would dispatch stale
      // aborts.
      ctxt.res.off('close', onClientClose);
    }
  }

  // proxy prerender endpoints
  router.post('/prerender-module', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-module', 'module'),
  );
  router.post('/prerender-visit', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-visit', 'visit'),
  );
  router.post('/run-command', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'run-command', 'command'),
  );
  router.post('/prerender-screenshot', (ctxt) =>
    proxyPrerenderRequest(ctxt, 'prerender-screenshot', 'screenshot'),
  );

  // Broadcast a release-batch to every server currently assigned to the
  // requested affinity (CS-10758 step 3). Any assigned server could hold
  // local ownership from an earlier visit; the indexer doesn't track
  // which server owned what, so fanout is the robust choice. A server
  // that doesn't own the batch no-ops the request. Non-assigned servers
  // are skipped — they can't possibly have ownership for this affinity.
  router.post('/release-batch', async (ctxt) => {
    try {
      let request = await fetchRequestFromContext(ctxt);
      let raw = await request.text();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: 'Invalid JSON body' }],
        };
        return;
      }
      let attrs = body?.data?.attributes ?? {};
      let batchId = attrs.batchId;
      let affinityType = attrs.affinityType;
      let affinityValue = attrs.affinityValue;
      if (
        typeof batchId !== 'string' ||
        batchId.trim().length === 0 ||
        (affinityType !== 'realm' && affinityType !== 'user') ||
        typeof affinityValue !== 'string' ||
        affinityValue.trim().length === 0
      ) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message:
                'Missing or invalid attributes: batchId, affinityType, affinityValue',
            },
          ],
        };
        return;
      }
      let affinityKey = toAffinityKey({
        affinityType: affinityType as AffinityType,
        affinityValue,
      });
      let targets = [...(registry.affinities.get(affinityKey) ?? [])];
      log.info(
        `broadcasting release-batch for ${affinityKey} (batch ${batchId}) to ${targets.length} assigned server(s)`,
      );
      // Fire the releases in parallel; don't fail the response on any
      // single server's error — the ownership either clears or it
      // doesn't, either outcome is safe.
      await Promise.all(
        targets.map(async (target) => {
          let targetURL = `${normalizeURL(target)}/release-batch`;
          // Each target gets its own abort — a single stuck upstream
          // must not block the broadcast from resolving. The indexer's
          // IndexRunner.finally awaits this broadcast, so an unbounded
          // fetch here would leave indexing jobs hung after useful work
          // is done. Use the same timeout family the proxy route uses
          // (resolvePrerenderServerProxyTimeoutMs, default 150s) so the
          // upper bound on a release-batch matches the upper bound on a
          // regular prerender request.
          let ac = new AbortController();
          let timer = setTimeout(() => ac.abort(), proxyTimeoutMs);
          (timer as any).unref?.();
          try {
            let res = await fetch(targetURL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/vnd.api+json',
                Accept: 'application/vnd.api+json',
              },
              body: raw,
              signal: ac.signal,
            });
            if (!res.ok) {
              log.warn(
                `release-batch on ${target} for ${affinityKey} returned ${res.status}`,
              );
            }
          } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') {
              log.warn(
                `release-batch on ${target} for ${affinityKey} timed out after ${proxyTimeoutMs}ms`,
              );
            } else {
              log.warn(
                `release-batch on ${target} for ${affinityKey} network error:`,
                err,
              );
            }
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      ctxt.status = 204;
    } catch (err: any) {
      log.error('Unhandled error in /release-batch broadcast:', err);
      ctxt.status = 500;
      ctxt.body = {
        errors: [{ status: 500, message: err?.message ?? 'Unknown error' }],
      };
    }
  });

  let verboseManagerLogs =
    process.env.PRERENDER_MANAGER_VERBOSE_LOGS === 'true';
  app
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      let jobId = sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER));
      let jobTag = jobId ? ` [job: ${jobId}]` : '';
      if (verboseManagerLogs) {
        log.info(
          `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}${jobTag}`,
        );
      }
      ctxt.res.on('finish', () => {
        if (verboseManagerLogs) {
          log.info(
            `--> ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}: ${ctxt.status}${jobTag}`,
          );
          log.debug(JSON.stringify(ctxt.req.headers));
        }
      });
      return next();
    })
    .use(router.routes());
  return { app, registry, sweepServers, chooseServerForAffinity };
}
