import type { Searchable } from 'https://cardstack.com/base/card-api';

// Shared route logic for `searchable`-driven search-doc depth. A route is a
// dotted field path rooted at a card's own link fields: `searchable: true`
// names the immediate ("self") link (a head-only route), a dotted path names
// the n+1 link reached through this field's target, and an array combines
// routes. Depth is governed ENTIRELY by the routes seeded from the card being
// indexed — a card pulled in as a link target never re-consults its own
// `searchable`; only the inherited route tails continue into it.
//
// Both the search-doc generator (`base/searchable.ts`, which reads the live
// `field.searchable` descriptor) and the query compiler's searchability check
// (`index-query-engine.ts`, which reads `FieldDefinition.searchable` from the
// loaderless definition cache) consult these helpers, so the check's notion of
// "this link is searchable" is exactly the generator's notion of "this link is
// expanded into the doc" — the two cannot drift.

// The routes a single field contributes from its `searchable` annotation. A
// route can only ever be a dotted field path, so a malformed value (a
// non-string array entry, or a non-string/non-array value) is tolerated as
// "contributes nothing" rather than emitting a junk route or throwing. An
// empty-string path names the field itself (same as `true`).
export function routesForField(
  fieldName: string,
  searchable: Searchable | undefined,
): string[] {
  if (searchable == null) {
    return [];
  }
  if (searchable === true) {
    return [fieldName]; // self link, no deeper
  }
  let paths =
    typeof searchable === 'string'
      ? [searchable]
      : Array.isArray(searchable)
        ? searchable
        : [];
  let routes: string[] = [];
  for (let path of paths) {
    if (typeof path !== 'string') {
      continue;
    }
    routes.push(path === '' ? fieldName : `${fieldName}.${path}`);
  }
  return routes;
}

// For `routes` rooted at the current card, find those whose head segment is
// `fieldName`. `matched` = the field is named by at least one route (so its
// link is expanded into the doc); `tails` = the non-empty remainders, which
// become the target's routes. An empty tail (a head-only route, e.g. from
// `searchable: true`) marks the link expanded-but-no-deeper and contributes no
// tail.
export function matchSearchableRoutes(
  routes: string[],
  fieldName: string,
): { matched: boolean; tails: string[] } {
  let matched = false;
  let tails: string[] = [];
  for (let route of routes) {
    let dot = route.indexOf('.');
    let head = dot === -1 ? route : route.slice(0, dot);
    if (head !== fieldName) {
      continue;
    }
    matched = true;
    if (dot !== -1) {
      tails.push(route.slice(dot + 1));
    }
  }
  return { matched, tails };
}
