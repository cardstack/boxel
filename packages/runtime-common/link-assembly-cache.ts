import { md5 } from 'super-fast-md5';
import {
  TtlResponseCache,
  type ResponseCacheSummary,
} from './ttl-response-cache.ts';
import type { ScreenshotManifest } from './capture-spec.ts';
import stableStringify from 'safe-stable-stringify';
import { computeContentHash } from './content-hash.ts';

export const LINK_ASSEMBLY_CACHE_CHANNEL = 'boxel:link-assembly-cache';

// The retention window has to cover the span over which one page load's
// searches arrive, plus the gap to the next load that reaches the same cards.
// A dashboard-shaped load settles to quiescence in roughly twelve seconds and
// issues its searches throughout, and a person moving around a realm comes
// back to the same heavily-linked cards within seconds of that. A minute
// covers both with room to spare, and costs nothing when it is longer than it
// needs to be: the key is a freshness fingerprint, so an entry a write
// supersedes becomes unreachable at that moment rather than at its expiry.
const DEFAULT_TTL_MS = 60_000;
// A single dashboard-shaped load assembles ~5 MB of link closure over its
// searches, of which ~2 MB is cards more than one search reaches. The cap is
// what bounds heap under many realms at once, and is set to match the sibling
// caches (`CardDocumentCache`, `LiveSearchCache`) so one realm-server's three
// response caches share one order of magnitude rather than three.
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TELEMETRY_INTERVAL_MS = 30_000;

export type LinkAssemblyCacheSummary = ResponseCacheSummary;

// Per-process cache of individual side-loaded resources, as `loadLinks`
// assembles them for `included[]`.
//
// `loadLinks` dedupes its closure perfectly WITHIN one invocation — the
// `visited` set and the per-layer batched lookup see to that — and not at all
// ACROSS invocations. One dashboard render issues many searches whose results
// link heavily to the same cards, and each search reads, walks, clones and
// absolutizes its own copy of every one of them. On a measured dashboard
// workload, eight searches at a page size of 100 produced 1,513 included
// resources of which only 868 were distinct, and eight of those cards were
// assembled once per search, eight times out of eight.
//
// **This shares assembly, never responses.** An entry is one resource, not one
// document: every response still walks its own closure and still carries every
// resource its own results reference. What a second search skips is the work
// of producing a resource it would have produced identically — the wide index
// read, the relationship rewrite, the deep clone and the URL absolutization —
// not the resource's presence in its own `included[]`.
//
// **The key is the resource's own index-row fingerprint**, the same components
// the card+json ETag folds for the same reason: `indexed_at` and `generation`
// move on a direct write and on a dependency-cascaded one alike, and the
// declared-screenshot manifest travels on the separate prerendered_html
// channel that `indexed_at` does not follow. A superseded assembly is
// therefore *unreachable* rather than stale, and the TTL bounds retention
// rather than staleness — the same property `CardDocumentCache` rests on, one
// layer down. Nothing invalidates, so there is no eviction path and no
// cross-replica coordination to get wrong.
//
// What the caller must not file here is a resource whose bytes are not a
// function of its own row:
//
//   - **A resource with foreign-realm dependencies.** Cross-realm
//     invalidation does not cascade `indexed_at`, so a write in the other
//     realm moves nothing this key reads. It is the same condition that
//     suppresses the card+json ETag, and `loadLinks` applies it with the same
//     `hasForeignRealmDeps` test.
//   - **A resource read from the work-in-progress index.** Those rows belong
//     to a pass that has not swapped yet and share a URL with the live row.
//
// Query-backed fields, the hole the live-search cache has to keep its TTL
// short for, cannot open here: `loadLinks` resolves query fields for a
// document's own roots only, and a root is never filed here — only the link
// targets it side-loads are, and their relationships come straight off the
// index row.
//
// Sharing across users is safe for the same reason the sibling caches' is:
// read permission is realm-scoped and was validated for this realm before the
// handler ran, and an entry is only ever reachable through the query engine of
// the realm whose row it came from.
//
// Values are stored serialized rather than as objects, so each reader parses
// its own copy. A resource handed to two responses at once would be a shared
// mutable object in both — and `attachRealmInfo` writes to every resource in
// an assembled document on the way out.
export class LinkAssemblyCache {
  readonly #cache: TtlResponseCache<string>;

  constructor(opts?: {
    ttlMs?: number;
    maxBytes?: number;
    telemetryIntervalMs?: number;
    emitTelemetry?: (summary: LinkAssemblyCacheSummary) => void;
  }) {
    this.#cache = new TtlResponseCache<string>({
      channel: LINK_ASSEMBLY_CACHE_CHANNEL,
      envPrefix: 'LINK_ASSEMBLY_CACHE',
      defaults: {
        ttlMs: DEFAULT_TTL_MS,
        maxBytes: DEFAULT_MAX_BYTES,
        telemetryIntervalMs: DEFAULT_TELEMETRY_INTERVAL_MS,
      },
      sizeOf: (serialized) => serialized.length,
      ...opts,
    });
  }

  // The serialized assembled resource for this row fingerprint, or undefined
  // when nothing current is held for it.
  get(key: LinkAssemblyKey): string | undefined {
    return this.#cache.get(cacheKey(key));
  }

  set(key: LinkAssemblyKey, serializedResource: string): void {
    this.#cache.set(cacheKey(key), serializedResource);
  }

  // Observability for tests and debugging. `misses` counts assemblies this
  // cache did not spare, `hits` counts the ones it did — which is the
  // duplication the whole thing exists to remove.
  get stats() {
    return this.#cache.stats;
  }
}

export interface LinkAssemblyKey {
  // The row's own URL, so two spellings of one card — a `file_alias` and the
  // canonical URL — share an entry rather than assembling twice.
  canonicalURL: string;
  indexedAt: number | null;
  generation: number;
  screenshots: ScreenshotManifest | null;
  // Whether the walk that produced the resource expanded query-backed fields.
  // A side-loaded resource has none to expand today, so both audiences
  // assemble the same bytes — but the flag changes which links a walk follows,
  // and a key that folds it cannot be wrong if that ever stops being true.
  skipQueryBackedExpansion: boolean;
}

function cacheKey(key: LinkAssemblyKey): string {
  return md5(
    JSON.stringify([
      key.canonicalURL,
      key.indexedAt,
      key.generation,
      // The manifest's object keys are content hashes, so a re-render whose
      // captures are byte-identical keeps its fingerprint — matching what
      // `screenshotsEtagFingerprint` does for the card+json validator.
      key.screenshots
        ? computeContentHash(stableStringify(key.screenshots) ?? '').slice(0, 8)
        : null,
      key.skipQueryBackedExpansion,
    ]),
  );
}
