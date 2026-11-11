// The facet table (`boxel_index_facet_values`, see the
// add-boxel-index-facet-values migration): how a card's declared facet values
// are read out of its search doc into rows, at promotion (index-writer's
// `#syncFacetIndex`) and when a type's facet declarations change without its
// cards being rendered again (`backfillFacetValues`). Both run the one
// extraction below, so a row holds what the facet read always counted: each
// element of a list, a link's id, the value as text, its number when it is a
// JSON number, and, for a date field, its UTC instant.

import { any, every, param, query, type Expression } from './expression.ts';
import type { DBAdapter } from './index.ts';
import type { Definition } from './definitions.ts';
import type { FacetFieldSpecs } from './search-intent.ts';
import { SEARCH_TEXT_KEY } from './search-intent.ts';

// A value's UTC instant: a number is epoch seconds (or milliseconds); text on
// a real calendar day is a date or date-time, `Z` or an offset naming its
// instant and a value with no zone read as UTC. Anything else is none.
const VALUE_TEXT = `(e.value #>> '{}')`;
const VALUE_NUM = `${VALUE_TEXT}::numeric`;
const INSTANT = String.raw`CASE WHEN jsonb_typeof(e.value) = 'number' AND abs(${VALUE_NUM}) < 1000000000000000 THEN to_timestamp((CASE WHEN abs(${VALUE_NUM}) >= 100000000000 THEN ${VALUE_NUM} / 1000 ELSE ${VALUE_NUM} END)::float8) WHEN jsonb_typeof(e.value) = 'string' AND ${VALUE_TEXT} ~ '^\d{4}-\d{2}-\d{2}' AND pg_input_is_valid(${VALUE_TEXT}, 'timestamptz') THEN (CASE WHEN ${VALUE_TEXT} ~ '[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)$' THEN ${VALUE_TEXT}::timestamptz ELSE ${VALUE_TEXT}::timestamp AT TIME ZONE 'UTC' END) END`;

// The lax JSON path that steps into every list on the way to a field
// (`lax $."items"."name"[*]`), for a facet path that crosses a list.
const LAX_PATH = String.raw`('lax $' || (SELECT string_agg('."' || replace(replace(u.seg, '\', '\\'), '"', '\"') || '"', '' ORDER BY u.n) FROM unnest(r.segs) WITH ORDINALITY AS u(seg, n)) || '[*]')::jsonpath`;

// The longest value kept: no facet counts by a paragraph, and a btree entry
// has a size limit.
export const MAX_FACET_VALUE_LENGTH = 1024;

// `INSERT … SELECT` of the facet rows of `table`'s rows (aliased `p`), each
// read with the specs `specs` evaluates to (a jsonb object keyed by facet
// path). The caller follows it with `WHERE` and its row conditions, then
// `facetValueRowsInsertEnd`.
export function facetValueRowsInsert(
  table: string,
  specs: Expression = [`p.search_doc -> '${SEARCH_TEXT_KEY}' -> 'facets'`],
): Expression {
  return [
    'INSERT INTO boxel_index_facet_values (realm_url, url, type, field_path, txt, num, ts)',
    'SELECT DISTINCT ON (x.realm_url, x.url, x.type, x.field_path, x.txt) x.realm_url, x.url, x.type, x.field_path, x.txt, x.num, x.ts FROM (',
    'SELECT p.realm_url, p.url, p.type, s.key AS field_path,',
    `CASE WHEN s.spec ? 'link' THEN e.value ->> 'id' ELSE ${VALUE_TEXT} END AS txt,`,
    `CASE WHEN NOT (s.spec ? 'link') AND jsonb_typeof(e.value) = 'number' THEN ${VALUE_NUM} END AS num,`,
    `CASE WHEN s.spec ? 'date' THEN ${INSTANT} END AS ts`,
    `FROM ${table} AS p`,
    'CROSS JOIN LATERAL jsonb_each(',
    ...specs,
    ') AS s(key, spec)',
    `CROSS JOIN LATERAL (SELECT string_to_array(COALESCE(s.spec ->> 'read', s.key), '.') AS segs) AS r`,
    `CROSS JOIN LATERAL (SELECT CASE WHEN s.spec ? 'list' THEN COALESCE(spill_unmark(p.search_doc #> r.segs), jsonb_path_query_array(p.search_doc, ${LAX_PATH})) ELSE spill_unmark(p.search_doc #> r.segs) END AS v) AS d`,
    `CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.v) = 'array' THEN d.v ELSE jsonb_build_array(d.v) END) AS e(value)`,
  ];
}

