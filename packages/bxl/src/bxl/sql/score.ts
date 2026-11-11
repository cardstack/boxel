// The score profile: a spreadsheet formula over one record's fields, lowered
// to a SQL number so a database can rank every row by it (a search's
// `_expr` sort). The profile is what Postgres can compute per row:
//
// - numbers, field references (`rating`, `brand.name`, `.priceMin`)
// - `+ - * / %`, unary minus, `^` (POWER)
// - comparisons and `and` / `or`, inside conditions
// - IF, IFERROR, IFNA, ISBLANK, AND, OR, NOT, ROUND, ROUNDUP, ROUNDDOWN,
//   ABS, SIGN, SQRT, POWER, EXP, LN, LOG, LOG10, PI, MIN, MAX, AVERAGE,
//   FLOOR, CEILING, DAYS, NOW, TODAY
//
// Anything else is refused with the reason, a call the profile does not
// implement included: `RAND()` is never read as a field named RAND. Blanks and errors follow Excel,
// and stay apart: a blank (a missing field) is SQL NULL and an error is NaN.
//
// - A blank is 0 in arithmetic and in a comparison, so `rating * 2` is 0 and
//   `rating = 0` is true for a card with no rating. IF on a blank takes the
//   else branch; NOT of a blank is true.
// - MIN, MAX and AVERAGE skip blanks, and a field they read directly skips
//   anything that is not a number, as Excel skips them in a range. A list
//   field they read directly gives each of its numbers.
// - Dates are instants. A stored date or date-time that names no zone is
//   read as UTC, and TODAY() is midnight UTC, whatever the database session's
//   time zone is.
// - A division by zero, the log of a non-positive number, the root of a
//   negative one or an overflow is an error, and an error propagates through
//   arithmetic, comparisons, IF's condition and AND / OR / NOT.
// - IFERROR catches errors only: a blank passes through it. IFNA catches #N/A
//   only, which nothing in this profile raises.
// - A field holding text, a list or an object is #VALUE! in arithmetic.
//
// The formula's value is NULL when it is blank or an error, so such a row
// ranks last (or, in a blend, gets nothing from the signal).
// `prepareSpreadsheetFormula` (formula-eval.ts) computes the same values in
// JavaScript, for the formulas a database cannot run.
//
// Numbers are inlined (they are checked finite), so the result needs no
// parameters; fields reach the SQL only through `fieldToSql`.
import { parseBxlAst, type BxlAstNode } from '../ast/index.ts';
import { JQ_KEYWORDS } from '../compiler/lexicon.ts';
import {
  BXL_COMMA_ARGUMENT_HELPERS,
  tokenizeReadableSyntax,
  type ReadableSyntaxToken,
} from '../compiler/readable-syntax.ts';
import { resolveBuiltinRegistry } from '../registry/index.ts';

// `number`: a number, NULL for a blank, NaN (an error) for anything else.
// `aggregate`: a number, NULL for anything else (MIN, MAX and AVERAGE skip it).
// `passthrough`: as `number`, but text that is not a number is NULL
// (IFERROR's value keeps text, and text has no score).
// `compare`: as `number`, but text is +Infinity, since Excel ranks text above
// every number (and never equal to one) rather than raising an error.
// `numbers`: a list's numbers as a `double precision[]`; empty (or NULL) for
// a field that is not a list.
// `timestamp`: a date as a `timestamptz`, NULL for anything else. A value
// that names no zone is read as UTC, not in the session's time zone.
export type BxlScoreSqlUsage =
  | 'number'
  | 'passthrough'
  | 'compare'
  | 'aggregate'
  | 'numbers'
  | 'timestamp'
  | 'json';

export interface BxlScoreSqlOptions {
  // The SQL for a field, read as `usage` says.
  fieldToSql: (parts: string[], usage: BxlScoreSqlUsage) => string;
}

export interface BxlScoreSqlResult {
  sql: string;
  // Every field path the formula reads, dotted.
  fields: string[];
  source: string;
}

export class BxlScoreSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BxlScoreSqlError';
  }
}

export const BXL_SCORE_FUNCTIONS = [
  'IF',
  'IFERROR',
  'IFNA',
  'ISBLANK',
  'AND',
  'OR',
  'NOT',
  'ROUND',
  'ROUNDUP',
  'ROUNDDOWN',
  'ABS',
  'SIGN',
  'SQRT',
  'POWER',
  'EXP',
  'LN',
  'LOG',
  'LOG10',
  'PI',
  'MIN',
  'MAX',
  'AVERAGE',
  'FLOOR',
  'CEILING',
  'DAYS',
  'NOW',
  'TODAY',
  'NA',
  'COUNT',
  'SUM',
  'MEDIAN',
  'STANDARDIZE',
  'PERCENTRANK_INC',
  'COUNTIF',
] as const;
const FUNCTIONS = new Set<string>(BXL_SCORE_FUNCTIONS);
// Names that are functions even written without parentheses; any other bare
// name is a field. The score profile and the spreadsheet interpreter
// (formula-eval.ts) share the list, so a name is a field in both or neither.
export const BXL_NULLARY_FUNCTIONS: ReadonlySet<string> = new Set([
  'NOW',
  'TODAY',
  'PI',
  'RAND',
  'NA',
  'TRUE',
  'FALSE',
]);
const FIELD_KEY = /^[A-Za-z_$][\w$]*$/;
const MAX_SOURCE_LENGTH = 2000;
const MAX_NODES = 200;
// IF and the error checks read an argument more than once, so nesting grows
// the SQL; past this it is refused.
const MAX_SQL_LENGTH = 100_000;

