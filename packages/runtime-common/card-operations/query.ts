import {
  OperationFailure,
  type OperationDefinition,
  type OperationQueryTemplate,
} from './types.ts';
import {
  parseSearchEntryQueryFromPayload,
  type SearchEntryWireQuery,
} from '../search-entry.ts';

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
  // The invoking user's id, which is what `actor()` resolves to and the whole
  // of what the realm knows about the caller.
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
      // an actor is the caller's user id — which is the whole of what the
      // realm knows about them, so the marker carries no key and a stored one
      // names a member that does not exist.
      if (marker.key !== undefined) {
        throw invalidParams(
          path,
          `references actor("${String(marker.key)}"); the caller is a user id with no members to read`,
        );
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
