import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, param, query } from '@cardstack/runtime-common';
import { fullRequestURL } from '../middleware/index.ts';

// Host URLs: the addresses a realm is served at besides its own URL
// (ADR 033). A host URL is a host and a path prefix stored in
// `realm_host_urls` against the realm's registry id. A request whose host and
// path fall under one is routed to that realm before any other lookup
// (ADR 033 §1.2).

const log = logger('realm-server:host-urls');

// The channel a change to a host's host URLs is announced on. The payload is
// the host. Every process drops that host from its cache when it hears it
// (ADR 033 §1.3).
export const HOST_URLS_CHANNEL = 'realm_host_urls';

// How long a host's entries are trusted without a notification. A
// notification can be lost while the listening connection is down, so this
// bounds how long a process can serve from a stale entry.
const DEFAULT_TTL_MS = 30_000;

// What a request on a host URL resolved to. `hostURL` is the host URL itself,
// with the request's protocol, ending in `/`.
export interface HostURLMatch {
  hostURL: string;
  realmURL: string;
  isCanonical: boolean;
}

interface HostEntry {
  pathPrefix: string;
  realmURL: string;
  isCanonical: boolean;
}

interface Subscribable {
  subscribe(
    channel: string,
    handler: (payload: string) => void,
    opts?: { onReconnect?: () => void },
  ): Promise<{ unsubscribe(): Promise<void> }>;
}

function canSubscribe(
  dbAdapter: DBAdapter,
): dbAdapter is DBAdapter & Subscribable {
  return typeof (dbAdapter as Partial<Subscribable>).subscribe === 'function';
}

// The key a host is cached and stored under: its lowercased host, with the
// port when it isn't the default one. `URL#host` already drops a default port.
export function hostKey(url: URL): string {
  return url.host.toLowerCase();
}

export class HostURLResolver {
  #dbAdapter: DBAdapter;
  #ttlMs: number;
  #now: () => number;
  #entries = new Map<string, { entries: HostEntry[]; expiresAt: number }>();
  #subscribing: Promise<void> | undefined;

  constructor(
    dbAdapter: DBAdapter,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.#dbAdapter = dbAdapter;
    this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = opts.now ?? Date.now;
  }

  // The host URL the request falls under, the one with the longest path
  // prefix when more than one does. Undefined when none does.
  async resolve(requestURL: URL): Promise<HostURLMatch | undefined> {
    this.#ensureSubscribed();
    let host = hostKey(requestURL);
    let entries = await this.#entriesFor(host);
    let path = requestURL.pathname;
    let entry = entries.find(
      ({ pathPrefix }) =>
        path.startsWith(pathPrefix) || `${path}/` === pathPrefix,
    );
    if (!entry) {
      return undefined;
    }
    return {
      hostURL: `${requestURL.protocol}//${host}${entry.pathPrefix}`,
      realmURL: entry.realmURL,
      isCanonical: entry.isCanonical,
    };
  }

  // Drops a host's cached entries in this process. A writer calls this, as
  // well as `notifyHostURLsChanged`, so its own change takes effect before
  // its response is sent (ADR 033 §1.3).
  forget(host: string): void {
    this.#entries.delete(host.toLowerCase());
  }

  async #entriesFor(host: string): Promise<HostEntry[]> {
    let cached = this.#entries.get(host);
    if (cached && cached.expiresAt > this.#now()) {
      return cached.entries;
    }
    let rows = (await query(this.#dbAdapter, [
      `SELECT h.path_prefix, h.is_canonical, r.url`,
      `FROM realm_host_urls h JOIN realm_registry r ON r.id = h.realm_id`,
      `WHERE h.host =`,
      param(host),
      `ORDER BY LENGTH(h.path_prefix) DESC`,
    ])) as { path_prefix: string; is_canonical: boolean; url: string }[];
    let entries = rows.map((row) => ({
      pathPrefix: row.path_prefix,
      realmURL: row.url,
      isCanonical: Boolean(row.is_canonical),
    }));
    this.#entries.set(host, {
      entries,
      expiresAt: this.#now() + this.#ttlMs,
    });
    return entries;
  }

  #ensureSubscribed(): void {
    if (this.#subscribing || !canSubscribe(this.#dbAdapter)) {
      return;
    }
    this.#subscribing = this.#dbAdapter
      .subscribe(HOST_URLS_CHANNEL, (host) => this.forget(host), {
        // Changes made while the connection was down notified no one.
        onReconnect: () => this.#entries.clear(),
      })
      .then(
        () => undefined,
        (err: unknown) => {
          log.warn(
            `could not listen on ${HOST_URLS_CHANNEL}; cached host URLs expire after ${this.#ttlMs}ms instead: ${String(err)}`,
          );
        },
      );
  }
}

// Tells every process that a host's host URLs changed. Best effort, like the
// registry's notifications: a lost one is covered by the cache's expiry.
export async function notifyHostURLsChanged(
  dbAdapter: DBAdapter,
  host: string,
): Promise<void> {
  try {
    await dbAdapter.notify(HOST_URLS_CHANNEL, host.toLowerCase());
  } catch (err: unknown) {
    log.warn(
      `failed to NOTIFY ${HOST_URLS_CHANNEL} ${host}: ${String(err)}; cached entries expire instead`,
    );
  }
}

// The request URL that a URL under a host URL stands for: the same path below
// the realm's URL. A path that names the host URL without its trailing slash
// names the realm's URL without one.
export function toRealmURL(requestURL: URL, match: HostURLMatch): URL {
  let hostURL = new URL(match.hostURL);
  let rest = requestURL.pathname.startsWith(hostURL.pathname)
    ? requestURL.pathname.slice(hostURL.pathname.length)
    : undefined;
  let realmURL = new URL(match.realmURL);
  let target = new URL(realmURL.href);
  target.pathname =
    rest === undefined
      ? realmURL.pathname.replace(/\/$/, '')
      : `${realmURL.pathname}${rest}`;
  target.search = requestURL.search;
  return target;
}

const HOST_URL_STATE = 'hostURL';

// The host URL a request came in on, when it came in on one.
export function requestHostURL(ctxt: Koa.Context): HostURLMatch | undefined {
  return (ctxt.state as Record<string, unknown>)[HOST_URL_STATE] as
    | HostURLMatch
    | undefined;
}

// Resolves a request on a host URL to its realm, ahead of every other route
// (ADR 033 §1.2), by making the request name the realm's URL. Everything
// downstream then finds the realm as it would for a request to its own URL.
// The host URL the request came in on is kept in `ctxt.state` for the code
// that translates responses back to it.
export function resolveHostURLs(
  resolver: HostURLResolver,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function resolveHostURL(ctxt, next) {
    let requestURL = fullRequestURL(ctxt);
    let match = await resolver.resolve(requestURL);
    if (match) {
      let target = toRealmURL(requestURL, match);
      (ctxt.state as Record<string, unknown>)[HOST_URL_STATE] = match;
      let headers = ctxt.req.headers as Record<string, string | undefined>;
      headers.host = target.host;
      delete headers[':authority'];
      ctxt.url = `${target.pathname}${target.search}`;
      ctxt.originalUrl = ctxt.url;
    }
    await next();
  };
}
