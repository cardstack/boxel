// A merged federated search over realms that share one index database, run
// as one search (docs/search.md, "Federated search"). Where the merge
// (`searchEntryRealms`) asks each realm for its top rows and orders their
// union by the values each realm sorted by, this reads every realm's rows in
// one statement over `realm_url IN (…)`, in one read snapshot, so scores,
// totals, facets and collapse are the union's own: a union of realms A and B
// answers exactly what one realm holding A's and B's cards would.
//
// The union reads only realms the caller reads outright. A search that names
// a realm whose policy scopes the caller takes the merge, which composes that
// realm's grants into its own search (`unionPathRefusal`); a union that reads
// such a realm under its grants is a later row.
//
// The rows are then made entries by the realm each is in, exactly as that
// realm's own search makes them (renderings, item, links).

import type {
  EntryCollectionDocument,
  EntryIncludedResource,
} from '../document-types.ts';
import type { EntryResource } from '../resource-types.ts';
import { isLogBinding } from './query-values.ts';
import type { Realm } from '../realm.ts';
import { RealmUnion, realmOfCard } from '../realm-union.ts';
import { resourceIdentity } from '../resource-identity.ts';
import {
  realmFailureStatus,
  withRealmDeadline,
  type SearchEntryQuery,
} from '../search-entry.ts';
import { incompleteWarning, withWarningOnce } from '../search-bounds.ts';
import type { SearchOpts } from '../search-utils.ts';

// One realm a federated search names, as the union reads it: one the caller
// reads outright, one that contributes no rows, or one whose access could not
// be judged (answered as a realm that did not answer).
export type UnionRealm =
  | { url: string; realm: Realm; access: 'readable' }
  | { url: string; access: 'none' }
  | { url: string; access: 'failed' };

// Why a merged search cannot run as one union statement, or undefined when
// it can. A search the union does not answer takes the merge.
export function unionPathRefusal(
  query: SearchEntryQuery,
  realms: Array<
    | { url: string; realm?: Realm | null; access: 'readable' | 'scoped' }
    | { url: string; access: 'none' | 'failed' }
  >,
): string | undefined {
  if (query.federation?.results !== 'merged') {
    return 'not merged';
  }
  // A realm the caller reads through its policy answers through the merge,
  // which searches it with its grants composed in (`policyScopedQuery`).
  if (realms.some((r) => r.access === 'scoped')) {
    return 'a realm is policy-scoped';
  }
  let reading = realms.filter(
    (r): r is { url: string; realm?: Realm | null; access: 'readable' } =>
      r.access === 'readable',
  );
  if (reading.length === 0) {
    return 'no realm to read';
  }
  let mounted = reading.map((r) => r.realm);
  if (mounted.some((realm) => !realm)) {
    return 'a realm is not mounted on this server';
  }
  let [primary, ...rest] = mounted as Realm[];
  if (rest.some((realm) => !primary.sharesIndexWith(realm))) {
    return 'the realms do not share one index database';
  }
  let item = query.itemQuery;
  // A log binding reads one realm's log lines.
  if (Object.values(item.let ?? {}).some((b) => isLogBinding(b))) {
    return 'a binding reads a log';
  }
  // Look-alikes read one realm's neighbor index.
  if (item.rerank?.compare?.near) {
    return 'a rerank compares look-alikes';
  }
  return undefined;
}

