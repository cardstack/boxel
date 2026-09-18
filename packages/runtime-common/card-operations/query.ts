import {
  OperationFailure,
  type OperationLoweringIssueCode,
  type OperationQueryTemplate,
  type OperationTemplate,
} from './types.ts';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '../search-entry.ts';
import { assertQuery, InvalidQueryError } from '../query.ts';
import type { Query, Filter, Sort } from '../query.ts';
import type { CodeRef } from '../code-ref.ts';

// ============================================================================
// A declared query: the template a declaration lowers to, and the wire query
// an invocation resolves it to.
//
// A declaration writes a query against JavaScript — `filter: { on: Report }`
// names a class, and `eq: { 'author.userId': actor() }` stands a marker where
// a value is only known when someone invokes the operation. Lowering
// translates that into an entry-wire query template: the shape the realm's
// `_search` and `_federated-search` endpoints take, with the markers left
// standing. Resolving fills them in and yields a concrete wire query.
//
// Both halves are pure, and both run on both sides. The realm lowers a
// declaration when it captures its type's definition, and a caller lowers the
// same declaration off the class it is invoking, so a saved search means one
// thing wherever it is evaluated rather than two things translated separately.
// Neither half reaches the program canonicalizer, which is what lets a caller
// run them at all — the rest of lowering reaches BXL, and a card module cannot.
//
// The realm never executes a query through the operation core: a query runs on
// the search engine, the one place a query is planned.
// ============================================================================

// Where a translation problem is reported. The realm collects them against the
// declaration it is storing; a caller resolving a declaration it holds raises
// the first one, since it has no stored entry to flag.
export interface QueryLoweringSink {
  add(code: OperationLoweringIssueCode, path: string, message: string): void;
}

// What the translation needs from its caller: a def class, or a thunk
// deferring one past its own class body, as the code ref that names it. Passed
// in rather than imported so this stays independent of any loader.
export interface QueryLoweringContext {
  codeRef(value: unknown): CodeRef | undefined;
}

// What resolving a declared query reads off a definition. Narrower than the
// whole definition, so a caller holding a declaration rather than a cache
// entry can resolve one: the names a payload declares are read here, never
// what each param is — a marker in a query stands for a value to compare, and
// whether a param is a field or a link is the executors' concern.
export interface QueryDefinition {
  base: string;
  query?: OperationQueryTemplate;
  params?: Record<string, unknown>;
}

export interface QueryInvocation {
  // The invoking user's id, which is what `actor()` resolves to and the whole
  // of what the realm knows about the caller. Absent when nobody is signed in,
  // which refuses only a query that reads the actor.
  actor?: string;
  // The payload, keyed the way the definition's `params` schema declares it.
  params?: Record<string, unknown>;
  // The realms to search when the declaration named none. An authored `realms`
  // is a deliberate scope and is left alone.
  realms?: string[];
}

export function lowerQueryOperation(
  definition: QueryDefinition,
  invocation: QueryInvocation,
): SearchEntryWireQuery {
  if (definition.base !== 'query' || !definition.query) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Not a query operation',
      detail: 'this operation declares no query to resolve',
    });
  }
  let resolved = resolveMarkers(
    definition.query,
    definition,
    invocation,
    'query',
  ) as OperationQueryTemplate;
  let query = resolved as SearchEntryWireQuery;
  // An authored `realms` is a deliberate scope and stands, empty included —
  // `realms: []` says "these and no others", which is not the same as saying
  // nothing. The invocation's scope fills only the slot a declaration left
  // alone.
  if (query.realms === undefined && invocation.realms?.length) {
    query.realms = [...invocation.realms];
  }
  // Lowering checked the declaration against the realm's grammar only where it
  // could — a template still holding a marker stands in for a value the realm
  // types concretely, so that check was deferred to here, where the value is
  // known. This is where it lands. Without it a param supplying a number to
  // `matches`, or a scalar where `in` wants a list, produces a query that
  // fails in the search parser instead of as a refusal naming the payload.
  try {
    parseSearchEntryQueryFromPayload(query);
  } catch (err: any) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid params',
      detail:
        `the query this invocation resolves to is not one the realm ` +
        `accepts — ${err?.message ?? String(err)}. The fault is in a supplied ` +
        `value or in the declared query it was substituted into; after ` +
        `substitution the two are the same query.`,
    });
  }
  return query;
}

