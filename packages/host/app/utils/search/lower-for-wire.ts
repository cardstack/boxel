import {
  assertAuthoredQuerySpelling,
  lowerQuery,
  usesNewSyntax,
  type Query,
} from '@cardstack/runtime-common';

// A query in the newer spelling, rewritten as the older one the entry wire
// translator (`searchEntryWireQueryFromQuery`) reads. The translator knows
// only the older spelling: it drops a top-level `type`, so the filter loses
// its anchor and the search finds nothing, and it refuses `exists` and
// `missing`. The HTTP path lowers the same way before it wires a query
// (`lowerEntryPayload`), and lowering produces exactly the older query, so a
// query in the older spelling is returned as it is.
//
// The query must already have passed `assertQuery`, which lowers a newer
// query to check it and refuses an unknown BXL function there. It is an
// author's query, so one in the newer spelling that names its type the older
// way (an `on` on its top filter node) is refused here, with the rewrite
// (`mixed-spelling`): the server cannot tell it from the engine's own form.
export function lowerForWire(query: Query): Query {
  assertAuthoredQuerySpelling(query);
  if (!usesNewSyntax(query)) {
    return query;
  }
  return lowerQuery(query as Record<string, any>).query as Query;
}