export async function searchEntryUnion(
  realms: UnionRealm[],
  searchEntryQuery: SearchEntryQuery,
  opts?: SearchOpts & { realmDeadline?: number },
): Promise<EntryCollectionDocument> {
  let reading = realms.filter(
    (r): r is Extract<UnionRealm, { realm: Realm }> => r.access === 'readable',
  );
  if (reading.length === 0) {
    throw new Error('a union search reads at least one realm');
  }
  // One zone for every realm, as the merge reckons them (searchEntryRealms).
  let runOpts: (SearchOpts & { realmDeadline?: number }) | undefined = opts;
  if (
    realms.length > 1 &&
    searchEntryQuery.itemQuery.timeZone === undefined &&
    opts?.timeZone === undefined
  ) {
    runOpts = { ...opts, timeZone: 'UTC' };
  }
  let query = searchEntryQuery;
  // A union of one realm is that realm's own search, so a federated search
  // over one realm reaches the database exactly as `_search` there does.
  let single = reading.length === 1 ? reading[0] : undefined;
  let union = new RealmUnion(reading.map((r) => r.url));
  let primary = reading[0].realm;
  // A realm's status carries no timing: the body is cached and compared, and
  // a timing would make two identical answers differ.
  let statuses: NonNullable<EntryCollectionDocument['meta']['realms']> = {};
  for (let r of realms) {
    if (r.access === 'failed') {
      statuses[r.url] = { status: 'unavailable' };
    } else if (r.access === 'none') {
      statuses[r.url] = { status: 'ok', total: 0 };
    }
  }
  let incomplete = realms.some((r) => r.access === 'failed');
  let doc: EntryCollectionDocument;
  try {
    // The whole statement shares one deadline: the per-realm deadline the
    // merge gives each realm.
    doc = await withRealmDeadline(opts?.realmDeadline, runOpts, async (o) => {
      if (single) {
        let own = await single.realm.searchEntries(query, o);
        return {
          ...own,
          meta: {
            ...own.meta,
            realmTotals: { [single.url]: own.meta?.page?.total ?? 0 },
          },
        };
      }
      let { results, meta } = await primary.searchEntryUnionRows(
        union,
        query,
        o,
      );
      // Each row's realm makes its entry, in the union's order.
      let rowsByRealm = new Map<string, typeof results>();
      let realmOfRow: (string | undefined)[] = results.map((row) => {
        let url = typeof row.url === 'string' ? row.url : undefined;
        let realm = url ? realmOfCard(union, url) : undefined;
        if (realm) {
          let list = rowsByRealm.get(realm) ?? [];
          list.push(row);
          rowsByRealm.set(realm, list);
        }
        return realm;
      });
      let byRealm = new Map(reading.map((r) => [r.url, r.realm]));
      let docs = new Map<string, EntryCollectionDocument>();
      await Promise.all(
        [...rowsByRealm].map(async ([realm, rows]) => {
          docs.set(
            realm,
            await byRealm
              .get(realm)!
              .entriesFromRows(query, rows, { page: { total: 0 } }, o),
          );
        }),
      );
      let next = new Map<string, number>();
      let data: EntryResource[] = [];
      for (let realm of realmOfRow) {
        if (!realm) continue;
        let index = next.get(realm) ?? 0;
        next.set(realm, index + 1);
        let entry = docs.get(realm)?.data[index];
        if (entry) data.push(entry);
      }
      let included: EntryIncludedResource[] = [];
      let seen = new Set<string>();
      let linkClosureTruncated = false;
      for (let part of docs.values()) {
        if (part.meta?.linkClosureTruncated) linkClosureTruncated = true;
        for (let resource of part.included ?? []) {
          if (resource.id) {
            let identity = resourceIdentity(resource.type, resource.id);
            if (seen.has(identity)) continue;
            seen.add(identity);
          }
          included.push(resource);
        }
      }
      // Query V2's engine reads a union and counts each realm's share.
      let { realmTotals, ...rest } = meta as typeof meta & {
        realmTotals?: Record<string, number>;
      };
      let out: EntryCollectionDocument = {
        data,
        meta: {
          ...rest,
          ...(query.fieldset.html ? { htmlQuery: query.htmlQuery } : {}),
          ...(linkClosureTruncated ? { linkClosureTruncated: true } : {}),
          ...(realmTotals ? { realmTotals } : {}),
        },
      };
      if (included.length) out.included = included;
      return out;
    });
    for (let r of reading) {
      let total = doc.meta.realmTotals?.[r.url];
      let page = doc.meta.page;
      statuses[r.url] = {
        status: 'ok',
        ...(total !== undefined ? { total } : {}),
        ...(single && page?.hasMore !== undefined
          ? { hasMore: page.hasMore }
          : {}),
      };
    }
  } catch (e) {
    if (opts?.signal?.aborted) {
      throw e;
    }
    console.error(
      `searchEntryUnion: the union search over ${union.realms.join(', ')} failed`,
      e,
    );
    let status = realmFailureStatus(e);
    for (let r of reading) {
      statuses[r.url] = status;
    }
    incomplete = true;
    doc = {
      data: [],
      meta: {
        page: { total: 0 },
        ...(query.fieldset.html ? { htmlQuery: query.htmlQuery } : {}),
      },
    };
  }
  // A realm that contributes no rows counts none, as it does in the merge.
  if (doc.meta.realmTotals) {
    for (let r of realms) {
      if (r.access === 'none') doc.meta.realmTotals[r.url] = 0;
    }
  }
  doc.meta.federation = { results: 'merged', path: 'union' };
  doc.meta.realms = Object.fromEntries(
    realms.map((r) => [r.url, statuses[r.url]]),
  );
  if (incomplete) {
    doc.meta.incomplete = true;
    doc.meta.warnings = withWarningOnce(doc.meta.warnings, incompleteWarning());
  }
  return doc;
}
