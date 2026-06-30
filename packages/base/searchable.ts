import { rawArrayValues } from './watched-array';
import { isSavedInstance } from './-private';
import { isCardError, primitive, relativeTo } from '@cardstack/runtime-common';
import {
  getDataBucket,
  getFields,
  isLinkError,
  isLinkNotFound,
  isNonPresentLink,
  isNotLoadedValue,
  peekAtField,
} from './field-support';
import {
  createFromSerialized,
  getStore,
  queryableValue,
  resolveRef,
  type BaseDef,
  type BaseDefConstructor,
  type CardDef,
  type CardStore,
  type Field,
} from './card-api';

// ============================================================================
// Searchable-driven search-doc generation.
//
// The authoritative search-doc generator: it derives link depth from the
// explicit `field.searchable` annotation rather than from what the render
// happened to load into the store, and loads the named link targets itself
// (targeted loading) rather than relying on render-driven store residency.
//
// Routes are dotted paths rooted at the CURRENT card's link fields. Depth is
// governed ENTIRELY by the `searchable` annotations on the card being indexed
// (extended by their dotted paths): a card pulled in as a link target does NOT
// re-consult its own `searchable` — only the explicit route continues into it.
// `true` => the immediate ("self") link; `'a.b'` => the n+1 route a→b; an array
// combines routes. Cycle clipping, `{ id }` for unfollowed / broken / not-found
// links, and `linksToMany` id normalization match `BaseDef[queryableValue]`. The
// declared field type is enumerated for both links and contained values (not the
// runtime subtype), which drops non-queryable polymorphic-subtype bloat.
export async function searchDocFromFields(
  instance: CardDef,
  // Collects the URLs of the link targets pulled into the doc. The indexer
  // unions these into the card's tracked dependencies: an expanded target's
  // data lives in the search doc, so editing that target must reindex the
  // owner — whether or not the render happened to load it (a `{ id }`-only link
  // contributes none, since its target's data is not in the doc).
  dependencies: Set<string> = new Set(),
): Promise<Record<string, any>> {
  let routes = seedSearchableRoutes(
    instance.constructor as unknown as typeof BaseDef,
  );
  return (await searchableQueryableValue(
    instance.constructor as unknown as typeof BaseDef,
    instance,
    routes,
    [],
    getStore(instance),
    dependencies,
  )) as Record<string, any>;
}

// Build the route set rooted at the indexed card's own link fields. This is
// the ONLY place `field.searchable` is read — deeper recursion follows the
// inherited routes, never a pulled-in target's own annotations.
function seedSearchableRoutes(cardClass: typeof BaseDef): string[] {
  let routes: string[] = [];
  for (let [fieldName, field] of Object.entries(
    getFields(cardClass, { includeComputeds: true }),
  )) {
    let searchable = field?.searchable;
    if (searchable == null) {
      continue;
    }
    if (searchable === true) {
      routes.push(fieldName); // self link, no deeper
      continue;
    }
    // Tolerate a malformed annotation (a non-string array entry, a non-array
    // non-string value) rather than emitting a junk route or throwing: a route
    // can only ever be a dotted field path. An empty array contributes nothing.
    let paths =
      typeof searchable === 'string'
        ? [searchable]
        : Array.isArray(searchable)
          ? searchable
          : [];
    for (let path of paths) {
      if (typeof path !== 'string') {
        continue;
      }
      routes.push(path === '' ? fieldName : `${fieldName}.${path}`);
    }
  }
  return routes;
}

