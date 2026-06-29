// Reverse-engineer `searchable` annotations from the live search docs in
// `boxel_index`. This module is the exact INVERSE of the searchable-driven
// generator (`packages/base/searchable.ts`): given the search doc a card's
// store-driven render produced, it derives the minimal `searchable` that the
// new generator needs to reproduce that same depth.
//
// It is intentionally SCHEMA-FREE — it reads only the stored JSON, never the
// field definitions — because the deployed `modules` definition cache is a
// sparse, RAM-backed cache that most realms have no entry in. The search doc
// alone carries the full depth signal, and its shape lets us classify every
// value without a schema:
//
//   * a relationship that was NOT pulled in is stored as `{ id }` only;
//   * a relationship that WAS pulled in is stored as `{ id, ...fields }`;
//   * a contained value is a nested object/array with NO `id` (FieldDef
//     instances carry no id) and is ALWAYS present regardless of `searchable`.
//
// So: an object with an `id` key is a link; without one, a contained value.
// Routes are dotted paths rooted at the indexed card's own fields, matching
// `seedSearchableRoutes`/`matchSearchableRoutes` in the generator. We union
// the routes observed across every instance of a card def (different instances
// expose different nested data; we want the maximal observed depth), then
// reduce each field's routes to the minimal `Searchable`.
//
// Resolving routes against the declared link types (dropping the unqueryable
// polymorphic-subtype expansion of §4) and defaulting zero-instance defs to
// `searchable: true` are NOT done here — they need the source schema and are
// handled in the apply/rewrite phase. This module only turns observed docs
// into observed routes.

// Mirror of `Searchable` in packages/base/card-api.gts. Redeclared locally so
// this module stays dependency-free and unit-testable in isolation.
export type Searchable = true | string | string[];

// A search-doc object key that is structural metadata, not a card field:
//   * `id`     — a link/card's identity, never a routable field (and a scalar
//                anyway, so it produces no route — excluded for clarity);
//   * `_*`     — store-driven serialization artifacts (e.g. `_cardType`) that
//                are not declared fields. Excluding them keeps an object whose
//                only "extra" key is meta from being mistaken for an expanded
//                link with content.
function isMetaKey(key: string): boolean {
  return key === 'id' || key.startsWith('_');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A link value (the queryable value of a linksTo / a linksToMany slot) is the
// only nested object that carries an `id`. Contained FieldDef values never do.
function isLinkObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && 'id' in value;
}

// A link is "expanded" (its target was pulled into the doc) when it carries at
// least one real field beyond its identity. `{ id }` alone — or `{ id, _meta }`
// — is the unfollowed/broken/cycle-clipped sentinel and is NOT expanded.
function isExpandedLink(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((k) => !isMetaKey(k));
}

// Collect the dotted routes rooted at the fields of `node` (a card or a
// contained composite, viewed as its search-doc object). A route is emitted
// only where a LINK was pulled in — contained values carry no link signal of
// their own, they only serve as path segments toward a deeper link.
function collectRoutesForNode(node: Record<string, unknown>): string[] {
  let routes: string[] = [];
  for (let [key, value] of Object.entries(node)) {
    if (isMetaKey(key)) {
      continue;
    }
    routes.push(...routesForFieldValue(key, value));
  }
  return routes;
}

function routesForFieldValue(field: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return routesForArray(field, value);
  }
  if (isLinkObject(value)) {
    return routesForLink(field, value);
  }
  if (isPlainObject(value)) {
    // A contained composite (contains): always in the doc, no `id`. It emits no
    // route of its own; it only forwards deeper link routes, prefixed by its
    // field name (the `signOff.editor` shape from §4).
    return collectRoutesForNode(value).map((tail) => `${field}.${tail}`);
  }
  // Scalar (string / number / boolean / null) or a primitive contains/
  // containsMany — no link beneath it.
  return [];
}

function routesForLink(field: string, link: Record<string, unknown>): string[] {
  if (!isExpandedLink(link)) {
    // `{ id }` only — the link was not made searchable. Reproduced by the
    // shallow default, so no annotation.
    return [];
  }
  let deeper = collectRoutesForNode(link);
  if (deeper.length === 0) {
    // Expanded but none of its own links were pulled in → the immediate
    // ("self") link. There is no dotted path for "this link", so: `true`.
    return [field];
  }
  return deeper.map((tail) => `${field}.${tail}`);
}

