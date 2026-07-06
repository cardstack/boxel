import { isEqual } from 'lodash-es';

import { canonicalModuleKey, getField, identifyCard } from './code-ref.ts';
import {
  isAnyFilter,
  isCardTypeFilter,
  isEveryFilter,
  isInFilter,
  isMatchesFilter,
  isNotFilter,
  isRangeFilter,
  isReferenceFilterField,
  type Filter,
  type RangeFilterValue,
  type RangeOperator,
  type Sort,
} from './query.ts';

import type { CodeRef } from './code-ref.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type {
  BaseDef,
  CardDef,
  Field,
} from 'https://cardstack.com/base/card-api';

// The client-side counterpart to the server's `filterCondition()` /
// `orderExpression()` in `index-query-engine.ts`. Those compile a `Query` to
// SQL that runs against the flattened `search_doc`; the primitives here
// evaluate the same `Filter` / `Sort` against a hydrated card-api instance by
// reading its field values through the card-api module.
//
// A leaf comparison is kept faithful to the server by computing the field's
// queryable value (`getQueryableValue`) and formatting the filter's value the
// same way the server binds its parameters (`formatQueryValue`) before
// comparing — i.e. both sides pass through the field's serializer, exactly as
// they do in `handleFieldValue`.

// The slice of the card-api module the matcher and comparator depend on. Card
// instances are loaded at runtime, so the module is injected rather than
// imported — runtime-common has no static dependency on `base/card-api`.
export interface CardAPIForMatching {
  getQueryableValue(fieldOrCard: any, value: any, stack?: BaseDef[]): any;
  formatQueryValue(field: Field<any>, queryValue: any): any;
  peekAtField(instance: BaseDef, fieldName: string): any;
  isNonPresentLink(value: any): boolean;
  getCardMeta(
    card: BaseDef,
    metaKey: 'lastModified' | 'resourceCreatedAt',
  ): any;
  primitive: symbol;
  // Resolves a module reference's URL aliases so a type gate compares refs by
  // their resolved identity rather than raw spelling. The server tolerates
  // equivalent spellings (RRI / real-URL / virtual-alias) via `internalKeyFor`
  // in index-query-engine.ts; this is the client-side counterpart, and without
  // it a type-gated filter drops a server-returned instance whose class was
  // identified under a different-but-equivalent module spelling.
  virtualNetwork: VirtualNetwork;
}

// Three-valued result, deliberately not a boolean. The integration layer needs
// to tell "the instance fails the filter" apart from "the filter can't be
// evaluated from loaded state" (e.g. a `linksTo` target absent from the Store),
// so it never removes a server-returned card on the basis of a predicate it
// couldn't actually resolve.
export type MatchResult = 'match' | 'no-match' | 'unresolvable';

const GENERAL_SORT_FIELDS = new Set(['lastModified', 'createdAt', 'cardURL']);

// Operators the matcher can replicate in JS. `matches` (full-text) and any
// operator not in this set force the caller to fall back to server-only
// evaluation.
export function isClientEvaluable(filter: Filter): boolean {
  if (isMatchesFilter(filter)) {
    return false;
  }
  if (isAnyFilter(filter)) {
    return filter.any.every(isClientEvaluable);
  }
  if (isEveryFilter(filter)) {
    return filter.every.every(isClientEvaluable);
  }
  if (isNotFilter(filter)) {
    return isClientEvaluable(filter.not);
  }
  if (
    'eq' in filter ||
    isInFilter(filter) ||
    'contains' in filter ||
    isRangeFilter(filter) ||
    isCardTypeFilter(filter)
  ) {
    return true;
  }
  // Unknown / non-replicable operator.
  return false;
}

