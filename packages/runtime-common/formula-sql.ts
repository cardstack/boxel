// A formula's SQL (BXL's score profile). Kept in a module of its own, with no
// imports from the query modules, so the query grammar (query.ts) and its
// lowering (query-syntax.ts) can both use it without importing each other.
import {
  BxlScoreSqlError,
  type BxlScoreSqlOptions,
  compileBxlScoreToSql,
  queryExpressionIssues,
} from '@cardstack/bxl/compiler';
import { InvalidQueryError } from './invalid-query-error.ts';
import { sqlTextArrayLiteral, sqlTextLiteral } from './sql-literal.ts';
import {
  DEFAULT_TIME_ZONE,
  isUtcZone,
  sqlZoneLiteral,
  zoneOfClock,
} from './time-zone.ts';

// A formula's SQL, or the reason it is outside the score profile. A field
// reads as BXL's score profile says (score.ts): a number, true and false as 1
// and 0, text that spells a number as that number; a missing field or null
// is a blank (NULL) and any other value is #VALUE! (NaN). Inside MIN, MAX
// and AVERAGE a field reads only a number (and a list field each of its
// numbers), and inside DAYS only a date.
const NUMERIC_TEXT =
  '^\\s*[-+]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][-+]?[0-9]+)?\\s*$';
// A stored date, as BXL's evaluator reads one on a thread (formula-eval.ts):
// the whole value is an ISO date (`yyyy-MM-dd`) or date-time on a real
// calendar day (`pg_input_is_valid`, so a value that only looks like a date
// is no date rather than an error). A date-time with `Z` or an offset is that
// instant; one that names no zone, such as the serializer's local form
// `yyyy-MM-ddTHH:mm`, is read as UTC, never in the session's time zone.
const STORED_DATE =
  '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])([T ]([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)?)?$';

const NAMES_ZONE = '(Z|[+-]\\d{2}:\\d{2})$';

// A value as a jsonb literal, read in place of a field the row holds.
function jsonbLiteral(value: unknown): string {
  if (value === undefined) return 'NULL::jsonb';
  return `${sqlTextLiteral(JSON.stringify(value))}::jsonb`;
}

function readPath(doc: unknown, parts: string[]): unknown {
  let v = doc;
  for (let key of parts) {
    v =
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.prototype.hasOwnProperty.call(v, key)
          ? (v as Record<string, unknown>)[key]
          : undefined
        : undefined;
  }
  return v;
}