// A formula's syntax tree, with the profile's limits on its size.
export function parseScoreFormula(source: string): BxlAstNode {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new BxlScoreSqlError('A score formula cannot be empty.');
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new BxlScoreSqlError(
      `A score formula is at most ${MAX_SOURCE_LENGTH} characters.`,
    );
  }
  let program;
  try {
    program = parseBxlAst(source.trim(), {});
  } catch (e) {
    throw new BxlScoreSqlError(
      `The formula does not parse: ${(e as Error).message}`,
    );
  }
  if (!program.body) {
    throw new BxlScoreSqlError('A score formula cannot be empty.');
  }
  return program.body;
}

export function compileBxlScoreToSql(
  source: string,
  options: BxlScoreSqlOptions,
): BxlScoreSqlResult {
  let body = parseScoreFormula(source);
  let compiler = new ScoreCompiler(options, emptyCallNames(source));
  let value = compiler.number(body);
  // an error has no score, as a blank has none
  let sql = `NULLIF(${value}, ${ERR})`;
  if (sql.length > MAX_SQL_LENGTH) {
    throw new BxlScoreSqlError(
      'The formula is too deeply nested to run as SQL.',
    );
  }
  return { sql, fields: [...compiler.fields], source };
}

class ScoreCompiler {
  fields = new Set<string>();
  #nodes = 0;
  #memo = new Map<BxlAstNode, Map<BxlScoreSqlUsage, string>>();
  private options: BxlScoreSqlOptions;
  private emptyCalls: ReadonlySet<string>;
  constructor(options: BxlScoreSqlOptions, emptyCalls: ReadonlySet<string>) {
    this.options = options;
    this.emptyCalls = emptyCalls;
  }

