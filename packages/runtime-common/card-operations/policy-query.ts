import type { CodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import type { Filter } from '../query.ts';
import { policyFilterFromWire } from '../search-entry.ts';
import type { OperationCore } from './dispatch.ts';
import {
  authorizationCardIds,
  matchingGrants,
  nonGrantableInChain,
  policyUnavailable,
} from './gate.ts';
import { FIELD_KEYED_OPERATORS } from './policy-filter.ts';
import {
  realmPolicyRef,
  type CompiledOperationGrant,
  type CompiledRealmPolicy,
  type MisreadingType,
} from './policy.ts';
import { lowerQueryOperation } from './query.ts';

// ============================================================================
// What a realm's policy contributes to a search.
//
// The gate decides a single-instance operation by reading the card it names. A
// query names no card: it names a shape, and the rows that answer it are
// whatever the index holds. Judging a policy per row would mean reading every
// candidate and discarding the ones the predicate refuses, which is the one
// thing paging cannot survive. So a query grant's predicate was compiled to a
// search filter when the policy was, and a search the policy scopes runs that
// filter alongside the caller's own.
//
// This is the lookup half: which filters a policy contributes to one
// invocation, in the grammar the engine runs. Composing them into the query
// the search runs is `policyScopedQuery`, which lives with the rest of the
// search grammar.
//
// Two rules decide what contributes:
//
// - Only a grant on the invoked operation. A grant names an operation, and a
//   query runs under the name it was invoked with, so a grant on `read` never
//   contributes. Reading a card whose id you were given and enumerating every
//   card of a type are different powers, and a type meant to be both carries
//   two grants whose predicates may well differ. An ad-hoc search runs under
//   the base name `query`, so a grant on a named query never contributes to
//   one either: granting a saved search is not granting the freedom to write
//   any filter over its type.
// - Only a grant that compiled a filter. A grant whose predicate has none is
//   recorded as `policy-not-filterable` when the policy compiles, and it
//   contributes nothing here rather than widening the search to rows it cannot
//   judge. Its single-instance evaluation is untouched.
//
// A caller with nothing to contribute is scoped to nothing rather than to
// everything: an absent grant is a refusal here, as it is at the gate.
//
// A policy that did not compile as a whole grants nothing, and yet is not a
// refusal. What it would grant is unknown: the realm names a policy and cannot
// read it as one. So the query is refused with the gate's own 500, rather than
// answered as though the policy granted nothing, and a federated search counts
// the realm as one that did not answer.
//
// Authorization infrastructure is outside the grant model here as it is at
// the gate. A query declared `nonGrantable` contributes nothing, however the
// compiled policy came to grant it, and so does one a type anywhere up the
// queried type's chain declares `nonGrantable` under the same name: a subclass
// cannot make grantable what the type it extends kept out of a policy's
// reach.
//
// Nor does any grant find the cards that hold a realm's authorization. The
// gate refuses a grant every operation on the realm's config card, on the card
// its policy key names, and on any policy card. A search never passes the
// gate, though, and a grant on a type those cards descend from, `CardDef` say,
// compiles to a filter their rows match. So every filter a scope carries
// leaves their rows out, whichever grant it came from: the two named cards by
// id, and a policy card by the `RealmPolicy` its row's adoption chain holds.
// The chain is what covers a draft no key names, and a policy card another
// realm's key names that is stored in this one. A declaration can't do this:
// `query` is a reserved name no type may mark `nonGrantable`, and a search on
// `CardDef` never reads `RealmPolicy`'s declarations anyway.
//
// A card's `.json` is indexed a second time as a file row, whose id ends in
// `.json` and whose chain is a file type's, so neither arm matches it. No
// grant reaches one: only a card type carries `query`, so every compiled
// filter is anchored on a card type, and a file row's chain holds none.
//
// What this excludes is rows a filter matches. A row the filter admits is
// served with its whole link closure, as a granted read is, and that closure
// carries a policy card or the config card the row links to. Nothing here
// narrows it. How far a grant reaches past its rows is an authoring
// constraint rather than an enforced boundary: a named query may declare a
// narrower `links`, and an ad-hoc search serves the full closure.
// ============================================================================

// What a policy says about one caller's query. A realm the caller reads
// coarsely is never asked: a policy widens what the ACL refused, and has
// nothing to add to what it allowed.
export type PolicyQueryScope =
  // The grants that admit this query, as the filter each one admits. Never
  // empty: a scope with no filter is a denial, since composing zero filters
  // would leave the caller's query running unscoped.
  | { kind: 'scoped'; filters: Filter[] }
  // No grant admits this query here. The realm contributes no rows.
  | { kind: 'denied' };

const DENIED: PolicyQueryScope = { kind: 'denied' };

// Who a search runs for. A realm-authority principal is a render: a session a
// realm renders its own cards under (`TokenClaims.realmAuthority`), or any
// request a render tab sends. Any other is the user its session names.
export type SearchPrincipal =
  | { kind: 'user'; user: string }
  | { kind: 'realm-authority'; user: string };

// The principal a request authenticated as, or none for a request that
// authenticated nobody.
export function searchPrincipal(
  user: string | undefined,
  realmAuthority: boolean | undefined,
): SearchPrincipal | undefined {
  if (user === undefined) {
    return undefined;
  }
  return realmAuthority
    ? { kind: 'realm-authority', user }
    : { kind: 'user', user };
}

// Raised when a policy is asked what it grants a realm-authority principal.
//
// A render's search runs as a realm-authority principal, and what the render
// produces is cached and served to every viewer. A policy fragment composed
// into that search would make the render per-actor: rows missing, or rows
// only one user may see, in HTML everyone receives. Nothing would fail, so
// this is raised instead of answering, and it is never caught as a denial.
// The routes keep a realm-authority principal away from every policy, so
// raising it means that wiring broke.
export class RealmAuthorityPolicyScopeError extends Error {
  constructor(realmURL: string, operation: string) {
    super(
      `a policy fragment was about to be composed for a realm-authority ` +
        `session: the search for "${operation}" in ${realmURL} runs under ` +
        `the realm's own authority, which no policy scopes`,
    );
    this.name = 'RealmAuthorityPolicyScopeError';
  }
}

// What this realm's policy contributes to `operation` invoked on `types` by
// `principal`. The core is the realm's own, bound to its own authority, as the
// gate's is: a policy card commonly lives in a realm the caller cannot read.
//
// `principal` is required rather than optional. A policy grants by who is
// asking, so a request that authenticated nobody has no grant to be judged
// by, whatever the policy holds — the rule the realm already applies before
// it hands a refused request to the gate at all. A realm-authority principal
// is not someone asking either, and is refused with
// `RealmAuthorityPolicyScopeError` before any type is judged or the policy is
// read.
//
// A search on no type at all has no rules to consult, so it is denied without
// reading the policy. One on several types — an ad-hoc search whose filter
// takes any of several anchored branches — is judged type by type, and what
// each type's grants admit is confined to that type's cards, so each type
// contributes exactly what a search on it alone would. A grant compiled on a
// type the several share is anchored on that shared type, and unconfined it
// would reach, through the type it was matched for, the cards of one whose
// own judgment refused them — a type the realm cannot resolve, say.
export async function policyQueryScope(
  core: OperationCore,
  invocation: {
    operation: string;
    types: readonly CodeRef[];
    principal: SearchPrincipal;
  },
): Promise<PolicyQueryScope> {
  let { operation, types, principal } = invocation;
  if (principal.kind === 'realm-authority') {
    throw new RealmAuthorityPolicyScopeError(core.realmURL, operation);
  }
  let actor = principal.user;
  let distinct = [
    ...new Map(types.map((type) => [JSON.stringify(type), type])).values(),
  ];
  if (distinct.length === 0) {
    return DENIED;
  }
  if (distinct.length === 1) {
    return await withoutAuthorization(
      core,
      await typeScope(core, operation, distinct[0], actor),
    );
  }
  let scopes = await Promise.all(
    distinct.map((on) => typeScope(core, operation, on, actor)),
  );
  let filters: Filter[] = [];
  for (let [index, scope] of scopes.entries()) {
    if (scope.kind === 'scoped') {
      filters.push({ on: distinct[index], any: scope.filters });
    }
  }
  return await withoutAuthorization(
    core,
    filters.length > 0 ? { kind: 'scoped', filters } : DENIED,
  );
}

// `scope`, with every filter it carries leaving out the rows of the cards that
// hold the realm's authorization. A scope with no filter to narrow reads no
// pointer.
async function withoutAuthorization(
  core: OperationCore,
  scope: PolicyQueryScope,
): Promise<PolicyQueryScope> {
  if (scope.kind !== 'scoped') {
    return scope;
  }
  let infrastructure = [
    ...(await authorizationCardIds(core)).map((id) => ({ eq: { id } })),
    { type: realmPolicyRef },
  ];
  return {
    kind: 'scoped',
    filters: scope.filters.map((filter) => excluding(filter, infrastructure)),
  };
}

// `filter`, less every row any of `excluded` matches.
function excluding(filter: Filter, excluded: Filter[]): Filter {
  return excluded.length === 0
    ? filter
    : { every: [filter, { not: { any: excluded } }] };
}

// What this realm's policy contributes to a search `principal` sends, where
// the request may have authenticated nobody. Only a user is granted anything.
// A request that authenticated nobody has no grant to be judged by. A
// realm-authority principal is a render, and what a render produces is served
// to every viewer, so it reads what the ACL grants it and the policy is never
// asked about it.
export async function principalQueryScope(
  core: OperationCore,
  invocation: { operation: string; types: readonly CodeRef[] },
  principal: SearchPrincipal | undefined,
): Promise<PolicyQueryScope> {
  return principal?.kind === 'user'
    ? await policyQueryScope(core, { ...invocation, principal })
    : DENIED;
}

// What the policy contributes to `operation` on the one type `on`.
async function typeScope(
  core: OperationCore,
  operation: string,
  on: CodeRef,
  actor: string,
): Promise<PolicyQueryScope> {
  let policy = await core.policy?.compiledPolicy();
  if (!policy) {
    return DENIED;
  }
  // Before the type is resolved, as the gate refuses before its target
  // resolves, so the refusal says nothing about the type.
  if (policy.uncompilable) {
    throw policyUnavailable();
  }
  let entry = await targetTypeEntry(core, on);
  if (!entry?.types) {
    return DENIED;
  }
  // Refused before any rule is matched, as the gate refuses it.
  if (ownDeclaration(entry.definition, operation)?.nonGrantable) {
    return DENIED;
  }
  let filters = await grantFilters(policy, entry.types, operation, actor, core);
  if (filters.length === 0) {
    return DENIED;
  }
  // Only once a grant would contribute, as at the gate, so a query nothing
  // grants pays no definition reads for a refusal it was getting anyway. The
  // chain starts at the queried type, whose own declaration was read above.
  if (await nonGrantableInChain(core, entry.types.slice(1), operation)) {
    return DENIED;
  }
  return { kind: 'scoped', filters };
}

// The definition-cache entry of the type a query names: its definition, and
// the adoption chain recorded beside it — the type and every type it descends
// from. A rule on an ancestor governs the query the way it governs that type's
// cards, and the chain is what the gate matches a rule against too, so the two
// answer from one reading of what the type is.
//
// A type the realm cannot resolve has no chain and nothing to match a rule
// against, so it matches none rather than all.
async function targetTypeEntry(
  core: OperationCore,
  on: CodeRef,
): Promise<{ definition?: Definition; types?: string[] } | undefined> {
  let resolved = core.resolveCodeRef(on, new URL(core.realmURL));
  if (!resolved) {
    return undefined;
  }
  try {
    return await core.definitionLookup.lookupDefinitionEntry(resolved);
  } catch {
    return undefined;
  }
}

// The operation a type declares under `name` itself, as opposed to a built-in
// behavior of that name nothing declared.
function ownDeclaration(
  definition: Definition | undefined,
  name: string,
): { nonGrantable?: true } | undefined {
  let operations = definition?.operations;
  return operations && Object.prototype.hasOwnProperty.call(operations, name)
    ? operations[name]
    : undefined;
}

// Every matching grant's filter, with the caller filled in, in the grammar the
// engine runs, each comparison in it kept from judging a card whose type reads
// the compared path differently from the rule's type.
//
// A compiled filter stands the caller as the `{ $ref: 'actor' }` marker a
// declared query uses, so filling one in is the substitution a named query
// already runs. It goes through that same lowering, which also checks what
// comes out against the search grammar before it can reach the engine, and is
// then read the way a request's filter is read. A filter that does not survive
// either step throws here, where the realm it belongs to is still known,
// rather than composing nothing into the search it scopes.
async function grantFilters(
  policy: CompiledRealmPolicy,
  types: string[],
  operation: string,
  actor: string,
  core: OperationCore,
): Promise<Filter[]> {
  let matched = await matchingGrants(policy, types, operation, core.policy!);
  let filters: Filter[] = [];
  for (let { grant } of matched) {
    if (!grant.filter) {
      continue;
    }
    let bound = lowerQueryOperation(
      { base: 'query', query: { filter: grant.filter } },
      { actor },
    );
    if (!bound.filter) {
      throw new Error(
        `a compiled query grant on "${operation}" lowered to no filter`,
      );
    }
    filters.push(withoutMisreadings(policyFilterFromWire(bound.filter), grant));
  }
  return filters;
}

// `filter` with each comparison of a path some type reads differently kept
// from judging that type's cards, which the index holds a reading of that the
// predicate never makes. Where the comparison would admit a card, it admits
// none of those. Under a `not`, where it would refuse one, it refuses all of
// them. So for such a card the filter holds only when it would hold whatever
// the path read, and the rest of the filter still judges the card: an `or`
// whose other branch reads a path the type declares alike still admits it. A
// filter with nothing misread is `filter` itself, untouched.
export function withoutMisreadings(
  filter: Filter,
  grant: Pick<CompiledOperationGrant, 'misreadingTypes'>,
): Filter {
  let byPath = new Map(
    (grant.misreadingTypes ?? []).map(({ path, types }) => [path, types]),
  );
  if (byPath.size === 0) {
    return filter;
  }
  let guard = (node: Filter, positive: boolean): Filter => {
    if ('any' in node) {
      return {
        ...node,
        any: node.any.map((branch) => guard(branch, positive)),
      };
    }
    if ('every' in node) {
      return {
        ...node,
        every: node.every.map((branch) => guard(branch, positive)),
      };
    }
    if ('not' in node) {
      return { ...node, not: guard(node.not, !positive) };
    }
    let compared = node as Partial<
      Record<(typeof FIELD_KEYED_OPERATORS)[number], object>
    >;
    let types = FIELD_KEYED_OPERATORS.flatMap((operator) =>
      Object.keys(compared[operator] ?? {}),
    ).flatMap((path) => byPath.get(path) ?? []);
    if (types.length === 0) {
      return node;
    }
    let misread: Filter = { any: types.map(cardsOf) };
    return positive
      ? { every: [node, { not: misread }] }
      : { any: [node, misread] };
  };
  return guard(filter, true);
}

// The cards whose own type is `type`, or descends from it without having
// redeclared the path back.
function cardsOf({ type, except }: MisreadingType): Filter {
  return except
    ? {
        every: [
          { type },
          { not: { any: except.map((kept) => ({ type: kept })) } },
        ],
      }
    : { type };
}