// A formula's SQL. `bindings` are a query's one-card `let` bindings, each the
// bound card's search doc (null when the binding found no card): a path that
// starts with a binding's name reads that card, as an expression sort does, in
// place of a field of the row.
// The SQL with every `now()` the score profile emits (NOW(), TODAY(), DAYS
// from now) read as `now`: one query's one instant, so its statements, and a
// formula in SQL and the same formula on a thread, agree. Quoted text is left
// as written.
function atInstant(
  sql: string,
  now: Date | undefined,
  instant = now ? `'${now.toISOString()}'::timestamptz` : '',
): string {
  if (!now) return sql;
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (sql.startsWith('now()', i) && !/[\w$]/.test(sql[i - 1] ?? '')) {
      out += instant;
      i += 'now()'.length;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

interface ScoreSqlReads {
  percentRankToSql?: BxlScoreSqlOptions['percentRankToSql'];
  countIfToSql?: BxlScoreSqlOptions['countIfToSql'];
  peerReductionToSql?: BxlScoreSqlOptions['peerReductionToSql'];
  onFieldRead?: (parts: string[]) => void;
}

// In a time zone other than UTC (the zone the clock reading carries, see
// time-zone.ts) every date inside DAYS is the zone's wall time, a
// `timestamp`: NOW() is the instant's wall time there, TODAY() the zone's
// midnight, a stored date-time its wall time there and a date (`yyyy-MM-dd`)
// that calendar day's midnight. DAYS is then the difference on the zone's
// clock, as BXL on a thread reckons it (`toWallClock`), so a date and TODAY()
// are whole days apart.
export function exprSortSql(
  expr: string,
  bindings?: Record<string, Record<string, unknown> | null>,
  now?: Date,
  reads?: ScoreSqlReads,
): string {
  let zone = zoneOfClock(now);
  let sql = exprSortSqlAsCompiled(expr, bindings, zone, reads);
  if (now && !isUtcZone(zone)) {
    // the score profile emits TODAY() as UTC midnight and NOW() as now()
    let z = sqlZoneLiteral(zone);
    let wall = `('${now.toISOString()}'::timestamptz AT TIME ZONE ${z})`;
    // (query-time-zone-integration-test.ts pins TODAY_IN_UTC's shape)
    return sql
      .split(TODAY_IN_UTC)
      .map((part) => atInstant(part, now, wall))
      .join(`date_trunc('day', ${wall})`);
  }
  return atInstant(sql, now);
}

const TODAY_IN_UTC =
  "(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')";

function exprSortSqlAsCompiled(
  expr: string,
  bindings?: Record<string, Record<string, unknown> | null>,
  zone: string = DEFAULT_TIME_ZONE,
  reads?: ScoreSqlReads,
): string {
  try {
    return compileBxlScoreToSql(expr, {
      percentRankToSql: reads?.percentRankToSql,
      countIfToSql: reads?.countIfToSql,
      peerReductionToSql: reads?.peerReductionToSql,
      fieldToSql(parts, usage) {
        // a comparison set's `peers.<field>` is a list: a function over a
        // list reads it (COUNT, SUM, MIN, MAX, AVERAGE, MEDIAN,
        // PERCENTRANK_INC, COUNTIF); arithmetic on it has no value
        if (
          parts[0] === 'peers' &&
          parts.length > 1 &&
          usage !== 'numbers' &&
          usage !== 'aggregate' &&
          usage !== 'json'
        ) {
          throw new BxlScoreSqlError(
            `${parts.join('.')} is a list of the comparison set's values: read it with a function over a list (COUNT, SUM, MIN, MAX, AVERAGE, MEDIAN, PERCENTRANK_INC, COUNTIF), not in arithmetic or a comparison.`,
          );
        }
        reads?.onFieldRead?.(parts);
        let bound =
          bindings &&
          parts.length > 0 &&
          Object.prototype.hasOwnProperty.call(bindings, parts[0]);
        let v = bound
          ? `(${jsonbLiteral(readPath(bindings![parts[0]], parts.slice(1)))})`
          : `spill_unmark(i.search_doc #> ${sqlTextArrayLiteral(parts)})`;
        let text = `(${v} #>> '{}')`;
        switch (usage) {
          case 'json':
            // the value as stored, for a function that reads its type
            return v;
          case 'timestamp':
            if (!isUtcZone(zone)) {
              let z = sqlZoneLiteral(zone);
              return `(CASE WHEN ${text} ~ '${STORED_DATE}' AND pg_input_is_valid(${text}, 'timestamp') THEN (CASE WHEN ${text} ~ '${NAMES_ZONE}' THEN ${text}::timestamptz AT TIME ZONE ${z} WHEN ${text} ~ '[T ]' THEN ${text}::timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${z} ELSE ${text}::timestamp END) END)`;
            }
            return `(CASE WHEN ${text} ~ '${STORED_DATE}' AND pg_input_is_valid(${text}, 'timestamp') THEN (CASE WHEN ${text} ~ '${NAMES_ZONE}' THEN ${text}::timestamptz ELSE ${text}::timestamp AT TIME ZONE 'UTC' END) END)`;
          case 'numbers':
            // a list's numbers; empty for a field that is not a list
            return `ARRAY(SELECT (bxl_e #>> '{}')::double precision FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${v}) = 'array' THEN ${v} ELSE '[]'::jsonb END) AS bxl_e WHERE jsonb_typeof(bxl_e) = 'number')`;
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
      throw new InvalidQueryError(
        `expression: ${e.message}`,
        'invalid-expression',
      );
    }
    throw e;
  }
}

// The field paths a formula reads, as its SQL reads them; undefined for a
// formula outside the score profile (which a query refuses).
export function exprFieldPaths(expr: string): string[][] | undefined {
  let paths: string[][] = [];
  try {
    compileBxlScoreToSql(expr, {
      fieldToSql(parts) {
        paths.push([...parts]);
        return 'NULL';
      },
    });
  } catch {
    return undefined;
  }
  return paths;
}

// An expression inside a query runs under BXL's query profile: spreadsheet
// functions, arithmetic, comparisons and logic, field paths and the names it
// binds itself. A jq pipe, a helper (`def`), an update, a stream, a read of
// the environment or the request, and a module directive are refused with
// `invalid-expression`, naming the construct. Full BXL stays for computed
// fields.
export function assertQueryExpressionProfile(
  member: string,
  expr: unknown,
): void {
  // past the 2,000-character limit the query is refused for its length,
  // without parsing it
  if (typeof expr !== 'string' || expr.length > 2000) return;
  let issues = queryExpressionIssues(expr);
  if (issues.length) {
    let messages = [...new Set(issues.map((issue) => issue.message))];
    throw new InvalidQueryError(
      `${member} ${JSON.stringify(expr.length > 120 ? `${expr.slice(0, 120)}…` : expr)}: ${messages.join(' ')}`,
      'invalid-expression',
    );
  }
}
