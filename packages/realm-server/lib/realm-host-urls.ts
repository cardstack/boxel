import type Koa from 'koa';
import type { DBAdapter, Querier } from '@cardstack/runtime-common';
import { logger, param, query } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { fullRequestURL } from '../middleware/index.ts';
import { domainHostOf } from './domain-host.ts';

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

// How many hosts a process caches. A request can name any host, so without a
// bound a stream of unknown hosts would grow the cache without limit. The
// least recently used host is dropped first.
const DEFAULT_MAX_HOSTS = 10_000;

// What a request on a host URL resolved to. `hostURL` is the host URL itself,
// with the request's protocol, ending in `/`. `canonicalHostURL` is the
// realm's canonical host URL in the same form, undefined when the realm has
// none. `renderedAgainstURLs` are the URLs other than the realm's that the
// realm's stored HTML was rendered against (ADR 033 §1.8), in order.
export interface HostURLMatch {
  hostURL: string;
  realmURL: string;
  isCanonical: boolean;
  canonicalHostURL?: string;
  renderedAgainstURLs?: readonly string[];
}

// For each realm whose stored HTML was rendered against a URL other than its
// own, those URLs, in order. A realm whose HTML names only its own URL has no
// entry.
export type RenderedAgainstURLs = ReadonlyMap<string, readonly string[]>;

interface HostEntry {
  pathPrefix: string;
  realmURL: string;
  isCanonical: boolean;
  // The realm's canonical host URL, as a host and a path prefix.
  canonical: string | undefined;
}

// The part of PgAdapter this module uses, taken from its type so the two can't
// drift apart. The handler gets the `pg` notification, whose `payload` is the
// string `notify` sent.
type Subscribable = Pick<PgAdapter, 'subscribe'>;

function canSubscribe(
  dbAdapter: DBAdapter,
): dbAdapter is DBAdapter & Subscribable {
  return typeof (dbAdapter as Partial<Subscribable>).subscribe === 'function';
}

// The key a host is cached and stored under: its lowercased host, without a
// trailing dot, with the port when it isn't the default one (ADR 033 §1.1).
export function hostKey(url: URL): string {
  return domainHostOf(url).host;
}

export class HostURLResolver {
  #dbAdapter: DBAdapter;
  #ttlMs: number;
  #maxHosts: number;
  #mayHaveHostURLs: ((host: string) => boolean) | undefined;
  #now: () => number;
  // In least-recently-used order: a `Map` iterates in insertion order, and a
  // host is re-inserted each time it is used.
  #entries = new Map<string, { entries: HostEntry[]; expiresAt: number }>();
  // Counts every forget. A load caches its result only when nothing was
  // forgotten while its query ran, since the change that was announced may
  // have committed after the query read the table.
  #invalidations = 0;
  #subscribing: Promise<void> | undefined;
  // The URLs each realm's stored HTML was rendered against, for every realm
  // at once: one read serves every request until it expires or a change is
  // announced.
  #renderedAgainst:
    | { urls: RenderedAgainstURLs; expiresAt: number }
    | undefined;
  #renderedAgainstLoad: Promise<RenderedAgainstURLs> | undefined;

  constructor(
    dbAdapter: DBAdapter,
    opts: {
      ttlMs?: number;
      maxHosts?: number;
      // Hosts this returns false for are never looked up, so a request naming
      // an arbitrary host costs no query. See `hostURLDomainFilter`
      // (`realm-host-urls-domains.ts`).
      mayHaveHostURLs?: (host: string) => boolean;
      now?: () => number;
    } = {},
  ) {
    this.#dbAdapter = dbAdapter;
    this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxHosts = opts.maxHosts ?? DEFAULT_MAX_HOSTS;
    this.#mayHaveHostURLs = opts.mayHaveHostURLs;
    this.#now = opts.now ?? Date.now;
  }

