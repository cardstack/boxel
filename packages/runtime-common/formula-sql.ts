// A formula's SQL (BXL's score profile). Kept in a module of its own, with no
// imports from the query modules, so the query grammar (query.ts) and its
// lowering (query-syntax.ts) can both use it without importing each other.
import {
  BxlScoreSqlError,
  compileBxlScoreToSql,
} from '@cardstack/bxl/compiler';
import { InvalidQueryError } from './invalid-query-error.ts';

// A formula's SQL, or the reason it is outside the score profile. A field
// reads as BXL's score profile says (score.ts): a number, true and false as 1
// and 0, text that spells a number as that number; a missing field or null
// is a blank (NULL) and any other value is #VALUE! (NaN). Inside MIN, MAX
// and AVERAGE a field reads only a number, and inside DAYS only a date.
const NUMERIC_TEXT =
  '^\\s*[-+]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][-+]?[0-9]+)?\\s*$';
export function exprSortSql(expr: string): string {
  try {
    return compileBxlScoreToSql(expr, {
      fieldToSql(parts, usage) {
        let v = `spill_unmark(i.search_doc #> '{${parts.join(',')}}'::text[])`;
        let text = `(${v} #>> '{}')`;
        switch (usage) {
          case 'timestamp':
            return `(CASE WHEN ${text} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN ${text}::timestamptz END)`;
          case 'aggregate':
            return `(CASE jsonb_typeof(${v}) WHEN 'number' THEN ${text}::double precision END)`;
          default: {
            // in a comparison text ranks above every number; in arithmetic
            // text that spells a number is that number
            let asText =
              usage === 'compare'
                ? `'Infinity'::double precision`
                : `(CASE WHEN ${text} ~ '${NUMERIC_TEXT}' THEN ${text}::double precision ELSE ${usage === 'passthrough' ? 'NULL' : `'NaN'::double precision`} END)`;
            return `(CASE jsonb_typeof(${v}) WHEN 'number' THEN ${text}::double precision WHEN 'boolean' THEN (CASE WHEN ${v} = 'true'::jsonb THEN 1 ELSE 0 END)::double precision WHEN 'null' THEN NULL WHEN 'string' THEN ${asText} WHEN 'array' THEN 'NaN'::double precision WHEN 'object' THEN 'NaN'::double precision END)`;
          }
        }
      },
    }).sql;
  } catch (e) {
    if (e instanceof BxlScoreSqlError) {
      throw new InvalidQueryError(`formula: ${e.message}`);
    }
    throw e;
  }
}
