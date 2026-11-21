// A realm policy's grants on the value-store paths: a caller a policy scopes
// by grants that each admit every card of a type reads through the store, as
// a caller who reads the realm outright does.
// Owns: which compiled grant filters the store carries, and the store's
// tests for one.
// Must not: decide what a policy admits. The policy compiler decides that,
// and the grant filter it composed into the search is all this reads. A
// filter it does not recognize, whatever the reason, keeps the general read.
// Guarantees: docs/search.md ("A result a policy scoped").
//
// The grant filter (`QueryOptions.grantFilter`) a policy composes into a
// search is `composePolicyScopedFilter(undefined, [scope])`, where the scope
// is what `withoutAuthorization` (card-operations/policy-query.ts) made of
// the grants that admit the caller:
//
//   { any: [ { every: [ granted,
//     { not: { any: [ { cardIdentity: { ids } }, { type: RealmPolicy } ] } } ] } ] }
//
// and the search's filter is `{ every: [ callerFilter, grantFilter ] }`.
// A grant whose `where` names no card field compiles, for the caller it
// admits, to exactly `{ type: T }`: the policy compiler settles what the
// caller's kind settles of `actor()` (`settleActor`) before it compiles the
// rest, and a predicate settled to `true` compiles to the rule's type alone
// (`compilePolicyFilter`). A grant whose `where` reads a card field compiles
// to more than that, and no such filter is recognized here.
//
// `granted` is recognized in exactly these forms:
// - `{ type: T }`: one grant on the searched type;
// - `{ any: [{ type: T1 }, { type: T2 }, …] }`: several grants on it, each
//   a type test (a rule on the type or on a type it descends from);
// - `{ on: T, any: [{ type: T }, …] }`, or an `any` of several of those: a
//   search of several types (`scopeFor`), each branch confined to its type,
//   where every grant of the branch is a test of that same type.
// A branch whose grant tests another type than its own (a rule on an
// ancestor, in a search of several types) is not recognized, nor is any
// other node, key or member anywhere in the filter.
//
// What the store reads for a recognized filter is what the general read
// computes from it. The caller's filter is read as it would be with no
// grant, and beside it:
// - the granted types: a card whose type's adoption chain names one of them
//   (the chain the general read tests, `boxel_index_value_types.types`);
// - the excluded type: a card whose type's chain names `RealmPolicy` is not
//   read;
// - the excluded cards (`cardIdentity`): the realm's config card and the
//   card its policy key names, by id, and any row with no search document.
//   The store paths do not test these card by card. They read the store only
//   when the test cannot remove any card the store would return: no excluded
//   card is a live card of a granted type that is not a `RealmPolicy`, and no
//   such live card has no search document (`grantReachesExcludedCards`).
//   Otherwise, as for a grant on `CardDef` in a realm whose config card is
//   indexed, the search keeps the general read.

import stringify from 'safe-stable-stringify';

import {
  type Expression,
  any,
  param,
  separatedByCommas,
  typesContains,
} from '../expression.ts';
import type { CodeRef } from '../code-ref.ts';
import type { Filter } from '../query.ts';
import { rri } from '../realm-identifiers.ts';
import {
  cardIdentityURLs,
  isCardIdentityFilter,
} from '../card-identity-filter.ts';

// The type every policy-scoped search leaves out, as `withoutAuthorization`
// names it (`realmPolicyRef`, card-operations/policy.ts).
export const STORE_GRANT_EXCLUDED_TYPE: CodeRef = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// What a recognized grant filter admits: a card of one of `types` (or of a
// type descending from one), that is not a `excludedType` card, and none of
// `excludedIds`' rows.
export interface StoreGrant {
  types: CodeRef[];
  excludedType: CodeRef;
  excludedIds: string[];
}

function isPlainObject(node: unknown): node is Record<string, unknown> {
  return (
    typeof node === 'object' &&
    node !== null &&
    !Array.isArray(node) &&
    Object.getPrototypeOf(node) === Object.prototype
  );
}

