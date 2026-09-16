import { md5 } from 'super-fast-md5';
import {
  TtlResponseCache,
  type ResponseCacheOutcome,
  type ResponseCacheSummary,
} from './ttl-response-cache.ts';

export const CARD_DOCUMENT_CACHE_CHANNEL = 'boxel:card-document-cache';
// Mirrors `x-boxel-live-search-cache`: the outcome the cache reached for this
// request, so a single response can be attributed without inferring it.
// Like that one, it is deliberately NOT in `createResponse`'s
// `Access-Control-Expose-Headers`, so a cross-origin browser cannot read it —
// it is for server-side callers and hand debugging. The hit rate proper comes
// from the telemetry summaries on the channel below.
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
// same index row.
//
// Everything else — a redirect, a vanished row, an error document — comes
// back as one of the `outcome` variants, which carry only data. Two requests
// can share an assembly, so nothing here may close over the request that
// happened to run it: the responses differ (a `Response` body is consumable
// once) and so can their inputs, since `paths.local()` ignores the query
// string and two requests that differ only there share a cache key. Each
// caller renders these against its own request and request context.
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
      // Whether assembling the document applied a query-backed field, as
      // reported by the index query engine. Such a document is not a
      // function of its own index row — a write to some other card that
      // enters or leaves the query changes it, and deliberately does not
      // move this card's `deps` or `indexed_at` — so the validator this
      // cache keys on would not move, and it cannot be retained. Taken from
      // the engine rather than sniffed off the assembled document: a query
      // that aborted or whose realms could not be placed leaves no
      // `links.search` marker behind, yet still depends on other cards.
      queryBacked: boolean;
      // The validator the lookup was keyed on, so retention can check that
      // the assembly agrees with it.
      keyEtag: string;
      lastModified: number | null | undefined;
      created: number | undefined;
    }
  // The path holds bytes rather than a card. Asked for as card+json it answers
  // with the file's metadata document, which is derived from those bytes and
  // has no index row behind it — so it carries neither a validator nor a
  // cache directive, and is never retained.
  | { kind: 'file-meta'; body: string }
  // Nothing at this path, and nothing on its way: the caller renders its own
  // not-found.
  | { kind: 'not-found' }
  // The card's source is on disk but the index has not caught up with it yet.
  // A write lands on the file system first, so this is a card in waiting
  // rather than a card that does not exist, and the caller says so — letting a
  // client hold a placeholder until the realm broadcasts the index event.
  | { kind: 'not-indexed' }
  // `paths.fileURL(localPath)` normalized to a different local path.
  | { kind: 'redirect'; foundPath: string }
  // The index has a row but it can't be served cleanly; the caller renders
  // the JSON:API error against its own request.
  | { kind: 'error'; error: CardJsonAssemblyError };

// The parts of an errored index row a response is built from — data only, so
// the request-specific fields (`id`, the message's URL) come from whichever
// request is rendering it rather than from whichever one assembled it.
export interface CardJsonAssemblyError {
  status: number;
  title: string | undefined;
  message: string;
  stack: string | undefined;
  lastKnownGoodHtml: string | null;
  cardTitle: string | null;
  scopedCssUrls: string[];
}

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
// realm-info hash, the screenshot-manifest fingerprint, and whether the
// assembly side-loaded the card's links or only answered them — and the realm
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
//
// One consequence of coalescing worth stating: a request that joins an
// assembly inherits that assembly's failure if it rejects, rather than
// getting its own attempt. Nothing is retained in that case, so the next
// request in retries from scratch — the shared fate is bounded to the
// requests that were already in flight together.
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
      // Retain only a body that is a function of its own index row and whose
      // validator survived assembly. A `respond` thunk is shared with whoever
      // joined the computation and then dropped: it stands for a race or an
      // error, and the next request should look at the index again rather
      // than at a remembered failure. A query-backed document is dropped for
      // the reason `hasQueryBackedRelationships` gives.
      retain: (assembly) =>
        assembly.kind === 'document' &&
        assembly.etag !== undefined &&
        !assembly.queryBacked &&
        // The key came from a read taken before the assembly; if the
        // assembly's own validator disagrees, a write landed in between and
        // this entry would be filed under a validator that does not describe
        // its bytes. Retaining it would also stop the card answering 304s
        // (a conditional request compares against the newer validator and
        // never matches) until it aged out. Dropping it costs one
        // reassembly and keeps "a retained entry's key describes its bytes"
        // a checked property rather than an argument about read ordering.
        assembly.etag === assembly.keyEtag,
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
