// A formula's SQL (BXL's score profile). Kept in a module of its own, with no
// imports from the query modules, so the query grammar (query.ts) and its
// lowering (query-syntax.ts) can both use it without importing each other.
import {
  BxlScoreSqlError,
  compileBxlScoreToSql,
} from '@cardstack/bxl/compiler';
import { InvalidQueryError } from './invalid-query-error.ts';

// A formula's SQL, or the reason it is outside the score profile. Fields
// are read from the search doc as numbers (booleans as 1 and 0) or, inside
// DAYS, as dates.
export function exprSortSql(expr: string): string {
  try {
    return compileBxlScoreToSql(expr, {
      fieldToSql(parts, usage) {
        let v = `spill_unmark(i.search_doc #> '{${parts.join(',')}}'::text[])`;
        return usage === 'timestamp'
          ? `(CASE WHEN (${v} #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (${v} #>> '{}')::timestamptz END)`
          : `(CASE jsonb_typeof(${v}) WHEN 'number' THEN (${v} #>> '{}')::double precision WHEN 'boolean' THEN (CASE WHEN ${v} = 'true'::jsonb THEN 1 ELSE 0 END)::double precision END)`;
      },
    }).sql;
  } catch (e) {
    if (e instanceof BxlScoreSqlError) {
      throw new InvalidQueryError(`formula: ${e.message}`);
    }
    throw e;
  }
}