function hasExactly(node: Record<string, unknown>, keys: string[]) {
  let own = Object.keys(node);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

// A type as a compiled grant names it: a module and an export name, nothing
// else.
function codeRefOf(node: unknown): CodeRef | undefined {
  if (
    !isPlainObject(node) ||
    !hasExactly(node, ['module', 'name']) ||
    typeof node.module !== 'string' ||
    typeof node.name !== 'string' ||
    node.module === '' ||
    node.name === ''
  ) {
    return undefined;
  }
  return { module: node.module, name: node.name } as CodeRef;
}

// `{ type: T }`, and nothing else: T.
function typeTestOf(node: unknown): CodeRef | undefined {
  if (!isPlainObject(node) || !hasExactly(node, ['type'])) {
    return undefined;
  }
  return codeRefOf(node.type);
}

function sameRef(a: CodeRef, b: CodeRef) {
  return stringify(a) === stringify(b);
}

// `{ on: T, any: [{ type: T }, …] }`: a branch of a search of several types
// whose every grant tests T itself. T, or undefined.
function confinedBranchOf(node: unknown): CodeRef | undefined {
  if (!isPlainObject(node) || !hasExactly(node, ['on', 'any'])) {
    return undefined;
  }
  let on = codeRefOf(node.on);
  if (!on || !Array.isArray(node.any) || node.any.length === 0) {
    return undefined;
  }
  for (let grant of node.any) {
    let type = typeTestOf(grant);
    if (!type || !sameRef(type, on)) {
      return undefined;
    }
  }
  return on;
}

// The types `granted` admits, in one of the forms above, or undefined.
function grantedTypesOf(granted: unknown): CodeRef[] | undefined {
  let one = typeTestOf(granted) ?? confinedBranchOf(granted);
  if (one) {
    return [one];
  }
  if (
    !isPlainObject(granted) ||
    !hasExactly(granted, ['any']) ||
    !Array.isArray(granted.any) ||
    granted.any.length === 0
  ) {
    return undefined;
  }
  let branches = granted.any as unknown[];
  // Either every member is a type test (several grants on one type), or
  // every member is a confined branch (several types), never a mix.
  let tests = branches.map(typeTestOf);
  if (tests.every((t): t is CodeRef => t !== undefined)) {
    return tests;
  }
  let confined = branches.map(confinedBranchOf);
  if (confined.every((t): t is CodeRef => t !== undefined)) {
    return confined;
  }
  return undefined;
}

// `{ not: { any: [ { cardIdentity: { ids } }, { type: RealmPolicy } ] } }`:
// the ids, or undefined.
function exclusionIdsOf(node: unknown): string[] | undefined {
  if (!isPlainObject(node) || !hasExactly(node, ['not'])) {
    return undefined;
  }
  let inner = node.not;
  if (
    !isPlainObject(inner) ||
    !hasExactly(inner, ['any']) ||
    !Array.isArray(inner.any) ||
    inner.any.length !== 2
  ) {
    return undefined;
  }
  let [identity, excludedType] = inner.any as unknown[];
  if (!isCardIdentityFilter(identity) || !isPlainObject(identity)) {
    return undefined;
  }
  let ids = (identity as { cardIdentity: unknown }).cardIdentity;
  if (!isPlainObject(ids) || !hasExactly(ids, ['ids'])) {
    return undefined;
  }
  // Checked here, not left to `isCardIdentityFilter`: a list of at least
  // one id, each a non-empty string. The policy compiler always names the
  // realm's config card (`authorizationCardIds`), so an empty list, like
  // any other value, is a shape it does not produce.
  let list: unknown = ids.ids;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    !list.every((id) => typeof id === 'string' && id !== '')
  ) {
    return undefined;
  }
  let type = typeTestOf(excludedType);
  if (!type || !sameRef(type, STORE_GRANT_EXCLUDED_TYPE)) {
    return undefined;
  }
  return [...(list as string[])];
}

// The grant a policy-scoped search's `grantFilter` composes, where it is one
// the value store carries; undefined for any other filter.
export function storeGrantOf(grantFilter: unknown): StoreGrant | undefined {
  if (
    !isPlainObject(grantFilter) ||
    !hasExactly(grantFilter, ['any']) ||
    !Array.isArray(grantFilter.any) ||
    grantFilter.any.length !== 1
  ) {
    return undefined;
  }
  let [scope] = grantFilter.any as unknown[];
  if (
    !isPlainObject(scope) ||
    !hasExactly(scope, ['every']) ||
    !Array.isArray(scope.every) ||
    scope.every.length !== 2
  ) {
    return undefined;
  }
  let [granted, exclusion] = scope.every as unknown[];
  let types = grantedTypesOf(granted);
  let excludedIds = exclusionIdsOf(exclusion);
  if (!types || !excludedIds) {
    return undefined;
  }
  return {
    types,
    excludedType: STORE_GRANT_EXCLUDED_TYPE,
    excludedIds,
  };
}