  #visit() {
    if (++this.#nodes > MAX_NODES) {
      throw new BxlScoreSqlError(
        `A score formula has at most ${MAX_NODES} parts.`,
      );
    }
  }

  // A numeric SQL expression (double precision): NULL for a blank, NaN for
  // an error.
  number(node: BxlAstNode, usage: BxlScoreSqlUsage = 'number'): string {
    // a node read twice (inside a CASE) is compiled and counted once
    let memo = this.#memo.get(node);
    let hit = memo?.get(usage);
    if (hit !== undefined) return hit;
    let sql = this.#number(node, usage);
    if (!memo) this.#memo.set(node, (memo = new Map()));
    memo.set(usage, sql);
    return sql;
  }

  #number(node: BxlAstNode, usage: BxlScoreSqlUsage): string {
    this.#visit();
    let field = this.#fieldParts(node);
    if (field) {
      return this.#field(field, usage);
    }
    switch (node.type) {
      case 'literal':
        if (node.valueType === 'number') {
          if (!Number.isFinite(node.value)) {
            throw new BxlScoreSqlError('Numbers in a formula must be finite.');
          }
          return `(${node.value}::double precision)`;
        }
        if (node.valueType === 'boolean') {
          return node.value ? '(1::double precision)' : '(0::double precision)';
        }
        if (node.valueType === 'null') {
          return '(NULL::double precision)';
        }
        throw new BxlScoreSqlError(
          'A score formula computes a number; text values are not part of the score profile.',
        );
      case 'unary':
        if (node.operator === '-') {
          return `(-${num(this.number(node.expr))})`;
        }
        if (node.operator === '+') {
          return this.number(node.expr);
        }
        break;
      case 'binary': {
        let op = node.operator;
        if (op === '+' || op === '-' || op === '*') {
          let a = num(this.number(node.left));
          let b = num(this.number(node.right));
          return op === '*' ? mul(a, b) : add(op, a, b);
        }
        // the divisor is read once: NULLIF turns 0 into NULL, which the
        // quotient keeps and COALESCE turns into #DIV/0!
        if (op === '/') {
          let a = num(this.number(node.left));
          let b = num(this.number(node.right));
          return `COALESCE(${div(a, `NULLIF(${b}, 0)`)}, ${ERR})`;
        }
        if (op === '%') {
          let a = num(this.number(node.left));
          let b = num(this.number(node.right));
          return `COALESCE((CAST(${a} AS numeric) % NULLIF(CAST(${b} AS numeric), 0))::double precision, ${ERR})`;
        }
        if (op === 'and' || op === 'or') {
          return this.#logical(op.toUpperCase() as 'AND' | 'OR', [
            node.left,
            node.right,
          ]);
        }
        // NOT(x) arrives as `x | not`
        if (
          op === '|' &&
          node.right.type === 'call' &&
          node.right.name === 'not' &&
          node.right.args.length === 0
        ) {
          return this.#call('NOT', [node.left]);
        }
        if (COMPARISONS[op]) {
          return this.#compare(node, '1::double precision', FALSE);
        }
        break;
      }
      case 'if': {
        let branches = [{ cond: node.cond, then: node.then }, ...node.elifs];
        let out = node.else ? this.number(node.else) : FALSE;
        for (let b of branches.reverse()) {
          out = this.#if(b.cond, this.number(b.then), out);
        }
        return out;
      }
      case 'call':
        return this.#call(node.name.toUpperCase(), this.#args(node));
    }
    throw new BxlScoreSqlError(
      `${describe(node)} is not part of the score profile: a formula uses numbers, fields, arithmetic, comparisons and ${BXL_SCORE_FUNCTIONS.join(', ')}.`,
    );
  }

  // Each value below is read once: Postgres evaluates a simple CASE's
  // operand once, NULLIF's and COALESCE's arguments once, and ranks NaN above
  // every number, so GREATEST of anything with an error is the error.

  // IF: an error in the condition is the result, a blank is false. A
  // comparison goes into the CASE itself.
  #if(condNode: BxlAstNode, then: string, otherwise: string): string {
    if (condNode.type === 'binary' && COMPARISONS[condNode.operator]) {
      return this.#compare(condNode, then, otherwise);
    }
    let cond = num(this.number(condNode));
    return `(CASE ${cond} WHEN ${ERR} THEN ${ERR} WHEN 0 THEN ${otherwise} ELSE ${then} END)`;
  }

  // A comparison, by the sign of the difference: NaN when either side is an
  // error, and a field's text (+Infinity) above every number.
  #compare(
    node: Extract<BxlAstNode, { type: 'binary' }>,
    then: string,
    otherwise: string,
  ): string {
    let a = num(this.number(node.left, 'compare'));
    let b = num(this.number(node.right, 'compare'));
    let signs = SIGNS[COMPARISONS[node.operator]];
    // sign() of NaN is 0, so NaN becomes NULL first and NULL the code 2
    return `(CASE COALESCE(sign(NULLIF(${a} - ${b}, ${ERR})), 2) WHEN 2 THEN ${ERR} ${signs.map((s) => `WHEN ${s} THEN ${then}`).join(' ')} ELSE ${otherwise} END)`;
  }

  // AND / OR: an error is the result, blanks are skipped, and with nothing
  // left the result is #VALUE!. Each argument becomes 0 or 1 (NULL for a
  // blank, NaN for an error); OR is the greatest of them, AND the least.
  #logical(name: 'AND' | 'OR', args: BxlAstNode[]): string {
    let codes = args.map(
      (a) =>
        `(CASE COALESCE(${this.number(a)}, ${BLANK}) WHEN ${BLANK} THEN NULL WHEN ${ERR} THEN ${ERR} WHEN 0 THEN 0 ELSE 1 END)::double precision`,
    );
    return name === 'OR'
      ? `COALESCE(GREATEST(${codes.join(', ')}), ${ERR})`
      : `COALESCE(-GREATEST(${codes.map((c) => `-${c}`).join(', ')}), ${ERR})`;
  }

  #call(name: string, args: BxlAstNode[]): string {
    if (!FUNCTIONS.has(name)) {
      throw new BxlScoreSqlError(
        `${name} is not part of the score profile. A formula can use ${BXL_SCORE_FUNCTIONS.join(', ')}.`,
      );
    }
    let n = (i: number) => this.number(args[i]);
    // an argument as a number: a blank is 0, an error stays one
    let v = (i: number) => num(n(i));
    switch (name) {
      case 'IF':
        this.#arity(name, args, 2, 3);
        return this.#if(args[0], n(1), args[2] ? n(2) : FALSE);
      case 'IFERROR': {
        this.#arity(name, args, 2, 2);
        // a field's text is a value, not an error: it passes through. A
        // blank stands as -Infinity (which no value is) so it is kept, an
        // error becomes NULL and takes the fallback.
        let x = this.number(args[0], 'passthrough');
        return `NULLIF(COALESCE(NULLIF(COALESCE(${x}, ${BLANK}), ${ERR}), ${n(1)}), ${BLANK})`;
      }
      case 'IFNA':
        // nothing in the score profile raises #N/A
        this.#arity(name, args, 2, 2);
        n(1);
        return n(0);
      case 'ISBLANK':
        this.#arity(name, args, 1, 1);
        return `(CASE WHEN ${n(0)} IS NULL THEN 1 ELSE 0 END)::double precision`;
      case 'AND':
      case 'OR':
        this.#arity(name, args, 1, Infinity);
        return this.#logical(name, args);
      case 'NOT':
        this.#arity(name, args, 1, 1);
        return `(CASE ${v(0)} WHEN ${ERR} THEN ${ERR} WHEN 0 THEN 1 ELSE 0 END)::double precision`;
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN': {
        this.#arity(name, args, 1, 2);
        let digits = args[1] ? this.#integer(args[1], name) : 0;
        let scale = `power(10::double precision, ${digits})`;
        let x = v(0);
        // ROUND rounds half away from zero; ROUNDUP / ROUNDDOWN round away
        // from / toward zero, as in Excel.
        if (name === 'ROUND') {
          return `(round(CAST(${x} AS numeric), ${digits})::double precision)`;
        }
        let fn = name === 'ROUNDUP' ? 'ceil' : 'floor';
        return `(sign(${x}) * ${fn}(abs(${x}) * ${scale}) / ${scale})`;
      }
      case 'ABS':
      case 'SIGN':
        this.#arity(name, args, 1, 1);
        return `${name.toLowerCase()}(${v(0)})`;
      case 'SQRT': {
        this.#arity(name, args, 1, 1);
        let x = v(0);
        return `(CASE WHEN ${x} >= 0 THEN sqrt(${x}) ELSE ${ERR} END)`;
      }
      case 'POWER': {
        this.#arity(name, args, 2, 2);
        let a = v(0);
        let b = v(1);
        return `(CASE WHEN ${isErr(a)} OR ${isErr(b)} THEN ${ERR} WHEN ${a} = 0 AND ${b} < 0 THEN ${ERR} WHEN ${a} = 0 AND ${b} = 0 THEN ${ERR} WHEN ${a} = 0 THEN 0::double precision WHEN ${a} < 0 AND ${b} <> trunc(${b}) THEN ${ERR} WHEN abs(${b} * ln(abs(${a}))) >= ${MAX_EXP} THEN ${ERR} ELSE power(${a}, ${b}) END)`;
      }
      case 'EXP':
        this.#arity(name, args, 1, 1);
        // past the bound (and for NaN, which LEAST ranks above it) the value
        // is the bound, which NULLIF makes NULL and COALESCE #NUM!
        return `COALESCE(exp(NULLIF(LEAST(${v(0)}, ${MAX_EXP}), ${MAX_EXP})), ${ERR})`;
      case 'LN':
      case 'LOG10': {
        this.#arity(name, args, 1, 1);
        // the argument is read once: a non-positive one becomes NULL
        // (GREATEST, then NULLIF), the log keeps it and COALESCE makes it
        // #NUM!; NaN passes through all three
        return `COALESCE(${name === 'LN' ? 'ln' : 'log'}(NULLIF(GREATEST(${v(0)}, 0), 0)), ${ERR})`;
      }
      case 'LOG': {
        this.#arity(name, args, 1, 2);
        let x = v(0);
        let base = args[1] ? v(1) : '10::double precision';
        return `(CASE WHEN ${isErr(x)} OR ${isErr(base)} THEN ${ERR} WHEN ${x} <= 0 OR ${base} <= 0 OR ${base} = 1 THEN ${ERR} ELSE ln(${x}) / ln(${base}) END)`;
      }
      case 'MIN':
      case 'MAX':
      case 'AVERAGE': {
        this.#arity(name, args, 1, Infinity);
        // Excel skips blanks, and a field read directly skips any non-number.
        // Such a field may be a list (the compiler does not know a field's
        // type): each of its numbers counts, as in a spreadsheet range. `list` is NULL
        // or empty for a field that is not one.
        let over = (fn: string, list: string) =>
          `(SELECT ${fn}(bxl_n) FROM unnest(${list}) AS bxl_n)`;
        let read = (fn: string) =>
          args.flatMap((a) => {
            let field = this.#fieldParts(a);
            let x = this.number(a, 'aggregate');
            return field ? [x, over(fn, this.#field(field, 'numbers'))] : [x];
          });
        if (name === 'AVERAGE') {
          // an error propagates through the sum
          let count = args
            .flatMap((a) => {
              let field = this.#fieldParts(a);
              let x = this.number(a, 'aggregate');
              let one = `(CASE WHEN ${x} IS NULL THEN 0 ELSE 1 END)`;
              return field
                ? [
                    one,
                    `COALESCE(cardinality(${this.#field(field, 'numbers')}), 0)`,
                  ]
                : [one];
            })
            .join(' + ');
          let sum = read('sum')
            .map((x) => `COALESCE(${x}, 0)`)
            .join(' + ');
          return `COALESCE((${sum}) / NULLIF(${count}, 0), ${ERR})`;
        }
        // GREATEST skips NULLs and is NaN when any argument is; MIN is the
        // greatest of the negatives, negated
        return name === 'MAX'
          ? `COALESCE(GREATEST(${read('max').join(', ')}), 0)`
          : `COALESCE(-GREATEST(${read('min')
              .map((x) => `-${x}`)
              .join(', ')}), 0)`;
      }
      case 'NA':
        // #N/A: an error, so the row has no score (IFNA does not tell it
        // from another error in SQL, where every error is NaN)
        this.#arity(name, args, 0, 0);
        return ERR;
      case 'COUNT':
      case 'SUM':
      case 'MEDIAN': {
        this.#arity(name, args, 1, Infinity);
        // Over every number the arguments give: a field read directly gives
        // its number, or each number of a list (a comparison set's `peers.`
        // list among them). COUNT counts numbers and skips the rest, errors
        // included; SUM and MEDIAN are the error when an argument is one.
        let list = this.#numbersOf(args);
        if (name === 'COUNT') {
          return `(SELECT count(*) FROM unnest(${list}) AS bxl_n WHERE bxl_n <> ${ERR})::double precision`;
        }
        let fn =
          name === 'SUM'
            ? 'sum(bxl_n)'
            : 'percentile_cont(0.5) WITHIN GROUP (ORDER BY bxl_n)';
        // MEDIAN of no numbers is #NUM!; SUM of none is 0
        let empty = name === 'SUM' ? '0::double precision' : ERR;
        return `COALESCE((SELECT CASE WHEN bool_or(bxl_n = ${ERR}) THEN ${ERR} ELSE ${fn} END FROM unnest(${list}) AS bxl_n), ${empty})`;
      }
      case 'STANDARDIZE': {
        this.#arity(name, args, 3, 3);
        let x = v(0);
        let mean = v(1);
        let sd = v(2);
        return `(CASE WHEN ${isErr(x)} OR ${isErr(mean)} OR ${isErr(sd)} OR ${sd} <= 0 THEN ${ERR} ELSE ${div(`(${x} - ${mean})`, sd)} END)`;
      }
      case 'PERCENTRANK_INC': {
        // PERCENTRANK_INC(list, x): where x falls among the list's numbers,
        // 0 to 1, interpolated between two of them; #N/A outside them or
        // over no numbers, 0 over one.
        this.#arity(name, args, 2, 2);
        let list = this.#numbersOf([args[0]]);
        let x = v(1);
        let below = `count(*) FILTER (WHERE bxl_n < ${x})`;
        let lo = `max(bxl_n) FILTER (WHERE bxl_n < ${x})`;
        let hi = `min(bxl_n) FILTER (WHERE bxl_n > ${x})`;
        return `(CASE WHEN ${isErr(x)} THEN ${ERR} ELSE COALESCE((SELECT CASE WHEN count(*) = 0 OR ${x} < min(bxl_n) OR ${x} > max(bxl_n) THEN ${ERR} WHEN count(*) = 1 THEN 0 WHEN bool_or(bxl_n = ${x}) THEN ${below} / (count(*) - 1)::double precision ELSE (${below} - 1 + (${x} - ${lo}) / (${hi} - ${lo})) / (count(*) - 1)::double precision END FROM unnest(${list}) AS bxl_n WHERE bxl_n <> ${ERR}), ${ERR}) END)`;
      }
      case 'COUNTIF': {
        // COUNTIF(list, criterion): a number (those equal to it), a
        // comparison and a number as text (">4", or ">" & rating), text
        // ("Chair", "<>Chair": equal, ignoring case, as Excel matches; no
        // wildcards), or a field, read as its value: a number counts the
        // numbers equal to it, text the text equal to it ignoring case (its
        // text is not read as an operator), a blank the zeros.
        this.#arity(name, args, 2, 2);
        let text = this.#textCriterion(args[0], args[1]);
        if (text) return text;
        let list = this.#numbersOf([args[0]]);
        let { op, value } = this.#criterion(args[1]);
        return `(CASE WHEN ${isErr(value)} THEN ${ERR} ELSE (SELECT count(*) FROM unnest(${list}) AS bxl_n WHERE bxl_n <> ${ERR} AND bxl_n ${op} ${value})::double precision END)`;
      }
      case 'PI':
        this.#arity(name, args, 0, 0);
        return `(${Math.PI}::double precision)`;
      case 'FLOOR':
      case 'CEILING': {
        this.#arity(name, args, 1, 2);
        let fn = name === 'FLOOR' ? 'floor' : 'ceil';
        let x = v(0);
        if (!args[1]) return `${fn}(${x})`;
        let step = v(1);
        return `(CASE WHEN ${step} = 0 THEN ${ERR} ELSE ${mul(`${fn}(${div(x, step)})`, step)} END)`;
      }
      case 'DAYS': {
        this.#arity(name, args, 2, 2);
        let end = this.#timestamp(args[0]);
        let start = this.#timestamp(args[1]);
        return `(EXTRACT(EPOCH FROM (${end} - ${start})) / 86400.0)::double precision`;
      }
      case 'NOW':
      case 'TODAY':
        throw new BxlScoreSqlError(
          `${name}() is a date: use it inside DAYS, such as DAYS(NOW(), publishedAt).`,
        );
    }
    throw new BxlScoreSqlError(`${name} is not part of the score profile.`);
  }

  #timestamp(node: BxlAstNode): string {
    this.#visit();
    if (node.type === 'call' && node.args.length === 0) {
      let name = node.name.toUpperCase();
      if (name === 'NOW') return 'now()';
      // midnight UTC, not midnight in the session's time zone
      if (name === 'TODAY') {
        return "(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')";
      }
    }
    let field = this.#fieldParts(node);
    if (field) {
      return this.#field(field, 'timestamp');
    }
    throw new BxlScoreSqlError(
      'DAYS takes dates: a date field, NOW() or TODAY().',
    );
  }

  #field(parts: string[], usage: BxlScoreSqlUsage): string {
    for (let part of parts) {
      if (!FIELD_KEY.test(part)) {
        throw new BxlScoreSqlError(`"${part}" is not a field name.`);
      }
    }
    this.fields.add(parts.join('.'));
    return this.options.fieldToSql(parts, usage);
  }

  // A field reference: `.a.b`, a bare name that is not a function (`rating`),
  // or a dotted chain of them (`brand.name`). A name written with
  // parentheses (`RAND()`) is a call, whether or not the profile has it.
  #fieldParts(node: BxlAstNode): string[] | undefined {
    if (node.type === 'path' && node.root === 'current') {
      if (node.parts.length === 0) return undefined;
      return node.parts.map((p) => {
        // `."end"` and `.["end"]`: a field whose name is a reserved word
        if (
          p.type === 'dynamic-index' &&
          p.expr.type === 'literal' &&
          p.expr.valueType === 'string'
        ) {
          return p.expr.value;
        }
        if (p.type !== 'field') {
          throw new BxlScoreSqlError(
            'A field in a score formula is a name; list positions and iterators are not part of the score profile.',
          );
        }
        return p.key;
      });
    }
    if (
      node.type === 'call' &&
      node.args.length === 0 &&
      !FUNCTIONS.has(node.name.toUpperCase()) &&
      !BXL_NULLARY_FUNCTIONS.has(node.name.toUpperCase()) &&
      !this.emptyCalls.has(node.name)
    ) {
      return [node.name];
    }
    if (node.type === 'index' && typeof node.index === 'string') {
      let head = this.#fieldParts(node.expr);
      return head ? [...head, node.index] : undefined;
    }
    return undefined;
  }

  // Every number a function's arguments give, as one `double precision[]`:
  // a field read directly gives its number or each number of its list (an
  // error stays NaN only for a computed argument; a field skips what is not
  // a number, as Excel skips it in a range), and any other argument its
  // value, a blank skipped.
  #numbersOf(args: BxlAstNode[]): string {
    let parts = args.map((a) => {
      let field = this.#fieldParts(a);
      if (field) {
        let one = this.number(a, 'aggregate');
        return `(ARRAY[${one}]::double precision[] || ${this.#field(field, 'numbers')})`;
      }
      return `ARRAY[${this.number(a)}]::double precision[]`;
    });
    return `array_remove(${parts.join(' || ')}, NULL)`;
  }

  // COUNTIF over a field's values (a list, or one value) with a criterion
  // that may be text: a text literal that is no comparison with a number,
  // or a field whose value is a number or text only when the row is read.
  // Undefined for a number criterion, which `#criterion` reads.
  #textCriterion(listNode: BxlAstNode, node: BxlAstNode): string | undefined {
    let listField = this.#fieldParts(listNode);
    let critField = this.#fieldParts(node);
    let text =
      node.type === 'literal' && node.valueType === 'string'
        ? node.value
        : undefined;
    let literal =
      text !== undefined ? /^\s*(<>|=)?(.*)$/s.exec(text)! : undefined;
    let numeric =
      text !== undefined &&
      /^\s*(<=|>=|<>|=|<|>)?\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(
        text,
      );
    if ((!literal || numeric) && !critField) return undefined;
    if (!listField) {
      throw new BxlScoreSqlError(
        'COUNTIF with a text criterion reads a field, such as COUNTIF(peers.kind, kind).',
      );
    }
    if (text !== undefined && /^\s*(<=|>=|<(?!>)|>)/.test(text)) {
      throw new BxlScoreSqlError(
        'COUNTIF in a score formula compares text only for equality ("Chair" or "<>Chair").',
      );
    }
    let list = this.#field(listField, 'json');
    let elements = `jsonb_array_elements(CASE jsonb_typeof(${list}) WHEN 'array' THEN ${list} WHEN 'number' THEN jsonb_build_array(${list}) WHEN 'string' THEN jsonb_build_array(${list}) ELSE '[]'::jsonb END) AS bxl_e`;
    let isText = `jsonb_typeof(bxl_e) = 'string'`;
    let isNumber = `jsonb_typeof(bxl_e) = 'number'`;
    let elementText = `lower(bxl_e #>> '{}')`;
    if (literal) {
      let value = literal[2];
      if (value.includes('\u0000')) {
        throw new BxlScoreSqlError('A COUNTIF criterion cannot hold a NUL.');
      }
      let quoted = `lower('${value.replace(/'/g, "''")}')`;
      let equal = `(${isText} AND ${elementText} = ${quoted})`;
      return `(SELECT count(*) FROM ${elements} WHERE ${literal[1] === '<>' ? `NOT ${equal}` : equal})::double precision`;
    }
    let crit = this.#field(critField!, 'json');
    return `(CASE jsonb_typeof(${crit}) WHEN 'number' THEN (SELECT count(*) FROM ${elements} WHERE ${isNumber} AND (bxl_e #>> '{}')::double precision = (${crit} #>> '{}')::double precision) WHEN 'string' THEN (SELECT count(*) FROM ${elements} WHERE ${isText} AND ${elementText} = lower(${crit} #>> '{}')) ELSE (SELECT count(*) FROM ${elements} WHERE ${isNumber} AND (bxl_e #>> '{}')::double precision = 0) END)::double precision`;
  }

  // A COUNTIF criterion: a number, `">4"`, or `">" & x` (which BXL reads as
  // `(">" | tostring) + (x | tostring)`).
  #criterion(node: BxlAstNode): { op: string; value: string } {
    let toString = (n: BxlAstNode): BxlAstNode | undefined =>
      n.type === 'binary' &&
      n.operator === '|' &&
      n.right.type === 'call' &&
      n.right.name === 'tostring' &&
      n.right.args.length === 0
        ? n.left
        : undefined;
    let opOf = (text: string) => {
      let m = /^\s*(<=|>=|<>|=|<|>)?\s*(.*)$/s.exec(text)!;
      return { op: m[1] ?? '=', rest: m[2] };
    };
    if (node.type === 'literal' && node.valueType === 'string') {
      let { op, rest } = opOf(node.value);
      let value = Number(rest);
      if (rest.trim() === '' || !Number.isFinite(value)) {
        throw new BxlScoreSqlError(
          'COUNTIF in a score formula takes a number criterion, such as ">4" or ">" & rating.',
        );
      }
      return { op, value: `(${value}::double precision)` };
    }
    if (node.type === 'binary' && node.operator === '+') {
      let left = toString(node.left);
      let right = toString(node.right);
      if (
        left?.type === 'literal' &&
        left.valueType === 'string' &&
        right &&
        opOf(left.value).rest.trim() === ''
      ) {
        return { op: opOf(left.value).op, value: num(this.number(right)) };
      }
      throw new BxlScoreSqlError(
        'COUNTIF in a score formula takes a number criterion, such as ">4" or ">" & rating.',
      );
    }
    return { op: '=', value: num(this.number(node)) };
  }

  // Excel's argument list arrives as one array of comma-joined values.
  #args(node: Extract<BxlAstNode, { type: 'call' }>): BxlAstNode[] {
    if (node.args.length === 1 && node.args[0].type === 'array') {
      let expr = node.args[0].expr;
      return expr ? flattenComma(expr) : [];
    }
    return node.args.flatMap((a) =>
      a.type === 'binary' && a.operator === ',' ? flattenComma(a) : [a],
    );
  }

  #arity(name: string, args: BxlAstNode[], min: number, max: number) {
    if (args.length < min || args.length > max) {
      throw new BxlScoreSqlError(
        max === Infinity
          ? `${name} takes at least ${min} argument${min === 1 ? '' : 's'}.`
          : min === max
            ? `${name} takes ${min} argument${min === 1 ? '' : 's'}.`
            : `${name} takes ${min} to ${max} arguments.`,
      );
    }
  }

  #integer(node: BxlAstNode, name: string): number {
    let value =
      node.type === 'literal' && node.valueType === 'number'
        ? node.value
        : node.type === 'unary' &&
            node.operator === '-' &&
            node.expr.type === 'literal' &&
            node.expr.valueType === 'number'
          ? -node.expr.value
          : NaN;
    if (!Number.isInteger(value) || Math.abs(value) > 15) {
      throw new BxlScoreSqlError(
        `${name}'s digits are a whole number from -15 to 15.`,
      );
    }
    return value;
  }
}

