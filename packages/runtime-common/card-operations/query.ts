import {
  OperationFailure,
  type OperationDefinition,
  type OperationQueryTemplate,
} from './types.ts';
import type { SearchEntryWireQuery } from '../search-entry.ts';

// ============================================================================
// Resolving a declared query at invocation time.
//
// Lowering leaves a declared query as an entry-wire query template: the shape
// the realm's `_search` and `_federated-search` endpoints take, with markers
// standing where a value is only known when someone invokes the operation.
// This fills those in and yields a concrete wire query.
//
// It is a pure function, and it runs on both sides. The realm never executes a
// query through the operation core — a query runs on the search engine, the
// one place a query is planned — and the host resolves the same template
// against the same rules so a saved search means the same thing wherever it is
// evaluated.
// ============================================================================

export interface QueryInvocation {
  // The invoking user's identity, as `actor()` resolves to. Only the identity
  // is available: resolving any other member of the actor would mean loading
  // the actor's card, which a query is not entitled to do.
  actor: string;
  // The payload, keyed the way the definition's `params` schema declares it.
  params?: Record<string, unknown>;
  // The realms to search when the declaration named none. An authored `realms`
  // is a deliberate scope and is left alone.
  realms?: string[];
}

export function lowerQueryOperation(
  definition: OperationDefinition,
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
  return query;
}

// Walk the template, replacing every marker with the value this invocation
// supplies and leaving plain data untouched. A marker is a plain object
// carrying a `$ref`, so the walk recognizes one structurally wherever it
// sits — a filter operand, a `matches` term, a member of an `in` list.
function resolveMarkers(
  node: unknown,
  definition: OperationDefinition,
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
  definition: OperationDefinition,
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
      // an actor is the actor's identity. A keyed `actor("name")` would need
      // the actor's card loaded, so only the identity resolves.
      if (marker.key !== undefined && marker.key !== 'id') {
        throw invalidParams(
          path,
          `references actor("${String(marker.key)}"); a query can only compare against the actor's identity`,
        );
      }
      return invocation.actor;
    case 'card':
      // The explicit "this is a card" spelling. In a query every card-valued
      // slot is a comparison against a stored identity rather than a write, so
      // what the marker wraps resolves to that identity and the wrapper adds
      // nothing around it.
      return resolveMarkers(marker.value, definition, invocation, path);
    case 'instance':
      // A query is rooted in a type, not in one card, so there is no target
      // whose stored values `instance()` could read.
      throw invalidParams(
        path,
        'references instance(), which a query has no target to resolve against',
      );
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
