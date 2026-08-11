// Publishing a compatible Version invalidates the instances whose ranges
// newly resolve to it.
//
// THE RULING THIS IMPLEMENTS. `deck-the-range-is-on-disk.md` §0: an instance
// names a RANGE and keeps naming it; the type it runs is whatever the resolver
// answers. §3 names the work that follows, and this is its first bullet —
// "publishing a compatible Version must INVALIDATE the instances whose ranges
// newly resolve to it — they are not stale data, they are running something
// new".
//
// WHAT MAKES THIS CHEAP. The range is already in the index. An instance that
// adopts from `_packages/experiments/greeter@^2.0.0/index.js` indexes with the
// resolved spelling in `types`:
//
//     .../_packages/experiments/greeter@2.2.0/index/Greeter
//
// and the AUTHORED spelling, percent-encoded, in `deps`:
//
//     .../_packages/experiments/greeter@%5E2.0.0/index
//
// That is the whole design in two columns — the file holds intent, the index
// holds the current answer — and it means the dependency graph already knows
// which rows care about a range. Nothing was ever seeding it.
//
// WHY THE PREDICATE IS "RESOLVES TO", NOT "SATISFIES". A range should be
// invalidated only when the new Version is the one it now ANSWERS WITH, not
// merely one it would accept. Publishing `2.1.5` onto an older line satisfies
// `^2.0.0`, but `^2.0.0` still resolves to `2.2.0` — nothing that range
// governs is running different code, so reindexing it would be pure churn.
// Asking `resolveVersionSpec` instead of `semver.satisfies` is what keeps a
// backport patch from reindexing the world.
//
// This is the third caller of `resolveVersionSpec`, after the serve door and
// the packer's lock. That is deliberate: "which Version does this spec mean?"
// is one question, and a second implementation of it is a second answer.
//
// EXACT PINS COUNT TOO, and for a reason worth stating. An instance pinned to
// `greeter@2.3.0` before `2.3.0` exists is not broken data — it is HELD, in
// the sense of `deck-who-may-intervene.md` §4: data present, intent present,
// code not yet there. Publishing `2.3.0` heals it. Since the predicate is
// "what does this spec resolve to now", both cases fall out of the same
// comparison rather than needing a branch.

import { readStoreMeta, resolveVersionSpec } from '@cardstack/deck/node';
import type { StoreMeta } from '@cardstack/deck/node';
import type { DBAdapter } from '@cardstack/runtime-common';

export interface RealmInvalidation {
  realmURL: string;
  // Realm files whose index rows depend on a range that now resolves to the
  // published Version. These are seeds: the ordinary incremental fan-out
  // carries on from them to whatever depends on THEM in turn.
  urls: string[];
  // The authored ranges that selected them, for the log line. An operator
  // reading "reindexing 12 files because ^2.0.0 now means 2.3.0" can tell
  // that from a bare list of URLs only by guessing.
  ranges: string[];
}

// The spec segment of a package URL: everything between `<name>@` and the
// next `/`. Percent-encoded in the index, because `^` is not a URL path
// character — `@%5E2.0.0` is `@^2.0.0`.
function specFrom(dep: string, name: string): string | undefined {
  let marker = `/_packages/${name}@`;
  let at = dep.indexOf(marker);
  if (at === -1) {
    return undefined;
  }
  let rest = dep.slice(at + marker.length);
  let slash = rest.indexOf('/');
  let raw = slash === -1 ? rest : rest.slice(0, slash);
  if (!raw) {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    // A dep that is not valid percent-encoding is not a spec this server
    // wrote. Skip it rather than failing the publish: refusing to accept a
    // Version because some unrelated row is malformed would be the wrong
    // trade entirely.
    return undefined;
  }
}

// One `(realm, file, dep)` triple as the index holds it. Named so the pure
// selection below can be exercised without a database — the SQL is a filter,
// the ruling is here.
export interface DependencyRow {
  realmURL: string;
  url: string;
  dep: string;
}

export function selectInvalidations(options: {
  rows: DependencyRow[];
  meta: StoreMeta;
  name: string;
  version: string;
}): RealmInvalidation[] {
  let { rows, meta, name, version } = options;
  let byRealm = new Map<string, { urls: Set<string>; ranges: Set<string> }>();
  for (let { realmURL, url, dep } of rows) {
    if (!realmURL || !url || !dep) {
      continue;
    }
    let spec = specFrom(dep, name);
    if (!spec) {
      continue;
    }
    let resolution = resolveVersionSpec(spec, meta);
    // `exact` and `redirect` both carry a version; `not-found` and `invalid`
    // do not, and neither can name the Version just published.
    if (
      (resolution.kind !== 'exact' && resolution.kind !== 'redirect') ||
      resolution.version !== version
    ) {
      continue;
    }
    let entry = byRealm.get(realmURL);
    if (!entry) {
      entry = { urls: new Set(), ranges: new Set() };
      byRealm.set(realmURL, entry);
    }
    entry.urls.add(url);
    entry.ranges.add(spec);
  }

  return [...byRealm.entries()]
    .map(([realmURL, { urls, ranges }]) => ({
      realmURL,
      urls: [...urls].sort(),
      ranges: [...ranges].sort(),
    }))
    .sort((a, b) => a.realmURL.localeCompare(b.realmURL));
}

export async function realmsToInvalidateOnPublish(options: {
  dbAdapter: DBAdapter;
  storeDir: string;
  // Store name, e.g. `experiments/greeter`.
  name: string;
  // The Version just published. Must already be in the store's meta — this
  // asks what the ranges resolve to NOW, which is only the right question
  // once the new Version is visible to the resolver.
  version: string;
}): Promise<RealmInvalidation[]> {
  let { dbAdapter, storeDir, name, version } = options;
  let meta = await readStoreMeta(storeDir, name);
  if (!meta) {
    return [];
  }

  // A coarse prefilter in SQL, exact parsing in JS. `LIKE` cannot express
  // "and the segment after the @ decodes to a range that resolves to this
  // version", and pretending otherwise in SQL would put the ruling in a
  // string literal. Note `_` is a LIKE wildcard, so `/_packages/` matches
  // slightly more than it reads — harmless, because `specFrom` re-checks the
  // literal marker on every row this returns.
  let rows = await dbAdapter.execute(
    `SELECT DISTINCT i.realm_url, i.url, d AS dep
       FROM boxel_index i, jsonb_array_elements_text(i.deps) d
      WHERE d LIKE $1
        AND i.is_deleted IS NOT TRUE`,
    { bind: [`%/_packages/${name}@%`] },
  );

  return selectInvalidations({
    rows: rows.map((row) => ({
      realmURL: row.realm_url as string,
      url: row.url as string,
      dep: row.dep as string,
    })),
    meta,
    name,
    version,
  });
}