// For `routes` rooted at the current card, find those whose head segment is
// `fieldName`. `matched` = the field is named by at least one route (so a link
// is expanded); `tails` = the non-empty remainders, which become the target's
// routes. An empty tail (head-only route, e.g. from `searchable: true`) marks
// the link as expanded-but-no-deeper and contributes no tail.
function matchSearchableRoutes(
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

// Targeted load of a link target by reference: reuse a fully-deserialized
// resident instance when present, else load + deserialize the document (the
// same load path the lazy link getter uses). The store load is not itself
// dependency-tracked; callers record each expanded target in the `dependencies`
// set instead. Returns undefined if the target errors.
async function loadSearchableTarget(
  store: CardStore,
  reference: string,
): Promise<CardDef | undefined> {
  let resident = store.getCard(reference);
  if (resident && (resident as any)[isSavedInstance] === true) {
    return resident;
  }
  // A missing / broken target (or one that can't be loaded) degrades to
  // `{ id }` upstream. The
  // store may surface that either as a returned `CardError` or a thrown
  // rejection (e.g. a 404 / invalid-URL on the load path), so guard both.
  try {
    let cardDoc = await store.loadCardDocument(reference);
    if (isCardError(cardDoc)) {
      return undefined;
    }
    return (await createFromSerialized(
      cardDoc.data,
      cardDoc,
      cardDoc.data.id!,
      { store },
    )) as CardDef;
  } catch {
    return undefined;
  }
}

// Core recursion. `fieldCard` is the DECLARED type to enumerate; `value` is the
// runtime instance (a subtype's extra fields are dropped); `routes` are the
// dotted paths rooted at `value`'s fields; `stack` is the cycle guard.
async function searchableQueryableValue(
  fieldCard: typeof BaseDef,
  value: any,
  routes: string[],
  stack: BaseDef[],
  // Threaded from the indexed instance rather than re-derived per value: a
  // contained FieldDef value may not be store-associated, but its nested links
  // must still load against the owner's store.
  store: CardStore,
  dependencies: Set<string>,
): Promise<any> {
  if (primitive in fieldCard) {
    // Delegate to the field's own queryableValue. The default handles
    // serializer-backed primitives; a primitive FieldDef may override it to
    // shape its indexed form — e.g. JsonField returns null to stay out of the
    // search index. Reimplementing only the default here would drop that.
    return (
      fieldCard as unknown as {
        [queryableValue](value: any, stack: BaseDef[]): any;
      }
    )[queryableValue](value, stack);
  }
  if (value == null) {
    return null;
  }
  let valueId = (value as { id?: string }).id;
  // Cycle guard — identical to `BaseDef[queryableValue]`: object-identity and
  // id-based, so a re-entered card (even as a fresh object) clips to `{ id }`.
  if (
    stack.includes(value) ||
    (valueId != null &&
      stack.some((s) => (s as { id?: string }).id === valueId))
  ) {
    return { id: valueId };
  }
  let makeAbsoluteURL = (reference: string) =>
    value[relativeTo] ? resolveRef(reference, value[relativeTo]) : reference;
  let nextStack = [value, ...stack];
  let entries: [string, any][] = [];
  for (let [fieldName, field] of Object.entries(
    getFields(fieldCard, { includeComputeds: true }),
  )) {
    // Query-backed relationships can't be invalidated, so their value would
    // always be stale; they are omitted from the doc, matching `queryableValue`.
    if (field?.queryDefinition) {
      continue;
    }
    let { matched, tails } = matchSearchableRoutes(routes, fieldName);
    // Search-doc generation is a pure read: reading a declared relationship
    // through the getter writes `emptyValue` into the data bucket, which marks
    // an otherwise-unset link "used" and pulls it into the owner card's
    // serialized relationships. So peek a declared link only when it is already
    // materialized; an unmaterialized link holds no target and contributes
    // `null` either way. Contained values and computed fields read normally —
    // the getter's empty-value write is harmless for the former and absent for
    // the latter.
    let isDeclaredLink =
      (field!.fieldType === 'linksTo' || field!.fieldType === 'linksToMany') &&
      !field!.computeVia;
    let rawValue =
      isDeclaredLink && !getDataBucket(value).has(fieldName)
        ? null
        : peekAtField(value, fieldName);
    switch (field!.fieldType) {
      case 'contains': {
        entries.push([
          fieldName,
          await searchableQueryableValue(
            field!.card,
            rawValue,
            tails,
            nextStack,
            store,
            dependencies,
          ),
        ]);
        break;
      }
      case 'containsMany': {
        // A whole-field sentinel (e.g. a computed containsMany that consumes
        // an unresolved link) is not iterable; treat as null, the same as the
        // linksToMany branch below.
        if (rawValue == null || isNonPresentLink(rawValue)) {
          entries.push([fieldName, null]);
          break;
        }
        let items: any[] = [];
        for (let item of rawArrayValues(rawValue)) {
          if (item == null) {
            continue;
          }
          let v = await searchableQueryableValue(
            field!.card,
            item,
            tails,
            nextStack,
            store,
            dependencies,
          );
          if (v != null) {
            items.push(v);
          }
        }
        entries.push([fieldName, items.length === 0 ? null : items]);
        break;
      }
      case 'linksTo': {
        entries.push([
          fieldName,
          await searchableLink(
            field!,
            rawValue,
            matched,
            tails,
            nextStack,
            store,
            makeAbsoluteURL,
            dependencies,
          ),
        ]);
        break;
      }
      case 'linksToMany': {
        entries.push([
          fieldName,
          await searchableLinksToMany(
            field!,
            rawValue,
            matched,
            tails,
            nextStack,
            store,
            makeAbsoluteURL,
            dependencies,
          ),
        ]);
        break;
      }
    }
  }
  return Object.fromEntries(entries);
}

// A `linksTo` value: `{ id }` when the link isn't made searchable (or is
// broken / cannot be loaded); the expanded declared-type target when a route names
// it. Mirrors `LinksTo.queryableValue` + the `{ id }` sentinel handling.
async function searchableLink(
  field: Field<BaseDefConstructor>,
  rawValue: any,
  matched: boolean,
  tails: string[],
  stack: BaseDef[],
  store: CardStore,
  makeAbsoluteURL: (reference: string) => string,
  dependencies: Set<string>,
): Promise<any> {
  if (rawValue == null) {
    return null;
  }
  // A broken / not-found link can't be expanded — keep its reference as `{ id }`.
  if (isLinkError(rawValue) || isLinkNotFound(rawValue)) {
    return { id: makeAbsoluteURL(rawValue.reference) };
  }
  if (!matched) {
    return {
      id: makeAbsoluteURL(
        isNotLoadedValue(rawValue)
          ? rawValue.reference
          : (rawValue as CardDef).id,
      ),
    };
  }
  let target = rawValue as CardDef;
  if (isNotLoadedValue(rawValue)) {
    // Resolve a relative reference (e.g. `./hassan`) against the owner's
    // `relativeTo` before the store lookup/load — the same as the lazy link
    // getter. The store can't `toURL` a relative string, which would otherwise
    // degrade an expandable searchable link to `{ id }`.
    let resolvedRef = makeAbsoluteURL(rawValue.reference);
    let loaded = await loadSearchableTarget(store, resolvedRef);
    if (loaded == null) {
      return { id: resolvedRef };
    }
    target = loaded;
  }
  // The expanded target's data is now in the doc, so it is a dependency of the
  // indexed card.
  if (target.id != null) {
    dependencies.add(makeAbsoluteURL(target.id));
  }
  return await searchableQueryableValue(
    field.card,
    target,
    tails,
    stack,
    store,
    dependencies,
  );
}

// A `linksToMany` value: per-slot `{ id }` / expansion, with the absolute-URL
// id normalization `LinksToMany.queryableValue` applies.
async function searchableLinksToMany(
  field: Field<BaseDefConstructor>,
  rawValue: any,
  matched: boolean,
  tails: string[],
  stack: BaseDef[],
  store: CardStore,
  makeAbsoluteURL: (reference: string) => string,
  dependencies: Set<string>,
): Promise<any[] | null> {
  // A whole-field sentinel (errored/unresolved plural) is not iterable; treat
  // as empty, same as `LinksToMany.queryableValue`.
  if (rawValue == null || isNonPresentLink(rawValue)) {
    return null;
  }
  let out: any[] = [];
  for (let item of rawArrayValues(rawValue)) {
    if (item == null) {
      continue;
    }
    if (isLinkError(item) || isLinkNotFound(item)) {
      out.push({ id: makeAbsoluteURL(item.reference) });
      continue;
    }
    if (!matched) {
      out.push({
        id: makeAbsoluteURL(
          isNotLoadedValue(item) ? item.reference : (item as CardDef).id,
        ),
      });
      continue;
    }
    let target = item as CardDef;
    if (isNotLoadedValue(item)) {
      // Resolve a relative reference before the load — see `searchableLink`.
      let resolvedRef = makeAbsoluteURL(item.reference);
      let loaded = await loadSearchableTarget(store, resolvedRef);
      if (loaded == null) {
        out.push({ id: resolvedRef });
        continue;
      }
      target = loaded;
    }
    // The expanded target's data is now in the doc, so it is a dependency of
    // the indexed card.
    if (target.id != null) {
      dependencies.add(makeAbsoluteURL(target.id));
    }
    let expanded = await searchableQueryableValue(
      field.card,
      target,
      tails,
      stack,
      store,
      dependencies,
    );
    if (expanded != null) {
      out.push(
        expanded.id != null
          ? { ...expanded, id: makeAbsoluteURL(expanded.id) }
          : expanded,
      );
    }
  }
  return out.length === 0 ? null : out;
}