export function matchInstanceAgainstFilter(
  instance: CardDef,
  filter: Filter,
  api: CardAPIForMatching,
): MatchResult {
  // A node may carry an `on`/`type` that gates which instances the predicate
  // applies to, mirroring the server's `every([typeCondition, …])` wrapping.
  // `on` takes precedence over `type` for the gate, matching `filterCondition`.
  let onProp = 'on' in filter ? filter.on : undefined;
  let typeRef = (filter as { type?: CodeRef }).type;
  let typeGate: CodeRef | undefined = onProp ?? typeRef;

  // Pure card-type filter — `{ type }` with no other predicate. A node that
  // carries `type` *and* an operator (e.g. `{ type, eq }`) is not pure; there
  // `type` only gates, exactly as the server treats it.
  if (typeRef && Object.keys(filter).length === 1) {
    return instanceIsType(instance, typeRef, api) ? 'match' : 'no-match';
  }

  // Any other node with an `on`/`type` is gated: if the instance isn't of that
  // type the whole node is a no-match before we look at fields.
  if (typeGate && !instanceIsType(instance, typeGate, api)) {
    return 'no-match';
  }

  if (isEveryFilter(filter)) {
    return combineAnd(
      filter.every.map((f) => matchInstanceAgainstFilter(instance, f, api)),
    );
  }
  if (isAnyFilter(filter)) {
    return combineOr(
      filter.any.map((f) => matchInstanceAgainstFilter(instance, f, api)),
    );
  }
  if (isNotFilter(filter)) {
    return negate(matchInstanceAgainstFilter(instance, filter.not, api));
  }
  if ('eq' in filter) {
    return combineAnd(
      Object.entries(filter.eq).map(([path, value]) =>
        matchEq(instance, path, value, api),
      ),
    );
  }
  if (isInFilter(filter)) {
    return combineAnd(
      Object.entries(filter.in).map(([path, values]) =>
        matchIn(instance, path, values as any[], api),
      ),
    );
  }
  if ('contains' in filter) {
    return combineAnd(
      Object.entries(filter.contains).map(([path, value]) =>
        matchContains(instance, path, value, api),
      ),
    );
  }
  if (isRangeFilter(filter)) {
    return combineAnd(
      Object.entries(filter.range).map(([path, constraints]) =>
        matchRange(instance, path, constraints as RangeFilterValue, api),
      ),
    );
  }

  // A `matches` filter, or anything else, isn't client-evaluable. Callers are
  // expected to gate on `isClientEvaluable` first; treat as unresolvable rather
  // than silently failing.
  return 'unresolvable';
}

// -- field path resolution ---------------------------------------------------

interface PathResolution {
  // Queryable leaf values gathered across every resolvable branch of the path.
  // Plural fields fan out, so this can hold more than one value even for a
  // single starting instance — predicates match existentially over it.
  values: any[];
  // The leaf field definition, used to format the filter's value through the
  // same serializer. Undefined when the path doesn't resolve to a field on the
  // instance's type.
  leafField: Field<any> | undefined;
  // True if some branch couldn't be followed from loaded state (a `linksTo` /
  // `linksToMany` target not in the Store). Lets predicates report
  // `unresolvable` instead of a false `no-match`.
  sawUnresolvable: boolean;
}

function resolvePath(
  instance: BaseDef,
  path: string,
  api: CardAPIForMatching,
): PathResolution {
  let segments = path.split('.');
  let nodes: BaseDef[] = [instance];

  // Walk interior segments, descending into contained / linked instances.
  let sawUnresolvable = false;
  // Count branches that bottom out at a null/unset interior segment. The
  // server's JSON-path traversal yields a NULL leaf in that case (e.g.
  // `search_doc -> 'bestFriend' -> 'name'` with `bestFriend` null is SQL
  // NULL), so each such branch contributes one `null` leaf value below — only
  // a null-valued predicate (`eq`/`in`/`contains` null) can match it.
  let nullLeafCount = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    let segment = segments[i];
    let next: BaseDef[] = [];
    for (let node of nodes) {
      if (node == null) {
        continue;
      }
      let field = getField(node, segment);
      if (!field) {
        // Field absent on this (possibly polymorphic) instance — this branch
        // contributes no values.
        continue;
      }
      let raw = api.peekAtField(node, segment);
      let isPlural =
        field.fieldType === 'containsMany' || field.fieldType === 'linksToMany';
      let isPrimitiveCard = (api.primitive as any) in field.card;
      // Can't traverse deeper into a primitive value.
      if (isPrimitiveCard) {
        continue;
      }
      let elements = isPlural ? (Array.isArray(raw) ? raw : []) : [raw];
      for (let element of elements) {
        if (api.isNonPresentLink(element)) {
          // A not-loaded link can't be followed — distinct from present-and-null.
          sawUnresolvable = true;
          continue;
        }
        if (element == null) {
          nullLeafCount++;
          continue;
        }
        next.push(element);
      }
    }
    nodes = next;
  }

  // Leaf segment.
  let leaf = segments[segments.length - 1];
  let values: any[] = [];
  let leafField: Field<any> | undefined;
  for (let i = 0; i < nullLeafCount; i++) {
    values.push(null);
  }
  for (let node of nodes) {
    if (node == null) {
      continue;
    }
    let field = getField(node, leaf);
    if (!field) {
      continue;
    }
    leafField = field;
    let raw = api.peekAtField(node, leaf);
    let queryable = api.getQueryableValue(field, raw);
    let isPlural =
      field.fieldType === 'containsMany' || field.fieldType === 'linksToMany';
    if (isPlural && Array.isArray(queryable)) {
      values.push(...queryable);
    } else {
      values.push(queryable);
    }
  }

  return { values, leafField, sawUnresolvable };
}

