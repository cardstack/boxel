import {
  TtlResponseCache,
  type ResponseCacheOutcome,
  type ResponseCacheSummary,
  type Query,
} from '@cardstack/runtime-common';
import { searchRequestKeyHash } from './job-scoped-search-cache.ts';

// Defaults are deliberately conservative: the TTL only needs to cover the
// window in which a burst of clients issues the same query (an index event
// fanning out to every subscribed browser), and the byte cap bounds how much
// heap the cache can hold at its worst — entry bodies are fully-assembled
// federated-search documents that can run to many MB each.
const DEFAULT_TTL_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
// Floor between telemetry summary lines. Emission piggybacks on request
// activity, so an idle cache emits nothing and a busy one emits at most one
// line per interval.
const DEFAULT_TELEMETRY_INTERVAL_MS = 30_000;

export const LIVE_SEARCH_CACHE_CHANNEL = 'boxel:live-search-cache';

export type LiveSearchOutcome = ResponseCacheOutcome;
export type LiveSearchCacheSummary = ResponseCacheSummary;

// Per-process coalescing + short-TTL cache for LIVE `_federated-search`
// requests — the callers the job-scoped cache deliberately excludes (no
// `x-boxel-job-id`). Live searches are dominated by many clients rendering
// the same cards: their queries are byte-identical, and every incremental
// index event makes every subscribed client re-issue them at once. Without
// this layer each of those requests runs its own SQL + `loadLinks` assembly
// and stringifies its own multi-MB document — concurrent identical requests
// scale heap linearly and have OOM'd the realm-server in production.
//
// The key is the same canonical `(realms, query, opts)` hash the job-scoped
// cache uses. Freshness is structural rather than temporal: the caller folds
// a generation fingerprint for each searched realm into `opts`, so a swap the
// fingerprint covers changes the key and the next request recomputes.
//
// That fingerprint is scoped to the card types the query's filter is anchored
// on (`search-type-watermarks.ts`), which is what stops one write from
// unreaching every cached search in the realm — and it is why the TTL is not
// purely a retention bound. A change the anchors do not cover moves no key,
// and the side-loaded `included` closure is that case: its link targets are
// cards of other types, so the body keeps serving them as they stood until
// the entry ages out. `DEFAULT_TTL_MS` is therefore the staleness bound for
// that closure and has to stay short; raising it, here or through
// `LIVE_SEARCH_CACHE_TTL_MS`, widens the window in which a linked card is
// served stale.
//
// Sharing across users is safe: the body is a pure function of
// `(realms, query, opts)` — permissions are realm-scoped and
// `multiRealmAuthorization` has already validated every caller against the
// full realm list before the handler runs.
//
// One deliberate looseness: `_federated-search` drops a realm that fails to
// mount rather than failing the whole request, so a body computed during a
// transient per-realm failure can be served to TTL-window stragglers. Those
// callers would have received the same degraded body from their own compute
// moments earlier; the short TTL bounds the recovery lag.
export class LiveSearchCache {
  readonly #cache: TtlResponseCache<string>;

  constructor(opts?: {
    ttlMs?: number;
    maxBytes?: number;
    // Floor between telemetry summaries; 0 disables emission.
    telemetryIntervalMs?: number;
    // Test seam: when set, summaries go here instead of the logger.
    emitTelemetry?: (summary: LiveSearchCacheSummary) => void;
  }) {
    this.#cache = new TtlResponseCache<string>({
      channel: LIVE_SEARCH_CACHE_CHANNEL,
      envPrefix: 'LIVE_SEARCH_CACHE',
      defaults: {
        ttlMs: DEFAULT_TTL_MS,
        maxBytes: DEFAULT_MAX_BYTES,
        telemetryIntervalMs: DEFAULT_TELEMETRY_INTERVAL_MS,
      },
      // Bodies are JSON and thus overwhelmingly single-byte characters, so
      // string length approximates heap cost.
      sizeOf: (body) => body.length,
      ...opts,
    });
  }

  // `onOutcome` fires the moment the cache decides how it will satisfy the
  // request — before a joiner starts waiting on the in-flight compute, before
  // a hit returns, and as a miss starts its populate — so a caller can act on
  // the decision while the request is still in progress. The realm-server's
  // search admission uses it to hand back the slot of a request that holds no
  // result document of its own.
  async getOrPopulate(args: {
    realms: string[];
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<string>;
    onOutcome?: (outcome: LiveSearchOutcome) => void;
  }): Promise<{ body: string; outcome: LiveSearchOutcome }> {
    let { value, outcome } = await this.#cache.getOrPopulate({
      key: searchRequestKeyHash(args.realms, args.query, args.opts),
      populate: args.populate,
      ...(args.onOutcome ? { onOutcome: args.onOutcome } : {}),
    });
    return { body: value, outcome };
  }

  // Observability for tests and debugging.
  get stats() {
    return this.#cache.stats;
  }
}