// The caller's own filter in a search's filter that a policy composed with
// `grantFilter`: `{ every: [ callerFilter, grantFilter ] }`, the grant
// conjunct equal to `grantFilter` itself. Undefined for a filter of any other
// shape, such as one a rewrite reshaped, or one with no caller filter.
export function callerFilterUnder(
  filter: Filter | undefined,
  grantFilter: Filter,
): Filter | undefined {
  if (
    !isPlainObject(filter) ||
    !hasExactly(filter, ['every']) ||
    !Array.isArray(filter.every) ||
    filter.every.length !== 2
  ) {
    return undefined;
  }
  let [caller, grant] = filter.every as Filter[];
  if (caller === undefined || stringify(grant) !== stringify(grantFilter)) {
    return undefined;
  }
  return caller;
}

// The type keys a recognized grant's tests read.
export interface StoreGrantKeys {
  // a card's type's chain names one of these
  keys: string[];
  // and none of these
  notKeys: string[];
}

// The test, over a type dictionary row's chain column (`t.types`), that its
// type is one the grant admits: `AND (…) AND NOT (…)`, to follow a test of
// the row's realm.
export function grantedTypeTest(
  column: string,
  grant: StoreGrantKeys,
): Expression {
  return [
    'AND (',
    ...(any(
      grant.keys.map((key) => [typesContains(key, column)]),
    ) as Expression),
    ')',
    ...(grant.notKeys.length
      ? [
          'AND NOT (',
          ...(any(
            grant.notKeys.map((key) => [typesContains(key, column)]),
          ) as Expression),
          ')',
        ]
      : []),
  ];
}

// Whether the grant's card exclusion could remove a card the store would
// return: one of `excludedIds`' cards is a live card of a type the grant
// admits, or such a card has no search document (its `search_keys` are a
// marker at the empty path, and the exclusion's `cardIdentity` node matches
// a row with no search document). `index` is the promoted index the search
// reads.
export function grantReachesExcludedCards({
  realm,
  grant,
  excludedIds,
  index,
}: {
  realm: string;
  grant: StoreGrantKeys;
  excludedIds: string[];
  index: string;
}): Expression {
  let granted: Expression = [
    'SELECT t.id FROM boxel_index_value_types AS t WHERE t.realm_url =',
    param(realm),
    ...grantedTypeTest('t.types', grant),
  ];
  let root: Expression = [
    "(SELECT p.id FROM boxel_index_value_paths AS p WHERE p.path = '')",
  ];
  let urls = cardIdentityURLs(excludedIds);
  let named: Expression = urls.length
    ? [
        'EXISTS (SELECT 1 FROM boxel_index_value_cards AS c JOIN boxel_index_values AS v ON v.card_id = c.id WHERE c.realm_url =',
        param(realm),
        'AND c.url IN (',
        ...(separatedByCommas(urls.map((u) => [param(u)])) as Expression),
        ') AND v.path_id =',
        ...root,
        "AND v.kind = 'c' AND v.type_id IN (",
        ...granted,
        '))',
      ]
    : ['FALSE'];
  return [
    'SELECT (',
    ...named,
    // The cards with a marker at the empty path, from the marker index, each
    // looked up in the index by its key (a LIMIT keeps the lookup a keyed
    // probe per card, on the index's key in its own collation: unfenced,
    // the planner scanned the whole index for rows with no search document).
    'OR EXISTS (SELECT 1 FROM boxel_index_values AS m JOIN boxel_index_value_cards AS c ON c.id = m.card_id',
    `CROSS JOIN LATERAL (SELECT i.search_doc IS NULL AS no_doc FROM ${index} AS i WHERE i.url = (c.url COLLATE "default")::varchar AND i.realm_url =`,
    param(realm),
    "AND i.type = 'instance' LIMIT 1) AS d",
    'WHERE m.realm_id = (SELECT r.id FROM boxel_index_value_realms AS r WHERE r.realm_url =',
    param(realm),
    ") AND m.kind = 'm' AND m.path_id =",
    ...root,
    'AND m.type_id IN (',
    ...granted,
    ') AND d.no_doc)) AS reached',
  ];
}