// Walk the template, replacing every marker with the value this invocation
// supplies and leaving plain data untouched. A marker is a plain object
// carrying a `$ref`, so the walk recognizes one structurally wherever it
// sits — a filter operand, a `matches` term, a member of an `in` list.
function resolveMarkers(
  node: unknown,
  definition: QueryDefinition,
  invocation: QueryInvocation,
  path: string,
): unknown {
  if (Array.isArray(node)) {
    return node.map((entry, index) =>
      resolveMarkers(entry, definition, invocation, `${path}[${index}]`),
    );
  }
  if (!isPlainObject(node)) {
    return node;
  }
  if (typeof node.$ref === 'string') {
    return resolveMarker(node, definition, invocation, path);
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      resolveMarkers(value, definition, invocation, `${path}.${key}`),
    ]),
  );
}

function resolveMarker(
  marker: Record<string, unknown>,
  definition: QueryDefinition,
  invocation: QueryInvocation,
  path: string,
): unknown {
  switch (marker.$ref) {
    case 'params': {
      // Own properties only. A key of `__proto__` or `toString` is answered by
      // every plain object, so an `in` check would pass and substitute
      // `Object.prototype` — or a native function — into a filter operand.
      let key = String(marker.key);
      if (!hasOwn(definition.params, key)) {
        throw invalidParams(
          path,
          `references params("${key}"), which this operation does not declare`,
        );
      }
      if (!hasOwn(invocation.params, key)) {
        throw invalidParams(path, `requires a value for params("${key}")`);
      }
      return invocation.params![key];
    }
    case 'actor':
      // A query compares against what the index holds, and what it holds for
      // an actor is the caller's user id — which is the whole of what the
      // realm knows about them, so the marker carries no key and a stored one
      // names a member that does not exist.
      if (marker.key !== undefined) {
        throw invalidParams(
          path,
          `references actor("${String(marker.key)}"); the caller is a user id with no members to read`,
        );
      }
      if (invocation.actor === undefined) {
        // Nothing the caller sent is wrong, so this is not an invalid payload:
        // the search would run as written and compare stored values against
        // nobody, matching nothing and reading as a saved search that
        // genuinely found none. The remedy is credentials.
        throw new OperationFailure({
          status: 401,
          code: 'actor-required',
          title: 'Operation requires an actor',
          detail: `${path} compares against the caller, and nobody is signed in here`,
        });
      }
      return invocation.actor;
    case 'card':
      // The explicit "this is a card" spelling. In a query every card-valued
      // slot is a comparison against a stored identity rather than a write, so
      // what the marker wraps resolves to that identity and the wrapper adds
      // nothing around it — which is why the caller cannot stand inside one.
      // A user id is not a card identity, so the comparison would match no
      // row rather than fail, and a saved search that silently finds nothing
      // is worse than one that refuses.
      if (
        isPlainObject(marker.value) &&
        (marker.value as Record<string, unknown>).$ref === 'actor'
      ) {
        throw invalidParams(
          path,
          `wraps actor() in card(); the caller is a user id rather than a card, so nothing stored would ever equal it`,
        );
      }
      return resolveMarkers(marker.value, definition, invocation, path);
    case 'instance':
      // A query is rooted in a type, not in one card, so there is no target
      // whose stored values `instance()` could read.
      throw invalidParams(
        path,
        'references instance(), which a query has no target to resolve against',
      );
    case 'realmConfig':
      // A realm setting is a value the realm holds, and this resolution runs
      // on both sides: the host resolves the same template so a saved search
      // means the same thing wherever it is evaluated, and the realm keeps its
      // settings off the wire — they are absent from the `meta.realmInfo` a
      // card response carries — so the host has no map to resolve against.
      // Refused here rather than resolved only on the realm, which would make
      // one query mean two things.
      throw new OperationFailure({
        status: 501,
        code: 'internal-error',
        title: 'Operation not implemented',
        detail: `${path} reads a realm setting, which a query does not resolve`,
      });
    default:
      throw invalidParams(
        path,
        `references an unknown marker "${String(marker.$ref)}"`,
      );
  }
}

function invalidParams(path: string, detail: string): OperationFailure {
  return new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Invalid params',
    detail: `${path} ${detail}`,
  });
}

