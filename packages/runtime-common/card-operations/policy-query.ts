import type { CodeRef } from '../code-ref.ts';
import type { Filter } from '../query.ts';
import { policyFilterFromWire } from '../search-entry.ts';
import type { OperationCore } from './dispatch.ts';
import { matchingGrants } from './gate.ts';
import type { CompiledRealmPolicy } from './policy.ts';
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
//   two grants whose predicates may well differ.
// - Only a grant that compiled a filter. A grant whose predicate has none is
//   recorded as `policy-not-filterable` when the policy compiles, and it
//   contributes nothing here rather than widening the search to rows it cannot
//   judge. Its single-instance evaluation is untouched.
//
// A caller with nothing to contribute is scoped to nothing rather than to
// everything: an absent grant is a refusal here, as it is at the gate.
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

// What this realm's policy contributes to `operation` invoked on `on` by
// `actor`. The core is the realm's own, bound to its own authority, as the
// gate's is: a policy card commonly lives in a realm the caller cannot read.
//
// `actor` is required rather than optional. A policy grants by who is asking,
// so a request that authenticated nobody has no grant to be judged by,
// whatever the policy holds — the rule the realm already applies before it
// hands a refused request to the gate at all.
export async function policyQueryScope(
  core: OperationCore,
  invocation: { operation: string; on: CodeRef; actor: string },
): Promise<PolicyQueryScope> {
  let policy = await core.policy?.compiledPolicy();
  if (!policy) {
    return DENIED;
  }
  let types = await targetTypeChain(core, invocation.on);
  if (!types) {
    return DENIED;
  }
  let filters = await grantFilters(
    policy,
    types,
    invocation.operation,
    invocation.actor,
    core,
  );
  return filters.length > 0 ? { kind: 'scoped', filters } : DENIED;
}

// The adoption chain of the type a query names, as the realm's own definition
// cache recorded it: the type and every type it descends from. A rule on an
// ancestor governs the query the way it governs that type's cards, and the
// chain is what the gate matches a rule against too, so the two answer from
// one reading of what the type is.
//
// A type the realm cannot resolve has no chain and nothing to match a rule
// against, so it matches none rather than all.
async function targetTypeChain(
  core: OperationCore,
  on: CodeRef,
): Promise<string[] | undefined> {
  let resolved = core.resolveCodeRef(on, new URL(core.realmURL));
  if (!resolved) {
    return undefined;
  }
  try {
    return (await core.definitionLookup.lookupDefinitionEntry(resolved))?.types;
  } catch {
    return undefined;
  }
}

// Every matching grant's filter, with the caller filled in, in the grammar the
// engine runs.
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
    filters.push(policyFilterFromWire(bound.filter));
  }
  return filters;
}