  // The host URL the request falls under, the one with the longest path
  // prefix when more than one does. Undefined when none does.
  async resolve(requestURL: URL): Promise<HostURLMatch | undefined> {
    let host = hostKey(requestURL);
    if (this.#mayHaveHostURLs && !this.#mayHaveHostURLs(host)) {
      return undefined;
    }
    this.#ensureSubscribed();
    let entries = await this.#entriesFor(host);
    let path = requestURL.pathname;
    let entry = entries.find(
      ({ pathPrefix }) =>
        path.startsWith(pathPrefix) || `${path}/` === pathPrefix,
    );
    if (!entry) {
      return undefined;
    }
    let renderedAgainstURLs = (await this.renderedAgainstURLs()).get(
      entry.realmURL,
    );
    return {
      hostURL: `${requestURL.protocol}//${host}${entry.pathPrefix}`,
      realmURL: entry.realmURL,
      isCanonical: entry.isCanonical,
      canonicalHostURL: entry.canonical
        ? `${requestURL.protocol}//${entry.canonical}`
        : undefined,
      ...(renderedAgainstURLs ? { renderedAgainstURLs } : {}),
    };
  }

  // The URLs other than its own that each realm's stored HTML was rendered
  // against, as `prerendered_html.rendered_against_url` records them
  // (ADR 033 §1.8). Read for all realms at once and cached like a host's
  // entries: until a change to any host URL is announced, or for the same
  // fixed time. A render can record a new URL after this was read. Until it
  // is read again, a response on a host URL still translates from the
  // realm's canonical host URL, but a response on the realm's own URL can
  // name the new URL for up to that fixed time.
  async renderedAgainstURLs(): Promise<RenderedAgainstURLs> {
    this.#ensureSubscribed();
    let cached = this.#renderedAgainst;
    if (cached && cached.expiresAt > this.#now()) {
      return cached.urls;
    }
    if (!this.#renderedAgainstLoad) {
      let invalidationsBefore = this.#invalidations;
      let load = loadRenderedAgainstURLs(this.#dbAdapter).then((urls) => {
        if (this.#invalidations === invalidationsBefore) {
          this.#renderedAgainst = {
            urls,
            expiresAt: this.#now() + this.#ttlMs,
          };
        }
        return urls;
      });
      this.#renderedAgainstLoad = load;
      load.then(
        () => {
          if (this.#renderedAgainstLoad === load) {
            this.#renderedAgainstLoad = undefined;
          }
        },
        () => {
          if (this.#renderedAgainstLoad === load) {
            this.#renderedAgainstLoad = undefined;
          }
        },
      );
    }
    return await this.#renderedAgainstLoad;
  }

  // Drops a host's cached entries in this process. A writer calls this, as
  // well as `notifyHostURLsChanged`, so its own change takes effect before
  // its response is sent (ADR 033 §1.3).
  // A change to any host URL can be followed by a render against another
  // URL, so it also drops the URLs stored HTML was rendered against.
  forget(host: string): void {
    this.#forgetRenderedAgainstURLs();
    this.#entries.delete(host.toLowerCase());
  }

  #forgetAll(): void {
    this.#forgetRenderedAgainstURLs();
    this.#entries.clear();
  }

  #forgetRenderedAgainstURLs(): void {
    this.#invalidations++;
    this.#renderedAgainst = undefined;
    this.#renderedAgainstLoad = undefined;
  }

  async #entriesFor(host: string): Promise<HostEntry[]> {
    let cached = this.#entries.get(host);
    if (cached) {
      this.#entries.delete(host);
      if (cached.expiresAt > this.#now()) {
        this.#entries.set(host, cached);
        return cached.entries;
      }
    }
    let invalidationsBefore = this.#invalidations;
    // A host's entries name its realms' canonical host URLs, which can be on
    // other hosts. So a change to which host URL is canonical changes the
    // entries of every host the realm has, and is announced for each of them.
    let rows = (await query(this.#dbAdapter, [
      `SELECT h.path_prefix, h.is_canonical, r.url, c.host || c.path_prefix AS canonical`,
      `FROM realm_host_urls h JOIN realm_registry r ON r.id = h.realm_id`,
      `LEFT JOIN realm_host_urls c ON c.realm_id = h.realm_id AND c.is_canonical`,
      `WHERE h.host =`,
      param(host),
      `ORDER BY LENGTH(h.path_prefix) DESC`,
    ])) as {
      path_prefix: string;
      is_canonical: boolean;
      url: string;
      canonical: string | null;
    }[];
    let entries = rows.map((row) => ({
      pathPrefix: row.path_prefix,
      realmURL: row.url,
      isCanonical: Boolean(row.is_canonical),
      canonical: row.canonical ?? undefined,
    }));
    if (this.#invalidations === invalidationsBefore) {
      this.#entries.delete(host);
      this.#entries.set(host, {
        entries,
        expiresAt: this.#now() + this.#ttlMs,
      });
      for (let oldest of this.#entries.keys()) {
        if (this.#entries.size <= this.#maxHosts) {
          break;
        }
        this.#entries.delete(oldest);
      }
    }
    return entries;
  }

  #ensureSubscribed(): void {
    if (this.#subscribing || !canSubscribe(this.#dbAdapter)) {
      return;
    }
    this.#subscribing = this.#dbAdapter
      .subscribe(
        HOST_URLS_CHANNEL,
        ({ payload }) => {
          // An announcement that names no host drops every cached host.
          if (payload) {
            this.forget(payload);
          } else {
            this.#forgetAll();
          }
        },
        {
          // Changes made while the connection was down notified no one.
          onReconnect: () => this.#forgetAll(),
        },
      )
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

