// The score profile: a spreadsheet formula over one record's fields, lowered
// to a SQL number so a database can rank every row by it (a search's
// `_expr` sort). The profile is what Postgres can compute per row:
//
// - numbers, field references (`rating`, `brand.name`, `.priceMin`)
// - `+ - * / %`, unary minus, `^` (POWER)
// - comparisons and `and` / `or`, inside conditions
// - IF, IFERROR, IFNA, ISBLANK, AND, OR, NOT, ROUND, ROUNDUP, ROUNDDOWN,
//   ABS, SIGN, SQRT, POWER, EXP, LN, LOG, LOG10, MIN, MAX, AVERAGE, FLOOR,
//   CEILING, DAYS, NOW, TODAY
//
// Anything else is refused with the reason. Excel's errors become NULL: a
// division by zero, the log of a non-positive number or a missing field
// yields NULL rather than a database error, and IFERROR / IFNA catch it as
// Excel does. A row whose score is NULL ranks last (or, in a blend, gets
// nothing from the signal).
//
// Numbers are inlined (they are checked finite), so the result needs no
// parameters; fields reach the SQL only through `fieldToSql`.
import { parseBxlAst, type BxlAstNode } from '../ast/index.ts';

export type BxlScoreSqlUsage = 'number' | 'timestamp';

export interface BxlScoreSqlOptions {
  // The SQL for a field, read as a number (NULL unless the value is one) or
  // as a timestamp (NULL unless it is a date).
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
  'MIN',
  'MAX',
  'AVERAGE',
  'FLOOR',
  'CEILING',
  'DAYS',
  'NOW',
  'TODAY',
] as const;
const FUNCTIONS = new Set<string>(BXL_SCORE_FUNCTIONS);
const FIELD_KEY = /^[A-Za-z_$][\w$]*$/;
const MAX_SOURCE_LENGTH = 2000;
const MAX_NODES = 200;

export function compileBxlScoreToSql(
  source: string,
  options: BxlScoreSqlOptions,
): BxlScoreSqlResult {
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
  let compiler = new ScoreCompiler(options);
  let sql = compiler.number(program.body);
  return { sql, fields: [...compiler.fields], source };
}

class ScoreCompiler {
  fields = new Set<string>();
  #nodes = 0;
  private options: BxlScoreSqlOptions;
  constructor(options: BxlScoreSqlOptions) {
    this.options = options;
  }

