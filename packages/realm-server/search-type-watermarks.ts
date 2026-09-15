import {
  ALL_TYPES_KEY,
  addExplicitParens,
  internalKeyFor,
  isRelativePath,
  logger,
  moduleFrom,
  param,
  query,
  separatedByCommas,
  type CodeRef,
  type DBAdapter,
  type Expression,
  type Realm,
  type RealmTypeGenerationsTable,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { fetchRealmGenerations } from './job-scoped-search-cache.ts';

const log = logger('search-type-watermarks');

// How long a resolved anchor keeps its keys. The mapping from a query's
// spelling of a type to the spellings the indexer stamps changes only when a
// module is rewritten to move where a class is defined, which no ordinary
// write does — but nothing here observes that rewrite, so the entry ages out
// instead. An expiry costs one realm-wide-keyed request for that anchor and
// nothing else, since the resolution that replaces it runs off the hit path.
const ANCHOR_KEY_TTL_MS = 60_000;

// The freshness fingerprint a searched realm contributes to the live-search
// cache key: the newest generation on the index channel and on the
// prerendered-HTML channel.
export type RealmGenerationFingerprints = Record<
  string,
  { index: number; html: number }
>;

// Resolved anchors, keyed by the anchor's own `internalKeyFor` spelling. The
// value is every `boxel_index.types` key that spelling can match — which is
// what the watermark lookup has to address, and what the query engine
// independently matches rows on.
const anchorKeys = new Map<string, { keys: string[]; expiresAt: number }>();
// Anchors a resolution is already running for, so a burst of requests on a
// cold anchor starts one lookup rather than one per request.
const resolving = new Set<string>();

// Test seam: a suite that resolves an anchor must not then be judged by an
// entry a previous test left behind.
export function resetAnchorKeysForTests(): void {
  anchorKeys.clear();
  resolving.clear();
}

// The `realm_type_generations` keys a query's type anchors address, or
// `undefined` when the query gets no type scoping and reads the realm-wide
// generation instead.
//
// Each anchor resolves to the keys `IndexQueryEngine.typeKeysFor` matches its
// rows on — the anchor's own spelling plus its canonical defining-module
// spelling. Both are needed: a filter naming a type through a re-exporting
// module shares no key with the rows unless the canonical one is resolved, so
// scoping on the own spelling alone would address a row nothing ever writes
// and leave the key constant.
//
// What it deliberately does NOT resolve is the anchor's ancestors. The write
// side stamps a row's full adoption chain, so a `DailyReport` write moves
// `DailyReport` and every type it adopts from up to `CardDef`. Resolving
// ancestors here as well would put `CardDef` in every query's key, and every
// write moves `CardDef`; the key would have no selectivity left. Reading the
// anchor alone is what makes a query on `Student` survive a `DailyReport`
// write while still being invalidated by a write to a subtype of `Student`,
// which stamps `Student` as part of its chain.
//
// An anchor whose keys have not been resolved yet reads as unscoped, so the
// query takes the realm-wide generation until they land. Resolution needs a
// definition lookup, and this runs on the cache-hit path.
export function searchTypeWatermarkKeys(
  anchors: CodeRef[] | undefined,
  virtualNetwork: VirtualNetwork,
): string[] | undefined {
  if (!anchors?.length) {
    return undefined;
  }
  let keys = new Set<string>();
  let now = Date.now();
  for (let anchor of anchors) {
    let ownKey = anchorOwnKey(anchor, virtualNetwork);
    if (ownKey === undefined) {
      return undefined;
    }
    let resolved = anchorKeys.get(ownKey);
    if (!resolved || resolved.expiresAt <= now) {
      return undefined;
    }
    for (let key of resolved.keys) {
      keys.add(key);
    }
  }
  // The catch-all every lookup folds in, so a pass that could not name the
  // types it touched — and a rebuild whose writes were never read first,
  // where a type a row is leaving is named by nothing else — invalidates
  // every type-scoped key by moving one row.
  keys.add(ALL_TYPES_KEY);
  return [...keys];
}

// An anchor's own key, or `undefined` when it has none this lookup can use.
function anchorOwnKey(
  anchor: CodeRef,
  virtualNetwork: VirtualNetwork,
): string | undefined {
  // A relative module spelling is resolved against the document that issued
  // the query, which this key has no access to, so it cannot be compared with
  // what the indexer stamped.
  if (isRelativePath(moduleFrom(anchor))) {
    return undefined;
  }
  try {
    return internalKeyFor(anchor, undefined, virtualNetwork);
  } catch (_e) {
    // A ref the network cannot resolve to a module yields no comparable key,
    // and an anchor set missing one of its members would under-state what the
    // query matches.
    return undefined;
  }
}

// Resolve any anchor whose keys are cold or aged out, so the next request on
// this query is scoped. Runs off the request's critical path — the caller
// does not await it — because resolving a `CodeRef` to its canonical spelling
// can cost a definition lookup, which must not land on the cache-hit path.
//
// The resolution goes through a realm already mounted in this process: a
// searched realm the request itself is about to read from, never a mount this
// warm-up forces. A search whose realms are all cold simply stays unscoped
// until one of them is mounted by the miss it is already paying for.
//
// Nothing this does can fail the search it rides along with. The whole body
// is guarded, not just the resolution promise: every step before it — reading
// a ref's module, resolving a mounted realm, reaching that realm's query
// engine — runs synchronously on the request's stack, so a throw there would
// surface as a failed search rather than as an unscoped one. The worst
// outcome available to it is that the key stays keyed on the realm
// generation, which is what it was before any of this.
export function warmSearchTypeWatermarkKeys(args: {
  anchors: CodeRef[] | undefined;
  virtualNetwork: VirtualNetwork;
  mountedRealm: () => Realm | undefined;
}): void {
  try {
    warmAnchors(args);
  } catch (err: unknown) {
    log.info(
      `could not start resolving this query's type keys; it stays keyed on the realm generation: ${String(err)}`,
    );
  }
}

function warmAnchors(args: {
  anchors: CodeRef[] | undefined;
  virtualNetwork: VirtualNetwork;
  mountedRealm: () => Realm | undefined;
}): void {
  if (!args.anchors?.length) {
    return;
  }
  let now = Date.now();
  for (let anchor of args.anchors) {
    let ownKey = anchorOwnKey(anchor, args.virtualNetwork);
    if (ownKey === undefined || resolving.has(ownKey)) {
      continue;
    }
    let resolved = anchorKeys.get(ownKey);
    if (resolved && resolved.expiresAt > now) {
      continue;
    }
    // A realm this process holds but has not finished starting has no query
    // engine yet, and reading through one that isn't there would throw on the
    // request's own stack.
    let engine = args.mountedRealm()?.realmIndexQueryEngine;
    if (!engine) {
      return;
    }
    resolving.add(ownKey);
    void engine
      .typeKeysFor(anchor)
      .then((keys) => {
        anchorKeys.set(ownKey, {
          keys,
          expiresAt: Date.now() + ANCHOR_KEY_TTL_MS,
        });
      })
      .catch((err: unknown) => {
        // Nothing awaits this, so an escaping throw would be an unhandled
        // rejection rather than a decision. Every failure means the same
        // thing: no keys, so the query keeps reading the realm-wide
        // generation.
        log.info(
          `could not resolve the type keys for ${ownKey}; searches anchored on it stay keyed on the realm generation: ${String(err)}`,
        );
      })
      .finally(() => {
        resolving.delete(ownKey);
      });
  }
}

// The generation fingerprints a live search folds into its cache key, scoped
// to the types its filter is anchored on where that is possible and falling
// back to the realm-wide generation where it is not.
//
// What the scoped key buys is that one person's save stops unreaching every
// other reader's cached search: `realm_generations.current_generation`
// advances on every index batch in the realm, so it changes the key of every
// cached search for that realm, for every query, for every user — entries
// that are still in memory and still correct, and that nothing can look up
// any more.
//
// What it costs is that retention becomes the staleness bound for a change
// the query's own type anchors do not cover. The side-loaded `included`
// closure is that case: its link targets are cards of other types, so a write
// to one of them leaves the key where it is and the cached body keeps serving
// the target as it stood. That is bounded by the cache's TTL and nothing
// else, which is why the TTL has to stay short.
//
// Membership itself is covered, because the anchors are an over-approximation
// in the sound direction: every entry the filter matches adopts from at least
// one of them, so a row can only enter or leave the result set by being one of
// the anchored types, and any write to a row of those types moves the key.
// That holds for a card the query has never seen — a newly created one enters
// without touching any existing member — and for a filter that also constrains
// field values, since a matching-type write moves the key regardless of the
// values it wrote.
export async function resolveSearchGenerations(
  dbAdapter: DBAdapter,
  realms: string[],
  anchors: CodeRef[] | undefined,
  virtualNetwork: VirtualNetwork,
): Promise<RealmGenerationFingerprints> {
  let typeKeys = searchTypeWatermarkKeys(anchors, virtualNetwork);
  if (!typeKeys) {
    return fetchRealmGenerations(dbAdapter, realms);
  }
  return fetchTypeScopedGenerations(dbAdapter, realms, typeKeys);
}

// The newest generation on each channel among the given types' watermark
// rows, per realm. A realm holding no row for any of them reads as 0 on both
// channels — a type no pass has stamped cannot have moved, and the first
// write that touches it creates the row and moves the key.
export async function fetchTypeScopedGenerations(
  dbAdapter: DBAdapter,
  realms: string[],
  typeKeys: string[],
): Promise<RealmGenerationFingerprints> {
  let out: RealmGenerationFingerprints = {};
  for (let realm of realms) {
    out[realm] = { index: 0, html: 0 };
  }
  if (realms.length === 0 || typeKeys.length === 0) {
    return out;
  }
  let rows = (await query(dbAdapter, [
    `SELECT realm_url,
            MAX(index_generation) AS index_generation,
            MAX(html_generation) AS html_generation
       FROM realm_type_generations
      WHERE realm_url IN`,
    ...addExplicitParens(
      separatedByCommas(realms.map((realm) => [param(realm)])),
    ),
    `AND type_key IN`,
    ...addExplicitParens(
      separatedByCommas(typeKeys.map((typeKey) => [param(typeKey)])),
    ),
    `GROUP BY realm_url`,
  ] as Expression)) as (Pick<RealmTypeGenerationsTable, 'realm_url'> & {
    index_generation: number | string | null;
    html_generation: number | string | null;
  })[];
  let toNum = (value: number | string | null): number =>
    typeof value === 'string' ? parseInt(value) : (value ?? 0);
  for (let row of rows) {
    out[row.realm_url] = {
      index: toNum(row.index_generation),
      html: toNum(row.html_generation),
    };
  }
  return out;
}
