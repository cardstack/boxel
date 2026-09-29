import { isCodeRef } from '../card-document-shape.ts';
import type { CodeRef } from '../code-ref.ts';
import { ensureTrailingSlash } from '../paths.ts';
import {
  wireFilterGrantTypes,
  type SearchEntryWireFilter,
  type SearchEntryWireQuery,
} from '../search-entry.ts';
import {
  newOperationScope,
  resolveOperation,
  scopeCallerFor,
  type OperationCore,
} from './dispatch.ts';
import { lowerQueryOperation } from './query.ts';
import { linkStrategyOf, OperationFailure } from './types.ts';
import type { LinkStrategy } from '@cardstack/base/operations';

// ============================================================================
// A named query: a search request that names a declared query operation
// rather than carrying the query itself.
//
// The ad-hoc form of a search request is a query the caller wrote. The named
// form names an operation, the type that declares it, and the params to fill
// it with, and the realm resolves the declaration from its own definition of
// that type and lowers it with `lowerQueryOperation` — the same resolution a
// caller runs off the class it invoked. What the caller chooses is which
// operation and with what params, never the shape of the query that runs: a
// filter sent alongside the name is dropped, and the actor the declaration
// compares against is the one the realm authenticated, whatever the payload
// says about anyone.
//
// A caller may still lower the declaration itself, and the host does, since
// its client-side search arm matches local instances against a filter. That
// lowering is advisory: the one served is the realm's, so a caller holding a
// stale definition is answered with the current one.
// ============================================================================

// Whether a search request body names an operation. The named form is decided
// by `operation` alone, so a body that carries `on` or `params` without it is
// read as an ad-hoc query and refused there for its unknown members.
export function isNamedQueryPayload(
  payload: unknown,
): payload is Record<string, unknown> & { operation: unknown } {
  return (
    isPlainRecord(payload) &&
    Object.prototype.hasOwnProperty.call(payload, 'operation')
  );
}

// The operation and the type a named search invokes, or nothing for an ad-hoc
// one. A policy grant is looked up by these, since a query runs under the name
// it was invoked with, on the type that declares it — and they are read off
// the request rather than off what it resolves to, which is a filter and
// carries neither. `resolveNamedQuery` validates the members and refuses a
// request where they are not what they must be, so this only recognizes the
// shape.
export function namedQueryInvocation(
  payload: unknown,
): { operation: string; on: CodeRef } | undefined {
  if (!isNamedQueryPayload(payload)) {
    return undefined;
  }
  let { operation, on } = payload;
  return typeof operation === 'string' && operation.length > 0 && isCodeRef(on)
    ? { operation, on }
    : undefined;
}

// What a search asks a realm's policy to grant: an operation, on the types
// whose rules are consulted for it.
export interface SearchInvocation {
  // The name a grant must carry to contribute. A named query's own name, or
  // the base name `query` for an ad-hoc search.
  operation: string;
  // The one type a named query is declared on, or each type an ad-hoc
  // search's filter anchors to. Empty where the filter admits an entry of any
  // type, since then there is no type whose rules to consult.
  types: CodeRef[];
}

// The invocation a search request makes, read off the request before a named
// query resolves.
//
// An ad-hoc search is a filter the caller wrote, and it is still an
// invocation: of `query`, on the type it targets. Were it none, it would be
// the hole in every named-query grant, since a caller granted a declared
// search could write the same filter by hand and be served its rows. Granting
// a named query grants that saved search, and not the freedom to enumerate
// its type. No declaration may take the name, so the two never share a grant.
//
// The types are the filter's `item.on` anchors (see `wireFilterGrantTypes`):
// every entry the filter matches adopts from at least one of them. That is
// what makes judging the search by their rules sound. A match is always of a
// type one of them names, so a rule consulted for that anchor is one whose
// type the match descends from, as it would be were the gate judging the
// match itself. And every anchor a match is known to adopt from is kept, so
// two filters matching the same cards are judged alike however their branches
// are ordered.
//
// A named request whose members are not what they must be is no invocation:
// resolving it refuses it before anything consults a policy. An ad-hoc filter
// that does not parse is refused by the parser, after this has read it, so an
// anchor that is not a code ref is read as no anchor at all.
export function searchInvocation(
  payload: unknown,
): SearchInvocation | undefined {
  if (isNamedQueryPayload(payload)) {
    let named = namedQueryInvocation(payload);
    return named
      ? { operation: named.operation, types: [named.on] }
      : undefined;
  }
  let filter = isPlainRecord(payload) ? payload.filter : undefined;
  let anchors = isPlainRecord(filter)
    ? wireFilterGrantTypes(filter as SearchEntryWireFilter)
    : undefined;
  return {
    operation: 'query',
    types: anchors?.every((anchor) => isCodeRef(anchor)) ? anchors : [],
  };
}

export interface NamedQueryContext {
  // The user the realm authenticated for this request, and the only value
  // `actor()` resolves to. Absent when the request authenticated nobody, which
  // refuses only a declaration that compares against the caller.
  actor: string | undefined;
  // The realms this request may search. On the federated endpoint these are
  // the realms the request named, each already authorized for the caller; on
  // a realm's own endpoint, that realm.
  realms: string[];
  // Set for a request a render is waiting on. Such a request has no actor: the
  // app authenticates as itself to render, and what a render produces is
  // served to every viewer, so a declaration compared against the render's own
  // identity would put one user's rows into shared HTML. It is refused as a
  // request that authenticated nobody is — the rule the host applies to the
  // same query before it would send it.
  duringRender?: boolean;
}

