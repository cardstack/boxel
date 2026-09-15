import {
  ALL_TYPES_KEY,
  addExplicitParens,
  internalKeyFor,
  isRelativePath,
  moduleFrom,
  param,
  query,
  separatedByCommas,
  type CodeRef,
  type DBAdapter,
  type Expression,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { fetchRealmGenerations } from './job-scoped-search-cache.ts';

// The freshness fingerprint a searched realm contributes to the live-search
// cache key: the newest generation on the index channel and on the
// prerendered-HTML channel.
export type RealmGenerationFingerprints = Record<
  string,
  { index: number; html: number }
>;

// The `realm_type_generations` keys a query's type anchors address, or
// `undefined` when the query gets no type scoping and reads the realm-wide
// generation instead.
//
// Each anchor resolves to its OWN spelling only — deliberately not its
// ancestors. The write side stamps a row's full adoption chain, so a
// `DailyReport` write moves `DailyReport` and every type it adopts from up to
// `CardDef`. Resolving ancestors here as well would put `CardDef` in every
// query's key, and every write moves `CardDef`; the key would have no
// selectivity left. Reading the anchor alone is what makes a query on
// `Student` survive a `DailyReport` write while still being invalidated by a
// write to a subtype of `Student`, which stamps `Student` as part of its
// chain.
//
// A spelling the indexer never stamps — a type named through a re-exporting
// module, whose rows carry its defining module's spelling instead — addresses
// a row that does not exist and reads as generation 0. That is the staleness
// the cache's TTL bounds; see `resolveSearchGenerations`.
export function searchTypeWatermarkKeys(
  anchors: CodeRef[] | undefined,
  virtualNetwork: VirtualNetwork,
): string[] | undefined {
  if (!anchors?.length) {
    return undefined;
  }
  let keys = new Set<string>();
  for (let anchor of anchors) {
    // A relative module spelling is resolved against the document that issued
    // the query, which this key has no access to, so it cannot be compared
    // with what the indexer stamped.
    if (isRelativePath(moduleFrom(anchor))) {
      return undefined;
    }
    let key: string;
    try {
      key = internalKeyFor(anchor, undefined, virtualNetwork);
    } catch (_e) {
      // A ref the network cannot resolve to a module yields no comparable
      // key, and an anchor set missing one of its members would under-state
      // what the query matches.
      return undefined;
    }
    keys.add(key);
  }
  // The catch-all every lookup folds in, so a pass that could not name the
  // types it touched — and a from-scratch rebuild, where a type whose last
  // row vanished is named by nothing else — invalidates every type-scoped
  // key by moving one row.
  keys.add(ALL_TYPES_KEY);
  return [...keys];
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
// What it costs is that retention becomes the staleness bound for anything a
// query's own type anchors do not cover. Two things fall outside them: the
// side-loaded `included` closure, whose link targets are cards of other types,
// and an anchor spelled through a re-exporting module, which addresses a
// watermark row the indexer never writes. Both are bounded by the cache's TTL
// and nothing else, which is why that TTL has to stay short.
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
  ] as Expression)) as {
    realm_url: string;
    index_generation: number | string | null;
    html_generation: number | string | null;
  }[];
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