  #visit() {
    if (++this.#nodes > MAX_NODES) {
      throw new BxlScoreSqlError(
        `A score formula has at most ${MAX_NODES} parts.`,
      );
    }
  }

  // A numeric SQL expression (double precision, NULL for Excel errors).
  number(node: BxlAstNode): string {
    this.#visit();
    let field = this.#fieldParts(node);
    if (field) {
      return this.#field(field, 'number');
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
          return `(-${this.number(node.expr)})`;
        }
        if (node.operator === '+') {
          return this.number(node.expr);
        }
        break;
      case 'binary':
        if (['+', '-', '*'].includes(node.operator)) {
          return `(${this.number(node.left)} ${node.operator} ${this.number(node.right)})`;
        }
        if (node.operator === '/') {
          return `(${this.number(node.left)} / NULLIF(${this.number(node.right)}, 0))`;
        }
        if (node.operator === '%') {
          return `(CAST(${this.number(node.left)} AS numeric) % NULLIF(CAST(${this.number(node.right)} AS numeric), 0))::double precision`;
        }
        if (isCondition(node)) {
          return `(CASE WHEN ${this.condition(node)} THEN 1 ELSE 0 END)::double precision`;
        }
        break;
      case 'if': {
        let branches = [{ cond: node.cond, then: node.then }, ...node.elifs];
        return `(CASE ${branches
          .map(
            (b) => `WHEN ${this.condition(b.cond)} THEN ${this.number(b.then)}`,
          )
          .join(' ')} ELSE ${node.else ? this.number(node.else) : 'NULL'} END)`;
      }
      case 'call':
        return this.#call(node.name.toUpperCase(), this.#args(node));
    }
    throw new BxlScoreSqlError(
      `${describe(node)} is not part of the score profile: a formula uses numbers, fields, arithmetic, comparisons and ${BXL_SCORE_FUNCTIONS.join(', ')}.`,
    );
  }

  // A SQL boolean for IF, AND, OR, NOT and comparisons. A number counts as
  // true when it is non-zero, as in Excel.
  condition(node: BxlAstNode): string {
    this.#visit();
    if (node.type === 'binary') {
      if (node.operator === 'and' || node.operator === 'or') {
        return `(${this.condition(node.left)} ${node.operator.toUpperCase()} ${this.condition(node.right)})`;
      }
      let op = COMPARISONS[node.operator];
      if (op) {
        return `(${this.number(node.left)} ${op} ${this.number(node.right)})`;
      }
    }
    if (node.type === 'call') {
      let name = node.name.toUpperCase();
      let args = this.#args(node);
      if (name === 'AND' || name === 'OR') {
        this.#arity(name, args, 1, Infinity);
        return `(${args.map((a) => this.condition(a)).join(` ${name} `)})`;
      }
      if (name === 'NOT') {
        this.#arity(name, args, 1, 1);
        return `(NOT ${this.condition(args[0])})`;
      }
      if (name === 'ISBLANK') {
        this.#arity(name, args, 1, 1);
        return `(${this.number(args[0])} IS NULL)`;
      }
    }
    if (node.type === 'literal' && node.valueType === 'boolean') {
      return node.value ? 'TRUE' : 'FALSE';
    }
    return `(COALESCE(${this.number(node)}, 0) <> 0)`;
  }

  #call(name: string, args: BxlAstNode[]): string {
    if (!FUNCTIONS.has(name)) {
      throw new BxlScoreSqlError(
        `${name} is not part of the score profile. A formula can use ${BXL_SCORE_FUNCTIONS.join(', ')}.`,
      );
    }
    let n = (i: number) => this.number(args[i]);
    switch (name) {
      case 'IF':
        this.#arity(name, args, 2, 3);
        return `(CASE WHEN ${this.condition(args[0])} THEN ${n(1)} ELSE ${args[2] ? n(2) : '0::double precision'} END)`;
      case 'IFERROR':
      case 'IFNA':
        this.#arity(name, args, 2, 2);
        return `COALESCE(${n(0)}, ${n(1)})`;
      case 'ISBLANK':
      case 'AND':
      case 'OR':
      case 'NOT':
        return `(CASE WHEN ${this.condition({ type: 'call', name, arity: args.length, args })} THEN 1 ELSE 0 END)::double precision`;
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN': {
        this.#arity(name, args, 1, 2);
        let digits = args[1] ? this.#integer(args[1], name) : 0;
        let scale = `power(10::double precision, ${digits})`;
        let fn =
          name === 'ROUND' ? 'round' : name === 'ROUNDUP' ? 'ceil' : 'floor';
        // ROUNDUP / ROUNDDOWN round away from / toward zero, as in Excel.
        let x = n(0);
        return name === 'ROUND'
          ? `(round(CAST(${x} AS numeric), ${digits})::double precision)`
          : `(sign(${x}) * ${fn}(abs(${x}) * ${scale}) / ${scale})`;
      }
      case 'ABS':
      case 'SIGN':
        this.#arity(name, args, 1, 1);
        return `${name.toLowerCase()}(${n(0)})`;
      case 'SQRT':
        this.#arity(name, args, 1, 1);
        return `(CASE WHEN ${n(0)} >= 0 THEN sqrt(${n(0)}) END)`;
      case 'POWER':
        this.#arity(name, args, 2, 2);
        return `(CASE WHEN ${n(0)} > 0 OR (${n(0)} = 0 AND ${n(1)} >= 0) OR (${n(0)} < 0 AND ${n(1)} = trunc(${n(1)})) THEN (CASE WHEN abs(${n(1)} * ln(GREATEST(abs(${n(0)}), 1e-300))) < 700 THEN power(${n(0)}, ${n(1)}) END) END)`;
      case 'EXP':
        this.#arity(name, args, 1, 1);
        return `(CASE WHEN ${n(0)} < 700 THEN exp(${n(0)}) END)`;
      case 'LN':
        this.#arity(name, args, 1, 1);
        return `(CASE WHEN ${n(0)} > 0 THEN ln(${n(0)}) END)`;
      case 'LOG10':
        this.#arity(name, args, 1, 1);
        return `(CASE WHEN ${n(0)} > 0 THEN log(${n(0)}) END)`;
      case 'LOG': {
        this.#arity(name, args, 1, 2);
        let base = args[1] ? n(1) : '10::double precision';
        return `(CASE WHEN ${n(0)} > 0 AND ${base} > 0 AND ${base} <> 1 THEN ln(${n(0)}) / ln(${base}) END)`;
      }
      case 'MIN':
      case 'MAX': {
        this.#arity(name, args, 1, Infinity);
        // Excel skips blanks: LEAST / GREATEST ignore NULLs.
        return `${name === 'MIN' ? 'LEAST' : 'GREATEST'}(${args.map((a) => this.number(a)).join(', ')})`;
      }
      case 'AVERAGE': {
        this.#arity(name, args, 1, Infinity);
        let xs = args.map((a) => this.number(a));
        let count = xs
          .map((x) => `(CASE WHEN ${x} IS NULL THEN 0 ELSE 1 END)`)
          .join(' + ');
        let sum = xs.map((x) => `COALESCE(${x}, 0)`).join(' + ');
        return `((${sum}) / NULLIF(${count}, 0))`;
      }
      case 'FLOOR':
      case 'CEILING': {
        this.#arity(name, args, 1, 2);
        let fn = name === 'FLOOR' ? 'floor' : 'ceil';
        if (!args[1]) return `${fn}(${n(0)})`;
        return `(${fn}(${n(0)} / NULLIF(${n(1)}, 0)) * ${n(1)})`;
      }
      case 'DAYS': {
        this.#arity(name, args, 2, 2);
        let end = this.#timestamp(args[0]);
        let start = this.#timestamp(args[1]);
        return `(EXTRACT(EPOCH FROM (${end} - ${start})) / 86400.0)`;
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
      if (name === 'TODAY') return "date_trunc('day', now())";
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
  // or a dotted chain of them (`brand.name`).
  #fieldParts(node: BxlAstNode): string[] | undefined {
    if (node.type === 'path' && node.root === 'current') {
      if (node.parts.length === 0) return undefined;
      return node.parts.map((p) => {
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
      !FUNCTIONS.has(node.name.toUpperCase())
    ) {
      return [node.name];
    }
    if (node.type === 'index' && typeof node.index === 'string') {
      let head = this.#fieldParts(node.expr);
      return head ? [...head, node.index] : undefined;
    }
    return undefined;
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

function isCondition(node: BxlAstNode): boolean {
  return (
    node.type === 'binary' &&
    (node.operator === 'and' ||
      node.operator === 'or' ||
      node.operator in COMPARISONS)
  );
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
    case 'unary':
      return `The operator ${node.operator}`;
    default:
      return `A ${node.type}`;
  }
}