// What a named search request resolves to: the ad-hoc query it runs, and how
// much of each result's link graph its results carry.
export interface ResolvedNamedQuery {
  // In the grammar the search endpoints parse.
  query: SearchEntryWireQuery;
  // The strategy the declaration names, `full` where it names none. It is the
  // declaration's half of what a response carries; the endpoint serving it
  // composes it with the request's half through `effectiveLinkStrategy`, so a
  // declaration written to withhold links is never widened by a request, and
  // it holds on every endpoint a named query is served from. It travels beside
  // the query rather than in it because it shapes the answer rather than which
  // rows match, and the search grammar has no member for it.
  links: LinkStrategy;
}

// The ad-hoc search request a named one resolves to, and the link strategy its
// results are served under. Every refusal is an `OperationFailure` carrying the
// status it is answered with.
//
// Where the declaration names a member, the declaration's stands; where it
// names none, the caller's fills it. The filter is the exception: it is the
// shape of the query, which is the declaration's alone, so a caller's is
// dropped even where the declaration wrote none. Only its `htmlQuery` binding
// carries over. The grammar binds it inside the filter, in the top-level `eq`,
// but it chooses how a row is rendered rather than which rows match, and a
// declaration has no way to name one.
//
// The realms searched are the ones the declaration scopes itself to — or,
// where it names none, the caller's — narrowed to the ones this request may
// search. A request may therefore search fewer of a declaration's realms than
// it names, never a realm outside them, and never one it was not authorized
// for. A scope that narrows to nothing is refused rather than sent, because a
// search with no realms reads as every realm the session can see.
export async function resolveNamedQuery(
  core: OperationCore,
  payload: Record<string, unknown>,
  context: NamedQueryContext,
): Promise<ResolvedNamedQuery> {
  let {
    operation,
    on,
    params,
    filter: callerFilter,
    ...callerMembers
  } = payload;
  if (typeof operation !== 'string' || operation.length === 0) {
    throw invalidNamedQuery(`"operation" must name the operation to run`);
  }
  if (!isCodeRef(on)) {
    throw invalidNamedQuery(
      `"on" must be the code ref of the type operation "${operation}" is invoked on`,
    );
  }
  if (params !== undefined && !isPlainRecord(params)) {
    throw invalidNamedQuery(
      `"params" must be an object keyed the way operation "${operation}" declares them`,
    );
  }
  let actor = context.duringRender ? undefined : context.actor;
  let scope = newOperationScope(core, {
    caller: scopeCallerFor(actor ?? ''),
  });
  let definition = await resolveOperation(
    core,
    { kind: 'type', codeRef: on, realm: core.realmURL },
    operation,
    scope,
  );
  let lowered = lowerQueryOperation(definition, {
    ...(actor === undefined ? {} : { actor }),
    ...(params === undefined ? {} : { params }),
    realms: context.realms,
  });
  let permitted = new Set(context.realms.map(ensureTrailingSlash));
  let realms = [
    ...new Set((lowered.realms ?? []).map(ensureTrailingSlash)),
  ].filter((realm) => permitted.has(realm));
  if (realms.length === 0) {
    throw invalidNamedQuery(unscopedDetail(operation, lowered.realms));
  }
  let declared = Object.fromEntries(
    Object.entries(lowered).filter(([, value]) => value !== undefined),
  ) as SearchEntryWireQuery;
  let htmlQuery = htmlQueryBinding(callerFilter);
  return {
    query: {
      ...(callerMembers as SearchEntryWireQuery),
      ...declared,
      ...(htmlQuery === undefined
        ? {}
        : {
            filter: {
              ...declared.filter,
              eq: { ...declared.filter?.eq, htmlQuery },
            },
          }),
      realms,
    },
    // Read the way the read executor reads a read's, so a value lowering would
    // have refused to store serves as the narrowest strategy rather than as
    // the widest.
    links: linkStrategyOf(definition.links),
  };
}

// A named search as the ad-hoc request that asks for its rendering and nothing
// else: the fieldset and the `htmlQuery` binding, which are what an answer
// with no rows carries of the request. For a request whose declaration there
// is no realm to resolve through — every realm it names is one nothing is
// served from — so that it is answered with the document a search of those
// realms matching nothing would give.
export function namedQueryRendering(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  let htmlQuery = htmlQueryBinding(payload.filter);
  return {
    ...(payload.fields !== undefined ? { fields: payload.fields } : {}),
    ...(htmlQuery !== undefined ? { filter: { eq: { htmlQuery } } } : {}),
  };
}

// The rendering a caller's filter asks for, read where the grammar binds it.
// Checked by the search parser along with the rest of the query it lands in.
function htmlQueryBinding(filter: unknown): unknown {
  if (!isPlainRecord(filter) || !isPlainRecord(filter.eq)) {
    return undefined;
  }
  return filter.eq.htmlQuery;
}

// `lowerQueryOperation` leaves a declaration's own list standing, empty or
// not, and fills an unnamed scope only from a non-empty one — so an empty list
// here is one the declaration wrote, and an absent one is a scope nobody named.
function unscopedDetail(operation: string, declared: string[] | undefined) {
  // The declaration's own realms go unnamed: its type can sit in a realm this
  // caller cannot read, and so can the realms it scopes itself to.
  if (declared?.length) {
    return `operation "${operation}" searches only the realms its declaration names, and this request may search none of them`;
  }
  return `operation "${operation}" names no realm to search: ${
    declared
      ? 'its declaration names an empty list of realms'
      : 'its declaration names none, and neither does the request'
  } — a query with no realms searches every realm the session can read`;
}

function invalidNamedQuery(detail: string): OperationFailure {
  return new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Invalid named query',
    detail,
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
