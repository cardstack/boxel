import { isCodeRef } from '../card-document-shape.ts';
import { ensureTrailingSlash } from '../paths.ts';
import type { SearchEntryWireQuery } from '../search-entry.ts';
import {
  newOperationScope,
  resolveOperation,
  scopeCallerFor,
  type OperationCore,
} from './dispatch.ts';
import { lowerQueryOperation } from './query.ts';
import { OperationFailure } from './types.ts';

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

export interface NamedQueryContext {
  // The user the realm authenticated for this request, and the only value
  // `actor()` resolves to. Absent when the request authenticated nobody, which
  // refuses only a declaration that compares against the caller.
  actor: string | undefined;
  // The realms this request may search. On the federated endpoint these are
  // the realms the request named, each already authorized for the caller; on
  // a realm's own endpoint, that realm.
  realms: string[];
  // Set for a request a render is waiting on, which changes two things.
  //
  // There is no actor. The app authenticates as itself to render, and what a
  // render produces is served to every viewer, so a declaration compared
  // against the render's own identity would put one user's rows into shared
  // HTML. It is refused as a request that authenticated nobody is — the rule
  // the host applies to the same query before it would send it.
  //
  // Definitions are read only from the cache. The render holds a prerender
  // slot until the search answers, and a definition missing from the cache is
  // built by a prerender of its module, which can need that same slot — the
  // reason the search engine reads definitions the same way here. A type
  // whose definition is not cached resolves as unknown.
  duringRender?: boolean;
}

// The ad-hoc search request a named one resolves to, in the grammar the
// search endpoints parse. Every refusal is an `OperationFailure` carrying the
// status it is answered with.
//
// Where the declaration names a member, the declaration's stands; where it
// names none, the caller's fills it. The filter is the exception: it is the
// shape of the query, which is the declaration's alone, so a caller's is
// dropped even where the declaration wrote none.
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
): Promise<SearchEntryWireQuery> {
  let {
    operation,
    on,
    params,
    filter: _callerFilter,
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
  let resolvingCore = context.duringRender ? cachedOnly(core) : core;
  let scope = newOperationScope(resolvingCore, {
    caller: scopeCallerFor(actor ?? ''),
  });
  let definition = await resolveOperation(
    resolvingCore,
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
  );
  return {
    ...(callerMembers as SearchEntryWireQuery),
    ...declared,
    realms,
  };
}

function cachedOnly(core: OperationCore): OperationCore {
  let { definitionLookup } = core;
  let lookupCached = definitionLookup.lookupCachedDefinition;
  // A lookup that keeps no cache has no prerender behind a miss to wait on.
  if (!lookupCached) {
    return core;
  }
  return {
    ...core,
    definitionLookup: {
      lookupDefinition: (codeRef) =>
        lookupCached.call(definitionLookup, codeRef),
    },
  };
}

// `lowerQueryOperation` leaves a declaration's own list standing, empty or
// not, and fills an unnamed scope only from a non-empty one — so an empty list
// here is one the declaration wrote, and an absent one is a scope nobody named.
function unscopedDetail(operation: string, declared: string[] | undefined) {
  if (declared?.length) {
    return `operation "${operation}" searches ${declared.join(', ')}, and this request may search none of them`;
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