// All equivalent spellings (RRI-prefix / real-URL / virtual-alias) of a
// reference value. A registered-prefix RRI is first resolved to its real URL so
// `equivalentURLForms` can enumerate the set; anything else is expanded as-is.
function referenceForms(
  value: unknown,
  virtualNetwork: VirtualNetwork,
): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  let forms = new Set<string>([value]);
  try {
    let url = virtualNetwork.isRegisteredPrefix(value)
      ? virtualNetwork.toURL(value).href
      : value;
    for (let form of virtualNetwork.equivalentURLForms(url)) {
      forms.add(form);
    }
  } catch {
    // Unresolvable (e.g. a bare local id or an unmapped prefix) — compare as-is.
  }
  return [...forms];
}

// Compare a resolved leaf value against a formatted filter value. For reference
// leaves (`id` / `url`) the comparison is spelling-tolerant: a card whose id is
// stored in URL form matches a filter value in canonical RRI (prefix) form, and
// vice versa. Non-reference leaves use exact equality, as before.
function leafMatches(
  leafValue: unknown,
  filterValue: unknown,
  path: string,
  virtualNetwork: VirtualNetwork,
): boolean {
  if (isEqual(leafValue, filterValue)) {
    return true;
  }
  if (
    isReferenceFilterField(path) &&
    typeof leafValue === 'string' &&
    typeof filterValue === 'string'
  ) {
    let leafForms = new Set(referenceForms(leafValue, virtualNetwork));
    return referenceForms(filterValue, virtualNetwork).some((form) =>
      leafForms.has(form),
    );
  }
  return false;
}

// -- per-operator predicates -------------------------------------------------

function matchEq(
  instance: BaseDef,
  path: string,
  value: any,
  api: CardAPIForMatching,
): MatchResult {
  let { values, leafField, sawUnresolvable } = resolvePath(instance, path, api);
  // `eq: null` compiles to `IS NULL` on the server, which matches a field whose
  // queryable value is null/absent.
  if (value === null) {
    return existential(values, sawUnresolvable, (lv) => lv == null);
  }
  let formatted = formatValue(leafField, value, api);
  return existential(values, sawUnresolvable, (leafValue) =>
    leafMatches(leafValue, formatted, path, api.virtualNetwork),
  );
}

function matchIn(
  instance: BaseDef,
  path: string,
  rawValues: any[],
  api: CardAPIForMatching,
): MatchResult {
  // The server compiles an empty `in` list to FALSE.
  if (rawValues.length === 0) {
    return 'no-match';
  }
  let { values, leafField, sawUnresolvable } = resolvePath(instance, path, api);
  let hasNull = rawValues.some((v) => v === null);
  let formatted = rawValues
    .filter((v) => v !== null)
    .map((v) => formatValue(leafField, v, api));
  return existential(
    values,
    sawUnresolvable,
    (leafValue) =>
      (hasNull && leafValue == null) ||
      formatted.some((fv) =>
        leafMatches(leafValue, fv, path, api.virtualNetwork),
      ),
  );
}

function matchContains(
  instance: BaseDef,
  path: string,
  value: any,
  api: CardAPIForMatching,
): MatchResult {
  let { values, leafField, sawUnresolvable } = resolvePath(instance, path, api);
  // Server treats `contains: null` like `eq: null` (IS NULL).
  if (value === null) {
    return existential(values, sawUnresolvable, (lv) => lv == null);
  }
  let formatted = formatValue(leafField, value, api);
  let needle = String(formatted).toLowerCase();
  // Mirrors the server's case-insensitive `ILIKE %value%` substring match.
  return existential(
    values,
    sawUnresolvable,
    (lv) => typeof lv === 'string' && lv.toLowerCase().includes(needle),
  );
}

function matchRange(
  instance: BaseDef,
  path: string,
  constraints: RangeFilterValue,
  api: CardAPIForMatching,
): MatchResult {
  let { values, leafField, sawUnresolvable } = resolvePath(instance, path, api);
  let formattedConstraints = Object.entries(constraints).map(
    ([operator, bound]) => {
      if (bound == null) {
        throw new Error(`'null' is not a permitted value in a 'range' filter`);
      }
      return [
        operator as RangeOperator,
        formatValue(leafField, bound, api),
      ] as [RangeOperator, any];
    },
  );
  return existential(values, sawUnresolvable, (leafValue) => {
    if (leafValue == null) {
      return false;
    }
    return formattedConstraints.every(([operator, bound]) =>
      compareRange(leafValue, operator, bound),
    );
  });
}

function compareRange(
  value: any,
  operator: RangeOperator,
  bound: any,
): boolean {
  switch (operator) {
    case 'gt':
      return value > bound;
    case 'gte':
      return value >= bound;
    case 'lt':
      return value < bound;
    case 'lte':
      return value <= bound;
  }
}

