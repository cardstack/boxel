import type { CodeRef } from '@cardstack/runtime-common/code-ref';

const ITEM_PREFIX = 'item.';
const ITEM_ANCHOR = 'item.on';
const FIELD_KEYED_OPERATORS = ['eq', 'contains', 'in', 'range'];

interface CapsuleQuery {
  filter?: Record<string, unknown>;
  sort?: Array<{
    by: string;
    on?: CodeRef;
    direction?: 'asc' | 'desc';
  }>;
  page?: { number?: number; size: number; generation?: number };
}

function wireFilterFromFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(filter)) {
    if (key === 'type' || key === 'on') {
      out[ITEM_ANCHOR] = value;
    } else if (key === 'any' || key === 'every') {
      out[key] = (value as Record<string, unknown>[]).map(wireFilterFromFilter);
    } else if (key === 'not') {
      out.not = wireFilterFromFilter(value as Record<string, unknown>);
    } else if (FIELD_KEYED_OPERATORS.includes(key)) {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([fieldPath, fieldValue]) => [
            `${ITEM_PREFIX}${fieldPath}`,
            fieldValue,
          ],
        ),
      );
    } else if (key === 'matches') {
      out.matches = value;
    } else {
      throw new Error(
        `cannot translate filter member "${key}" to the entry wire grammar`,
      );
    }
  }
  return out;
}

export function capsuleSearchEntryWireQueryFromQuery(
  query: CapsuleQuery,
  opts?: { fields?: string[]; scope?: 'cards' | 'files' | 'all' },
): Record<string, unknown> {
  let wire: Record<string, unknown> = {};
  if (query.filter) {
    wire.filter = wireFilterFromFilter(query.filter);
  }
  if (query.sort) {
    wire.sort = query.sort.map((entry) => ({
      by: `${ITEM_PREFIX}${entry.by}`,
      ...(entry.on ? { [ITEM_ANCHOR]: entry.on } : {}),
      ...(entry.direction ? { direction: entry.direction } : {}),
    }));
  }
  if (query.page) {
    wire.page = query.page;
  }
  if (opts?.fields) {
    wire.fields = { entry: [...opts.fields] };
  }
  if (opts?.scope) {
    wire.scope = opts.scope;
  }
  return wire;
}
