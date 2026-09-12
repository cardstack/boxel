import { md5 } from 'super-fast-md5';
import {
  TtlResponseCache,
  type ResponseCacheOutcome,
  type ResponseCacheSummary,
} from './ttl-response-cache.ts';

export const CARD_DOCUMENT_CACHE_CHANNEL = 'boxel:card-document-cache';
// Mirrors `x-boxel-live-search-cache`: the outcome the cache reached for this
// request, so a hit rate is readable from the response rather than inferred.
export const CARD_DOCUMENT_CACHE_HEADER = 'x-boxel-card-cache';

// The TTL bounds retention, not staleness — the key already does staleness
// (see the class comment) — so it is sized to the gap between repeat reads of
// one card rather than to any freshness requirement. In the production window
// this was measured against, one realm's busiest card was read 186 times in
// fifteen minutes across 8 sessions: roughly one read of that card every 5 s,
// and one read per session every ~30 s. A minute covers both, and is long
// relative to the search cache's 5 s because a card's validator only rotates
// when that card is re-indexed, where a search key rotates on any write
// anywhere in a searched realm.
const DEFAULT_TTL_MS = 60_000;
// The cap, not the TTL, is what actually bounds heap, and it is the one the
// working set has to fit inside. The same window saw 31 distinct cards read
// across fifteen minutes at a 82 KB median / 362 KB p90 body size — a few MB
// of hot set per busy realm, so this leaves room for many realms at once
// while staying an order of magnitude below any one realm's total (a realm
// of a couple of thousand instances would run to hundreds of MB if it were
// all resident, which is what the LRU is for).
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TELEMETRY_INTERVAL_MS = 30_000;

// What one assembly of a card+json GET produced. `document` is the cacheable
// shape: the serialized body plus the header values that are functions of the
// same index row. Everything else — a redirect, a 404, an error document, a
// race that invalidated the fingerprint the lookup was keyed on — comes back
// as `respond`, a thunk each caller invokes to build its own `Response`.
// A thunk rather than a `Response` because a joiner and the request that
// started the computation each need their own: a `Response` body can only be
// consumed once.
export type CardJsonAssembly =
  | {
      kind: 'document';
      body: string;
      // The validator for these exact bytes, read back out on a hit. Absent
      // when the assembly discovered a foreign-realm dependency the
      // pre-assembly peek didn't see, which also makes the value unretainable.
      etag: string | undefined;
      // Whether the missing validator is the deliberate foreign-realm
      // suppression, which the response advertises as a header.
      etagSuppressed: boolean;
      lastModified: number | null | undefined;
      created: number | undefined;
    }
  | { kind: 'respond'; respond: () => Promise<Response> };

export type CardDocumentCacheOutcome = ResponseCacheOutcome;
export type CardDocumentCacheSummary = ResponseCacheSummary;

// Coalescing + TTL cache for assembled `application/vnd.card+json` GET
// bodies. A card GET reads one index row and then runs `loadLinks` to build
// the transitive closure of the card's links into `included[]` — seconds of
// work and hundreds of KB for a well-connected card. The result is a pure
// function of the card and the index state it was assembled from, and in
// production the same card is requested many times over within one index
// generation: by different users looking at the same data, and by one tab
// re-reading after each of its neighbours' writes.
//
// **The key is the response's own ETag.** `buildCardJsonEtag` already folds
// in everything the served representation varies on — the row's `indexed_at`
// (which moves on a direct write *and* on a dependency-cascaded one), the
// realm-info hash, and the screenshot-manifest fingerprint — and the realm
// already hands that value to browsers as the validator it will honour a
// `304` against. Keying on it means a superseded body becomes *unreachable*
// rather than stale, and the server-side cache is never fresher or staler
// than the HTTP validator the same response already carries.
//
// A per-card validator rather than the realm's index generation, because the
// realm generation advances on every index batch — including the 83% of them
// that are somebody else's write to an unrelated card. Measured on one
// 2,142-instance realm sitting at generation 166: the median card had never
// been re-indexed since generation 1, and 99.9% of rows were behind the
// realm's current generation by an average of 145 generations. A cache keyed
// on the realm generation would have been emptied 165 times over while those
// cards' served bytes never changed once.
//
// Two consequences of keying on the validator, both deliberate:
//
//   - A card with foreign-realm dependencies suppresses its ETag (cross-realm
//     invalidation doesn't cascade `indexed_at`), so it has no valid key and
//     is never cached. The condition that makes the validator unsafe is the
//     same one that makes the cache unsafe; one check covers both.
//   - Nothing invalidates. There is no eviction path to get wrong, and no
//     cross-replica coordination to get wrong either: each process derives
//     the key from index state it read itself, so two replicas can hold
//     entries for different generations without either serving a body its
//     own key doesn't describe.
//
// Sharing across users is safe for the same reason the live-search cache's
// is: read permission is realm-scoped and `checkPermission` has already
// validated the caller against this realm before the handler runs, so a
// caller who reaches the cache would have assembled byte-identical bytes.
// Per-request headers that *do* vary by caller (`cache-control`'s
// public/private visibility) are computed per request, outside the entry.
export class CardDocumentCache {
  readonly #cache: TtlResponseCache<CardJsonAssembly>;

  constructor(opts?: {
    ttlMs?: number;
    maxBytes?: number;
    telemetryIntervalMs?: number;
    emitTelemetry?: (summary: CardDocumentCacheSummary) => void;
  }) {
    this.#cache = new TtlResponseCache<CardJsonAssembly>({
      channel: CARD_DOCUMENT_CACHE_CHANNEL,
      envPrefix: 'CARD_DOCUMENT_CACHE',
      defaults: {
        ttlMs: DEFAULT_TTL_MS,
        maxBytes: DEFAULT_MAX_BYTES,
        telemetryIntervalMs: DEFAULT_TELEMETRY_INTERVAL_MS,
      },
      sizeOf: (assembly) =>
        assembly.kind === 'document' ? assembly.body.length : 0,
      // Retain only a body whose validator survived assembly. A `respond`
      // thunk is shared with whoever joined the computation and then dropped:
      // it stands for a race or an error, and the next request should look at
      // the index again rather than at a remembered failure.
      retain: (assembly) =>
        assembly.kind === 'document' && assembly.etag !== undefined,
      ...opts,
    });
  }

  async getOrPopulate(args: {
    // The canonical card URL. Card URLs are absolute and realm-prefixed, so
    // one cache can serve every realm in the process without a realm
    // component in the key.
    url: string;
    // The pre-assembly validator — see the class comment.
    etag: string;
    // Prerender reads skip query-backed field expansion, which changes the
    // body, so the two audiences must not share an entry.
    skipQueryBackedExpansion: boolean;
    populate: () => Promise<CardJsonAssembly>;
    onOutcome?: (outcome: CardDocumentCacheOutcome) => void;
  }): Promise<{
    assembly: CardJsonAssembly;
    outcome: CardDocumentCacheOutcome;
  }> {
    let key = md5(
      JSON.stringify([args.url, args.etag, args.skipQueryBackedExpansion]),
    );
    let { value, outcome } = await this.#cache.getOrPopulate({
      key,
      populate: args.populate,
      ...(args.onOutcome ? { onOutcome: args.onOutcome } : {}),
    });
    return { assembly: value, outcome };
  }

  // Observability for tests and debugging.
  get stats() {
    return this.#cache.stats;
  }
}