// Reads, for every realm, the distinct URLs other than its own that its live
// stored HTML was rendered against. The predicate is the one of the partial
// index `prerendered_html_rendered_against_url_index`, so the read touches
// only those rows. A null `rendered_against_url` is the realm's URL.
async function loadRenderedAgainstURLs(
  dbAdapter: DBAdapter,
): Promise<RenderedAgainstURLs> {
  let rows = (await query(dbAdapter, [
    `SELECT DISTINCT realm_url, rendered_against_url FROM prerendered_html`,
    `WHERE rendered_against_url <> realm_url AND is_deleted IS NOT TRUE`,
    `ORDER BY realm_url, rendered_against_url`,
  ])) as { realm_url: string; rendered_against_url: string }[];
  let urls = new Map<string, string[]>();
  for (let row of rows) {
    let list = urls.get(row.realm_url);
    if (!list) {
      list = [];
      urls.set(row.realm_url, list);
    }
    list.push(row.rendered_against_url);
  }
  return urls;
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
// The host URL the request came in on is kept in `ctxt.state` for
// `translateAtHostURLs` (`realm-host-urls-boundary.ts`), which translates the
// rest of the request and its response.
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

// Drops each host from this process's cache, and announces the change to
// every other process (ADR 033 §1.3). A writer calls it after its change is
// stored and before it answers.
export async function announceHostURLChanges(
  dbAdapter: DBAdapter,
  resolver: HostURLResolver | undefined,
  hosts: Iterable<string>,
): Promise<void> {
  for (let host of new Set(hosts)) {
    resolver?.forget(host);
    await notifyHostURLsChanged(dbAdapter, host);
  }
}

// Deletes every host URL of a realm, and returns their hosts so the caller
// can announce the change once it is stored. Deleting the realm's registry
// row deletes them too, but leaves no list of hosts to announce.
export async function deleteRealmHostURLs(
  querier: Querier,
  realmId: string,
): Promise<string[]> {
  let rows = await querier([
    `DELETE FROM realm_host_urls WHERE realm_id =`,
    param(realmId),
    `RETURNING host`,
  ]);
  return rows.map((row) => String(row.host));
}