export const facetValueRowsInsertEnd: Expression = [
  `AND jsonb_typeof(e.value) <> 'null'`,
  `) AS x WHERE x.txt IS NOT NULL AND length(x.txt) <= ${MAX_FACET_VALUE_LENGTH}`,
  'ORDER BY x.realm_url, x.url, x.type, x.field_path, x.txt, x.num NULLS LAST',
];

// Rewrites the facet rows of one card type's cards in a realm from their
// indexed search docs, for `specs`, the type's declared facet fields
// (`facetFieldSpecsOf` over its new definition). Used when a module change
// touched only a type's `search` declarations: the cards' search docs are
// unchanged, so their facet rows follow from SQL alone, with no render.
// `typeKey` is the type's internal key: the cards whose own type it is
// (`types[0]`) are rewritten, never a subclass's, whose definition is its
// own. Every facet path of those cards is replaced, so a declaration that
// was removed takes its rows with it. Postgres only.
export async function backfillFacetValues(
  dbAdapter: DBAdapter,
  realmURL: string,
  typeKey: string,
  specs: FacetFieldSpecs,
): Promise<void> {
  if (dbAdapter.kind !== 'pg') {
    return;
  }
  await query(dbAdapter, [
    'DELETE FROM boxel_index_facet_values AS f USING boxel_index AS b',
    'WHERE f.realm_url = b.realm_url AND f.url = b.url AND f.type = b.type',
    'AND b.realm_url =',
    param(realmURL),
    "AND b.type = 'instance' AND b.types ->> 0 =",
    param(typeKey),
  ]);
  if (Object.keys(specs).length === 0) {
    return;
  }
  await query(dbAdapter, [
    ...facetValueRowsInsert('boxel_index', [
      param(JSON.stringify(specs)),
      '::jsonb',
    ]),
    'WHERE',
    ...(every([
      ['p.realm_url =', param(realmURL)],
      ["p.type = 'instance'"],
      any([['p.is_deleted = false'], ['p.is_deleted IS NULL']]),
      ['p.types ->> 0 =', param(typeKey)],
    ] as Expression[]) as Expression),
    ...facetValueRowsInsertEnd,
  ]);
}

// Whether `next` differs from `previous` only in facet declarations: each
// field's `search.facet` and the type's `facetValue`. Such a change leaves
// every card's search doc as it was, so its facet rows can be rewritten by
// `backfillFacetValues` instead of rendering the cards again. Any other
// difference (a field added, a role changed, which changes the full-text
// vectors) needs the render. Compares the definitions' own entries only; a
// compound's FieldDef is its own definition and is compared on its own.
export function onlyFacetDeclarationsDiffer(
  previous: Definition,
  next: Definition,
): boolean {
  let stripped = (definition: Definition) => {
    let { facetValue: _facetValue, fields, fieldDefs, ...rest } = definition;
    let byName: Record<string, unknown> = {};
    for (let [name, id] of Object.entries(fields)) {
      let field = fieldDefs[id];
      if (!field) {
        byName[name] = null;
        continue;
      }
      let search = field.search;
      if (search && typeof search === 'object' && 'facet' in search) {
        let { facet: _facet, ...otherSearch } = search;
        byName[name] = {
          ...field,
          search: Object.keys(otherSearch).length ? otherSearch : undefined,
        };
      } else {
        byName[name] = field;
      }
    }
    return { ...rest, fields: byName };
  };
  return (
    stableJSON(stripped(previous)) === stableJSON(stripped(next)) &&
    stableJSON(previous) !== stableJSON(next)
  );
}

function stableJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJSON).join(',')}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableJSON((value as Record<string, unknown>)[k])}`,
    )
    .join(',')}}`;
}