const COMPARISONS: Record<string, string> = {
  '==': '=',
  '=': '=',
  '!=': '<>',
  '<>': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

// An error, as SQL: NaN. A blank is NULL.
const ERR = `'NaN'::double precision`;
const FALSE = '(0::double precision)';
// A blank, where NULL cannot stand for one: no value is -Infinity.
const BLANK = `'-Infinity'::double precision`;
// For each comparison, the signs of (left - right) that make it true.
const SIGNS: Record<string, number[]> = {
  '=': [0],
  '<>': [1, -1],
  '<': [-1],
  '<=': [-1, 0],
  '>': [1],
  '>=': [1, 0],
};
// Beyond this, exp() and power() overflow a double.
const MAX_EXP = 709;
// A value as a number: a blank is 0. A literal is never blank.
const LITERAL = /^\(-?[\d.]+(e[-+]?\d+)?::double precision\)$/;
const num = (x: string) => (LITERAL.test(x) ? x : `COALESCE(${x}, 0)`);
// Whether a value is an error (NULL, not false, for a blank: CASE skips it).
const isErr = (x: string) => (LITERAL.test(x) ? 'FALSE' : `(${x} = ${ERR})`);

// NaN propagates through + - * and / without an error, so the operators
// need no checks of their own. Postgres does raise one where a double
// overflows or underflows; the engine then runs the formula over the top
// window in JavaScript, where such a value is #NUM!.
const mul = (a: string, b: string) => `(${a} * ${b})`;
const div = (a: string, b: string) => `(${a} / ${b})`;
const add = (op: '+' | '-', a: string, b: string) => `(${a} ${op} ${b})`;

// BXL's own tokens for a source, so text inside a string literal or a
// comment is never read as code. Empty when the source does not tokenize
// (the parser reports that).
function tokensOf(source: string): ReadableSyntaxToken[] {
  try {
    return tokenizeReadableSyntax(source);
  } catch {
    return [];
  }
}

// The names an expression calls: a name directly followed by `(`, with
// whether the parentheses are empty.
function calledNames(
  tokens: ReadableSyntaxToken[],
): { name: string; empty: boolean }[] {
  let calls: { name: string; empty: boolean }[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    let token = tokens[i];
    let next = tokens[i + 1];
    if (token.type !== 'ident' || next.type !== 'punc' || next.value !== '(') {
      continue;
    }
    let name = token.value;
    // `a.b(` names nothing BXL can call: the dotted name is reported whole
    for (
      let j = i;
      j >= 2 && tokens[j - 1].value === '.' && tokens[j - 2].type === 'ident';
      j -= 2
    ) {
      name = `${tokens[j - 2].value}.${name}`;
    }
    let close = tokens[i + 2];
    calls.push({
      name,
      empty: close?.type === 'punc' && close.value === ')',
    });
  }
  return calls;
}

// The names a formula writes with empty parentheses, such as `RAND()`: each
// is a call, never a field, though the syntax tree gives a bare name and an
// empty call the same shape.
export function emptyCallNames(source: string): ReadonlySet<string> {
  return new Set(
    calledNames(tokensOf(source))
      .filter((c) => c.empty)
      .map((c) => c.name),
  );
}

let jqBuiltins: Set<string> | undefined;

// The functions an expression calls that BXL does not have, upper-cased, for
// a caller that refuses them before running anything. `formulaFunctions` are
// the spreadsheet functions (upper case, matched without regard to case);
// BXL's own helpers (`when`, `between`), jq's builtins and keywords, and a
// function the expression defines itself are known too.
export function unknownBxlFunctions(
  source: string,
  formulaFunctions: ReadonlySet<string>,
): string[] {
  jqBuiltins ??= new Set(
    resolveBuiltinRegistry(['core']).publicNames.map(
      (name) => name.split('/')[0],
    ),
  );
  let tokens = tokensOf(source);
  let defined = new Set(
    tokens
      .filter((t, i) => t.type === 'ident' && tokens[i - 1]?.value === 'def')
      .map((t) => t.value),
  );
  let unknown = new Set<string>();
  for (let { name } of calledNames(tokens)) {
    if (
      formulaFunctions.has(name.toUpperCase()) ||
      // the score profile's own (NA(), say) are functions wherever it runs
      FUNCTIONS.has(name.toUpperCase()) ||
      BXL_COMMA_ARGUMENT_HELPERS.has(name) ||
      JQ_KEYWORDS.has(name) ||
      jqBuiltins.has(name) ||
      defined.has(name)
    ) {
      continue;
    }
    unknown.add(name.toUpperCase());
  }
  return [...unknown];
}

function flattenComma(node: BxlAstNode): BxlAstNode[] {
  if (node.type === 'binary' && node.operator === ',') {
    return [...flattenComma(node.left), ...flattenComma(node.right)];
  }
  return [node];
}

function describe(node: BxlAstNode): string {
  switch (node.type) {
    case 'call':
      return node.name;
    case 'binary':
      // the parser rewrites Excel's `a & b` as `(a|tostring) + (b|tostring)`
      // before the tree is read, so a pipe into `tostring` was written `&`
      if (
        node.operator === '|' &&
        node.right.type === 'call' &&
        node.right.name === 'tostring' &&
        node.right.args.length === 0
      ) {
        return 'The operator & (text joining)';
      }
      return `The operator ${node.operator}`;
    case 'unary':
      return `The operator ${node.operator}`;
    default:
      return `A ${node.type}`;
  }
}