function hasOwn(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return (
    record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Lowering a declaration to a template
// ---------------------------------------------------------------------------

// A declared query becomes an entry-wire query template: the shape the realm's
// `_search` and `_federated-search` endpoints take, with markers left where an
// invocation supplies a value.
//
// Class references become code refs, and only where the grammar names a type —
// a filter node's `on` or `type`, a sort entry's `on`. Under `eq` / `in` /
// `contains` / `range` the keys are field names, so an `on` there is a field
// called `on` and a class in that position would lower to nothing, leaving a
// saved search that matches every card instead of one.
//
// The declaration is translated to the card-rooted query first and handed to
// `searchEntryWireQueryFromQuery`, so the `item.` addressing comes from the
// one function that defines it rather than from a second copy of the rule.
export function lowerQueryTemplate(
  declaration: Record<string, unknown> | undefined,
  sink: QueryLoweringSink,
  context: QueryLoweringContext,
): OperationQueryTemplate | undefined {
  if (!declaration) {
    return undefined;
  }
  let filter = declaration.filter
    ? (resolveTypes(declaration.filter, 'filter', context, sink) as Filter)
    : undefined;
  let sort = declaration.sort
    ? (resolveTypes(declaration.sort, 'sortList', context, sink) as Sort)
    : undefined;
  let query: Query = {
    ...(filter ? { filter } : {}),
    ...(sort ? { sort } : {}),
    ...(declaration.page ? { page: declaration.page as Query['page'] } : {}),
  };
  // The realm's own grammar, consulted as a second opinion — but only on a
  // query it could accept as it stands. A marker stands in for a value the
  // realm types concretely (a `matches` string, an `in` array), so a query
  // still holding one is checked when the invocation resolves it.
  if (!holdsMarker(query)) {
    try {
      assertQuery(query);
    } catch (err: any) {
      if (err instanceof InvalidQueryError) {
        sink.add(
          'invalid-query',
          'query',
          `\`query\` is not a query the realm accepts — ${err.message}`,
        );
        return undefined;
      }
      throw err;
    }
  }
  let wire: OperationQueryTemplate;
  try {
    wire = searchEntryWireQueryFromQuery(query);
  } catch (err: any) {
    sink.add(
      'invalid-query',
      'query',
      `\`query\` does not translate to a search request — ${err?.message ?? String(err)}`,
    );
    return undefined;
  }
  if (declaration.queryString !== undefined) {
    // Full text is the wire grammar's `matches` predicate. Alongside a
    // filter it becomes a conjunct, so both constraints hold rather than one
    // replacing the other.
    let matches = declaration.queryString as OperationTemplate;
    wire.filter = wire.filter
      ? { every: [wire.filter, { matches }] }
      : { matches };
  }
  if (declaration.realms) {
    wire.realms = [...(declaration.realms as string[])];
  }
  return wire;
}

// Where in a query the walk currently is. Only the positions that decide
// whether a class belongs are named; everything else is data. Mirrors the
// filter grammar: a filter node carries an optional `on` (or a `type`, for a
// pure card-type filter) and one predicate, `any` / `every` hold further
// nodes, `not` holds one, and a sort entry names the type its `by` path is
// rooted in.
type QueryPosition =
  | 'query'
  | 'filter'
  | 'filterList'
  | 'sortList'
  | 'sortEntry'
  | 'type'
  | 'value';

function positionUnder(position: QueryPosition, key: string): QueryPosition {
  switch (position) {
    case 'query':
      if (key === 'filter') {
        return 'filter';
      }
      return key === 'sort' ? 'sortList' : 'value';
    case 'filter':
      if (key === 'on' || key === 'type') {
        return 'type';
      }
      if (key === 'any' || key === 'every') {
        return 'filterList';
      }
      return key === 'not' ? 'filter' : 'value';
    case 'sortEntry':
      return key === 'on' ? 'type' : 'value';
    default:
      return 'value';
  }
}

function positionInside(position: QueryPosition): QueryPosition {
  switch (position) {
    case 'filterList':
      return 'filter';
    case 'sortList':
      return 'sortEntry';
    default:
      return 'value';
  }
}

// Replace every class reference in a type position with its code ref,
// leaving markers and plain data untouched.
function resolveTypes(
  node: unknown,
  position: QueryPosition,
  context: QueryLoweringContext,
  sink: QueryLoweringSink,
  path = 'query',
): unknown {
  if (typeof node === 'function') {
    let codeRef = context.codeRef(node);
    if (!codeRef) {
      sink.add(
        'unresolved-type',
        path,
        `\`${path}\` names a class that no module exports, so there is no code ref to store for it`,
      );
      return undefined;
    }
    return codeRef;
  }
  if (Array.isArray(node)) {
    let inside = positionInside(position);
    return node.map((entry, index) =>
      resolveTypes(entry, inside, context, sink, `${path}[${index}]`),
    );
  }
  if (!isPlainObject(node) || isMarker(node)) {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      resolveTypes(
        value,
        positionUnder(position, key),
        context,
        sink,
        `${path}.${key}`,
      ),
    ]),
  );
}

function holdsMarker(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(holdsMarker);
  }
  if (!isPlainObject(node)) {
    return false;
  }
  if (isMarker(node) || isBxl(node)) {
    return true;
  }
  return Object.values(node).some(holdsMarker);
}

function isMarker(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && typeof value.$ref === 'string';
}

function isBxl(value: unknown): value is { $bxl: string } {
  return isPlainObject(value) && typeof value.$bxl === 'string';
}
