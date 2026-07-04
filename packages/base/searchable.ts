import { rawArrayValues } from './watched-array';
import { isSavedInstance } from './-private';
import {
  isCardError,
  matchSearchableRoutes,
  primitive,
  relativeTo,
  routesForField,
  type SerializedError,
} from '@cardstack/runtime-common';
import {
  getDataBucket,
  getFields,
  isLinkError,
  isLinkNotFound,
  isNonPresentLink,
  isNotLoadedValue,
  peekAtField,
  type LinkErrorValue,
  type LinkNotFoundValue,
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
// inherited routes (via `matchSearchableRoutes`), never a pulled-in target's
// own annotations.
function seedSearchableRoutes(cardClass: typeof BaseDef): string[] {
  let routes: string[] = [];
  for (let [fieldName, field] of Object.entries(
    getFields(cardClass, { includeComputeds: true }),
  )) {
    routes.push(...routesForField(fieldName, field?.searchable));
  }
  return routes;
}

// Outcome of loading a searchable link target: the deserialized card, or the
// terminal sentinel a failed load resolves to. A broken searchable link is
// captured as `{ id }` in the doc AND recorded so the caller can plant the
// sentinel on the owner's field — the diagnostic `getBrokenLinks` reads.
type SearchableTargetResult =
  | { status: 'loaded'; card: CardDef }
  | { status: 'broken'; sentinel: LinkErrorValue | LinkNotFoundValue };

// Build the terminal sentinel a broken link resolves to, mirroring the shape
// `lazilyLoadLink` plants: HTTP 404 → `link-not-found`, anything else →
// `link-error`. `reference` is the resolved (absolute) target url.
function brokenLinkSentinel(
  reference: string,
  err: unknown,
): LinkErrorValue | LinkNotFoundValue {
  let status = Number((err as { status?: unknown })?.status);
  let message =
    (err as { message?: unknown })?.message != null
      ? String((err as { message?: unknown }).message)
      : `unable to load ${reference}`;
  let isMissing =
    status === 404 || /not found/i.test(message) || /missing/i.test(message);
  let errorDoc: SerializedError = {
    status: Number.isFinite(status) ? status : isMissing ? 404 : 500,
    title: isMissing ? 'Link Not Found' : 'Link Error',
    message,
    additionalErrors: null,
  };
  return isMissing
    ? { type: 'link-not-found', reference, errorDoc }
    : { type: 'link-error', reference, errorDoc };
}

// Targeted load of a link target by reference: reuse a fully-deserialized
// resident instance when present, else load + deserialize the document (the
// same load path the lazy link getter uses). The store load is not itself
// dependency-tracked; callers record each expanded target in the `dependencies`
// set instead. A missing / broken target resolves to a terminal sentinel; the
// store may surface that either as a returned `CardError` or a thrown rejection
// (e.g. a 404 / invalid-URL on the load path), so both are captured.
async function loadSearchableTarget(
  store: CardStore,
  reference: string,
): Promise<SearchableTargetResult> {
  let resident = store.getCard(reference);
  if (resident && (resident as any)[isSavedInstance] === true) {
    return { status: 'loaded', card: resident };
  }
  try {
    let cardDoc = await store.loadCardDocument(reference);
    if (isCardError(cardDoc)) {
      return {
        status: 'broken',
        sentinel: brokenLinkSentinel(reference, cardDoc),
      };
    }
    return {
      status: 'loaded',
      card: (await createFromSerialized(
        cardDoc.data,
        cardDoc,
        cardDoc.data.id!,
        { store },
      )) as CardDef,
    };
  } catch (err) {
    return { status: 'broken', sentinel: brokenLinkSentinel(reference, err) };
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
            value,
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
  owner: any,
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
  // A searchable target stays a dependency even when broken: recording it
  // reindexes the card (clearing the `{ id }` / brokenLinks diagnostic) once the
  // target becomes reachable, mirroring the successful-expansion dep below. This
  // branch also covers a prior settle pass having planted the sentinel, so the
  // authoritative generation reaches it here instead of the load branch below.
  if (isLinkError(rawValue) || isLinkNotFound(rawValue)) {
    let reference = makeAbsoluteURL(rawValue.reference);
    if (matched) {
      dependencies.add(reference);
    }
    return { id: reference };
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
    let result = await loadSearchableTarget(store, resolvedRef);
    if (result.status === 'broken') {
      // Plant the terminal sentinel on the owner's field so `getBrokenLinks`
      // (which reads terminal sentinels from the data bucket) records this
      // broken searchable link. This mirrors the sentinel `lazilyLoadLink`
      // plants during a template render; search-doc generation plants its own
      // because it drives the link load directly rather than through a template.
      getDataBucket(owner).set(field.name, result.sentinel);
      // A broken searchable target is still a dependency — see the sentinel
      // branch above.
      dependencies.add(resolvedRef);
      return { id: resolvedRef };
    }
    target = result.card;
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
// id normalization `LinksToMany.queryableValue` applies. A broken searchable
// slot is planted back into the backing array (which lives in the owner's data
// bucket) so `getBrokenLinks` records it — see `searchableLink`.
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
  let backing = rawArrayValues(rawValue);
  for (let [index, item] of backing.entries()) {
    if (item == null) {
      continue;
    }
    if (isLinkError(item) || isLinkNotFound(item)) {
      let reference = makeAbsoluteURL(item.reference);
      // A broken searchable element stays a dependency — see `searchableLink`.
      if (matched) {
        dependencies.add(reference);
      }
      out.push({ id: reference });
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
      let result = await loadSearchableTarget(store, resolvedRef);
      if (result.status === 'broken') {
        // Plant the sentinel into the failed slot so `getBrokenLinks` records
        // this broken searchable element (see `searchableLink`). Assign through
        // the proxy so the mutation reaches the data bucket the diagnostic
        // reads.
        rawValue[index] = result.sentinel;
        // A broken searchable element stays a dependency — see `searchableLink`.
        dependencies.add(resolvedRef);
        out.push({ id: resolvedRef });
        continue;
      }
      target = result.card;
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