// -- helpers -----------------------------------------------------------------

function formatValue(
  leafField: Field<any> | undefined,
  value: any,
  api: CardAPIForMatching,
): any {
  if (!leafField || value == null) {
    return value;
  }
  return api.formatQueryValue(leafField, value);
}

function existential(
  values: any[],
  sawUnresolvable: boolean,
  predicate: (value: any) => boolean,
): MatchResult {
  if (values.some(predicate)) {
    return 'match';
  }
  return sawUnresolvable ? 'unresolvable' : 'no-match';
}

function combineAnd(results: MatchResult[]): MatchResult {
  if (results.some((r) => r === 'no-match')) {
    return 'no-match';
  }
  if (results.some((r) => r === 'unresolvable')) {
    return 'unresolvable';
  }
  return 'match';
}

function combineOr(results: MatchResult[]): MatchResult {
  if (results.some((r) => r === 'match')) {
    return 'match';
  }
  if (results.some((r) => r === 'unresolvable')) {
    return 'unresolvable';
  }
  return 'no-match';
}

function negate(result: MatchResult): MatchResult {
  if (result === 'match') {
    return 'no-match';
  }
  if (result === 'no-match') {
    return 'match';
  }
  return 'unresolvable';
}

function instanceIsType(
  instance: BaseDef,
  ref: CodeRef,
  api: CardAPIForMatching,
): boolean {
  let klass: typeof BaseDef | null =
    (instance.constructor as typeof BaseDef) ?? null;
  while (klass) {
    let codeRef = identifyCard(klass);
    if (codeRef && codeRefEquals(codeRef, ref, api.virtualNetwork)) {
      return true;
    }
    klass = Object.getPrototypeOf(klass) as typeof BaseDef | null;
  }
  return false;
}

function codeRefEquals(
  a: CodeRef,
  b: CodeRef,
  virtualNetwork: VirtualNetwork,
): boolean {
  if (a && b && 'module' in a && 'name' in a && 'module' in b && 'name' in b) {
    if (a.name !== b.name) {
      return false;
    }
    if (a.module === b.module) {
      return true;
    }
    // The class is identified under the module spelling it was loaded from,
    // while the filter ref can carry an equivalent spelling (prefix RRI /
    // real-URL / virtual-alias). Reduce both to a single canonical key before
    // comparing so the type gate doesn't drop an instance over a cosmetic URL
    // difference — the tolerance the server applies in `internalKeyFor`.
    return (
      canonicalModuleKey(a.module, virtualNetwork) ===
      canonicalModuleKey(b.module, virtualNetwork)
    );
  }
  return isEqual(a, b);
}

// -- sort comparator ---------------------------------------------------------

// Produces a comparator over instances that mirrors the server's ORDER BY:
// each sort key in turn, NULLS LAST (independent of direction), with the card
// URL (id) as the final, ascending tiebreak for deterministic ordering.
export function makeInstanceComparator(
  sort: Sort | undefined,
  api: CardAPIForMatching,
): (a: CardDef, b: CardDef) => number {
  return (a: CardDef, b: CardDef) => {
    for (let expression of sort ?? []) {
      let direction = expression.direction === 'desc' ? -1 : 1;
      let valueA = sortValue(a, expression, api);
      let valueB = sortValue(b, expression, api);
      let nullA = valueA == null;
      let nullB = valueB == null;
      if (nullA && nullB) {
        continue;
      }
      // NULLS LAST regardless of direction.
      if (nullA) {
        return 1;
      }
      if (nullB) {
        return -1;
      }
      let base = rawCompare(valueA, valueB);
      if (base !== 0) {
        return base * direction;
      }
    }
    // Final deterministic tiebreak on the card URL, ascending.
    return rawCompare(a.id, b.id);
  };
}

function sortValue(
  instance: CardDef,
  expression: Sort[number],
  api: CardAPIForMatching,
): any {
  if ('on' in expression && expression.on) {
    let { values } = resolvePath(instance, expression.by, api);
    return values.find((v) => v != null) ?? null;
  }
  switch (expression.by) {
    case 'lastModified':
      return api.getCardMeta(instance, 'lastModified') ?? null;
    case 'createdAt':
      return api.getCardMeta(instance, 'resourceCreatedAt') ?? null;
    case 'cardURL':
      return instance.id ?? null;
    default:
      return null;
  }
}

function rawCompare(a: any, b: any): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  let sa = String(a);
  let sb = String(b);
  if (sa < sb) {
    return -1;
  }
  if (sa > sb) {
    return 1;
  }
  return 0;
}

export { GENERAL_SORT_FIELDS };
