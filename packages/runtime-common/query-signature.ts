import { canonicalModuleKey } from './code-ref.ts';
import {
  buildQueryParamValue,
  isReferenceFilterField,
  normalizeQueryForSignature,
  type Query,
} from './query.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// A spelling-tolerant identity signature for a query. Two queries that differ
// only in how they spell module references (`on`/`type` code refs, sort `on`
// refs) or reference-field filter values (`id`/`url` under `eq`/`in`) — RRI
// prefix vs real URL vs virtual alias — produce the same signature.
//
// The consumer is seed/live query reconciliation: a server-produced seed
// query (built through the server's VirtualNetwork, URL-form refs) must be
// recognized as "the same query" as the client's rebuild of it (RRI-space,
// prefix-form refs for mapped realms), otherwise every server-seeded query
// field re-fetches results the seed already answered.
//
// Correctness note: this is a comparison key, not a semantic transform — both
// sides of a comparison pass through the same canonicalization, so the only
// requirement is that the mapping is deterministic and collapses exactly the
// equivalent spellings (`canonicalModuleKey` guarantees that: prefix and
// virtual spellings fold onto the real URL; unmapped values pass through).
export function canonicalQuerySignature(
  query: Query,
  virtualNetwork: VirtualNetwork,
): string {
  return buildQueryParamValue(
    canonicalizeNode(
      normalizeQueryForSignature(query),
      virtualNetwork,
    ) as Query,
  );
}

function canonicalizeNode(
  node: unknown,
  virtualNetwork: VirtualNetwork,
): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => canonicalizeNode(entry, virtualNetwork));
  }
  if (node && typeof node === 'object') {
    let out: Record<string, unknown> = {};
    for (let [key, value] of Object.entries(node)) {
      if (
        (key === 'eq' || key === 'in') &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        out[key] = canonicalizeFieldValues(
          value as Record<string, unknown>,
          virtualNetwork,
        );
      } else {
        out[key] = canonicalizeNode(value, virtualNetwork);
      }
    }
    // A code-ref-shaped node ({ module, name }) — `on`/`type` gates and sort
    // entries — compares by its resolved module identity.
    if (typeof out.module === 'string' && typeof out.name === 'string') {
      out.module = canonicalModuleKey(out.module, virtualNetwork);
    }
    return out;
  }
  return node;
}

function canonicalizeFieldValues(
  fields: Record<string, unknown>,
  virtualNetwork: VirtualNetwork,
): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (let [path, value] of Object.entries(fields)) {
    out[path] = isReferenceFilterField(path)
      ? canonicalizeReferenceValue(value, virtualNetwork)
      : canonicalizeNode(value, virtualNetwork);
  }
  return out;
}

function canonicalizeReferenceValue(
  value: unknown,
  virtualNetwork: VirtualNetwork,
): unknown {
  if (typeof value === 'string') {
    return canonicalModuleKey(value, virtualNetwork);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      canonicalizeReferenceValue(entry, virtualNetwork),
    );
  }
  return value;
}