function routesForArray(field: string, items: unknown[]): string[] {
  // Distinguish a linksToMany (items carry `id`) from a containsMany-of-
  // composites (items don't) by inspecting the items present. An array of
  // scalars (containsMany of a primitive) yields nothing. Empty / all-null
  // arrays carry no signal — same as a non-present plural in the generator.
  let objectItems = items.filter(isPlainObject);
  if (objectItems.length === 0) {
    return [];
  }
  let linkItems = objectItems.filter(isLinkObject);

  if (linkItems.length > 0) {
    // linksToMany. Union the slot routes; a slot is "expanded" iff it has
    // content beyond its id. If any slot was expanded but none exposed a
    // deeper link, the field itself is the (self) route.
    let deeper = new Set<string>();
    let anyExpanded = false;
    for (let item of linkItems) {
      if (!isExpandedLink(item)) {
        continue;
      }
      anyExpanded = true;
      for (let tail of collectRoutesForNode(item)) {
        deeper.add(tail);
      }
    }
    if (!anyExpanded) {
      return [];
    }
    if (deeper.size === 0) {
      return [field];
    }
    return [...deeper].map((tail) => `${field}.${tail}`);
  }

  // containsMany of composites: always included, forwards deeper link routes
  // unioned across items.
  let deeper = new Set<string>();
  for (let item of objectItems) {
    for (let tail of collectRoutesForNode(item)) {
      deeper.add(tail);
    }
  }
  return [...deeper].map((tail) => `${field}.${tail}`);
}

// Public: the routes a single instance's search doc implies.
export function routesForSearchDoc(searchDoc: unknown): string[] {
  if (!isPlainObject(searchDoc)) {
    return [];
  }
  return collectRoutesForNode(searchDoc);
}

// Reduce a union of dotted routes (rooted at one card def's fields) to the
// minimal `Searchable` per field. A field with only a bare self route → `true`;
// a field with deeper routes → those paths (a self route is subsumed by any
// deeper route, exactly as `matchSearchableRoutes` treats them, so it is
// dropped). Deeper paths are sorted for stable, diff-friendly output.
export function routesToFieldSearchable(
  routes: Iterable<string>,
): Record<string, Searchable> {
  let tailsByField = new Map<string, Set<string>>();
  for (let route of routes) {
    let dot = route.indexOf('.');
    let head = dot === -1 ? route : route.slice(0, dot);
    let tail = dot === -1 ? '' : route.slice(dot + 1);
    let tails = tailsByField.get(head);
    if (!tails) {
      tails = new Set();
      tailsByField.set(head, tails);
    }
    tails.add(tail);
  }

  let result: Record<string, Searchable> = {};
  for (let [field, tails] of tailsByField) {
    let deeper = [...tails].filter((t) => t !== '').sort();
    if (deeper.length === 0) {
      result[field] = true;
    } else if (deeper.length === 1) {
      result[field] = deeper[0];
    } else {
      result[field] = deeper;
    }
  }
  return result;
}

// What the codemod derives for one card def from all its observed instances.
export interface DerivedDef {
  // The card def's internal key (`<moduleURL>/<ExportName>`), as stored in
  // `boxel_index.types[0]`.
  defKey: string;
  // The realm the instances were observed in (the `realm_url` column). Used by
  // the apply phase to map the def back to a source file.
  realmURL: string;
  // Minimal `searchable` per relationship/contained field. Empty when every
  // relationship stayed `{ id }` (the shallow default already reproduces it).
  fields: Record<string, Searchable>;
  // The raw union of dotted routes observed for this def, sorted. Carried so the
  // apply phase can union a def's routes ACROSS environments (a shared
  // base/catalog def is observed in both staging and prod) before reducing to
  // the minimal `searchable` once. `fields` is just `routesToFieldSearchable`
  // of these routes for this single environment's convenience.
  routes: string[];
  // How many instances contributed (diagnostics / report only).
  instanceCount: number;
}

// Streaming accumulator: feed it every `(defKey, realmURL, searchDoc)` instance
// row and it unions the routes per def. Defs that never appear here have zero
// indexed instances — the apply phase defaults their relationship fields to
// `searchable: true` (depth-1) for resilience (§6).
export class DerivationAccumulator {
  // defKey -> { realmURL, routes, count }
  #byDef = new Map<
    string,
    { realmURL: string; routes: Set<string>; count: number }
  >();

  add(defKey: string, realmURL: string, searchDoc: unknown): void {
    let entry = this.#byDef.get(defKey);
    if (!entry) {
      entry = { realmURL, routes: new Set(), count: 0 };
      this.#byDef.set(defKey, entry);
    }
    entry.count += 1;
    for (let route of routesForSearchDoc(searchDoc)) {
      entry.routes.add(route);
    }
  }

  // Every def that contributed at least one instance.
  results(): DerivedDef[] {
    let out: DerivedDef[] = [];
    for (let [defKey, { realmURL, routes, count }] of this.#byDef) {
      out.push({
        defKey,
        realmURL,
        fields: routesToFieldSearchable(routes),
        routes: [...routes].sort(),
        instanceCount: count,
      });
    }
    out.sort((a, b) => a.defKey.localeCompare(b.defKey));
    return out;
  }

  hasInstances(defKey: string): boolean {
    return this.#byDef.has(defKey);
  }
}
