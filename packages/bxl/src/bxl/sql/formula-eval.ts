// A spreadsheet formula over one record, computed in JavaScript with Excel's
// rules for blanks and errors: the same rules the score profile (score.ts)
// follows in SQL, so a formula ranks the same wherever it runs.
//
// - A blank (a missing field, or null) is 0 in arithmetic and in a
//   comparison; IF on a blank takes the else branch; NOT of a blank is true.
// - MIN, MAX, SUM, AVERAGE and COUNT skip blanks, and a field they read
//   directly contributes only its numbers.
// - An error (#DIV/0!, #NUM!, #VALUE!, #N/A …) propagates through
//   arithmetic, comparisons, IF's condition and every function's arguments,
//   until IFERROR (any error) or IFNA (#N/A only) catches it. A blank is not
//   an error: IFERROR passes it through.
//
// The formula's value is a number, or null when it is blank, an error or not
// a number; true and false are 1 and 0.
//
// The interpreter knows the operators and the functions whose rules are
// about blanks and errors. Any other function is the caller's: `callFunction`
// prepares it once per name and argument count and is handed plain values,
// after an error among them has already become the result. A formula built
// from anything but a spreadsheet's parts (a jq pipe, a list position) is
// refused with `SpreadsheetFormulaUnsupported`, so the caller can run it some
// other way.
import type { BxlAstNode } from '../ast/index.ts';
import { BxlScoreSqlError, parseScoreFormula } from './score.ts';

export class SpreadsheetError {
  readonly code: string;
  constructor(code: string) {
    this.code = code;
  }
}
export class SpreadsheetFormulaUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetFormulaUnsupported';
  }
}

export type SpreadsheetValue =
  | number
  | string
  | boolean
  | null
  | SpreadsheetError
  | unknown[]
  | Record<string, unknown>;

export type SpreadsheetFunction = (args: unknown[]) => unknown;

export interface SpreadsheetFormulaOptions {
  // A function the interpreter does not know: a callable for its argument
  // count, or undefined when there is no such function.
  callFunction?: (
    name: string,
    arity: number,
  ) => SpreadsheetFunction | undefined;
}

export interface SpreadsheetEvaluateOptions {
  now?: Date;
}

export interface PreparedSpreadsheetFormula {
  evaluate(
    record: Record<string, unknown>,
    options?: SpreadsheetEvaluateOptions,
  ): number | null;
}

const DIV0 = new SpreadsheetError('#DIV/0!');
const NUM = new SpreadsheetError('#NUM!');
const VALUE = new SpreadsheetError('#VALUE!');
const NA = new SpreadsheetError('#N/A');
const ERROR_CODE = /#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)/;
// The score profile's bound on exp() and power(), so both sides agree.
const MAX_EXP = 709;
const NUMERIC_TEXT = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const DAY_MS = 86_400_000;
// Excel's day 0 is 1899-12-30.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const isErr = (v: unknown): v is SpreadsheetError =>
  v instanceof SpreadsheetError;

// Functions whose rules are about blanks and errors, or that the score
// profile computes in SQL: the interpreter's own, so both sides agree.
const CORE = new Set([
  'IF',
  'IFS',
  'IFERROR',
  'IFNA',
  'ISBLANK',
  'ISERROR',
  'ISERR',
  'ISNA',
  'ISNUMBER',
  'ISTEXT',
  'ISLOGICAL',
  'AND',
  'OR',
  'NOT',
  'MIN',
  'MAX',
  'SUM',
  'AVERAGE',
  'COUNT',
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
  'FLOOR',
  'CEILING',
  'DAYS',
  'NOW',
  'TODAY',
]);
// Names that are functions even with no arguments; any other bare name is a
// field.
const NULLARY = new Set(['NOW', 'TODAY', 'PI', 'RAND', 'NA', 'TRUE', 'FALSE']);

type Compiled = (ctx: Ctx) => SpreadsheetValue;
interface Ctx {
  record: Record<string, unknown>;
  now: Date;
}

export function prepareSpreadsheetFormula(
  source: string,
  options: SpreadsheetFormulaOptions = {},
): PreparedSpreadsheetFormula {
  let body: BxlAstNode;
  try {
    body = parseScoreFormula(source);
  } catch (e) {
    if (e instanceof BxlScoreSqlError) {
      throw new SpreadsheetFormulaUnsupported(e.message);
    }
    throw e;
  }
  let compiled = new Compiler(options).value(body);
  return {
    evaluate(record, opts = {}) {
      return result(compiled({ record, now: opts.now ?? new Date() }));
    },
  };
}

// The formula's value as a rank: a number, or null.
function result(v: SpreadsheetValue): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && NUMERIC_TEXT.test(v)) return Number(v);
  return null;
}

// A value as a number: a blank is 0, true and false 1 and 0, text that spells
// a number that number; anything else is #VALUE!.
function toNumber(v: SpreadsheetValue): number | SpreadsheetError {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) return v;
  if (typeof v === 'string' && NUMERIC_TEXT.test(v)) return Number(v);
  return VALUE;
}

// A value as a condition: a blank is false, a number is true when non-zero.
function toCondition(v: SpreadsheetValue): boolean | SpreadsheetError {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (isErr(v)) return v;
  if (typeof v === 'string') {
    let upper = v.trim().toUpperCase();
    if (upper === 'TRUE') return true;
    if (upper === 'FALSE') return false;
  }
  return VALUE;
}

function toText(v: SpreadsheetValue): string | SpreadsheetError {
  if (v === null || v === undefined) return '';
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return VALUE;
}

// A finite number, or #NUM!.
const finite = (n: number): number | SpreadsheetError =>
  Number.isFinite(n) ? n : NUM;

// Excel's comparison: a blank takes the other side's empty value (0, "" or
// false); text compares without case; booleans compare as 1 and 0 against a
// number, as the score profile reads them.
function compare(
  a: SpreadsheetValue,
  b: SpreadsheetValue,
): number | SpreadsheetError {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  let norm = (x: SpreadsheetValue, other: SpreadsheetValue) => {
    if (x === null || x === undefined) {
      return typeof other === 'string' ? '' : 0;
    }
    if (typeof x === 'boolean') return x ? 1 : 0;
    return x;
  };
  let x = norm(a, b);
  let y = norm(b, a);
  if (typeof x === 'number' && typeof y === 'number') {
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (typeof x === 'string' && typeof y === 'string') {
    let p = x.toLowerCase();
    let q = y.toLowerCase();
    return p === q ? 0 : p < q ? -1 : 1;
  }
  if (typeof x === 'number' && typeof y === 'string') return -1;
  if (typeof x === 'string' && typeof y === 'number') return 1;
  return VALUE as SpreadsheetError;
}

// Rounding half away from zero on the 15 significant digits a double holds,
// as Excel (and Postgres' numeric round) do.
function roundHalfAway(x: number, digits: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e15) return x;
  let abs = Number(Math.abs(x).toPrecision(15));
  let scaled = Math.round(Number(`${abs}e${digits}`));
  return Math.sign(x) * Number(`${scaled}e${-digits}`);
}

const COMPARISON: Record<string, (c: number) => boolean> = {
  '==': (c) => c === 0,
  '=': (c) => c === 0,
  '!=': (c) => c !== 0,
  '<>': (c) => c !== 0,
  '<': (c) => c < 0,
  '<=': (c) => c <= 0,
  '>': (c) => c > 0,
  '>=': (c) => c >= 0,
};

class Compiler {
  private options: SpreadsheetFormulaOptions;
  constructor(options: SpreadsheetFormulaOptions) {
    this.options = options;
  }

  value(node: BxlAstNode): Compiled {
    let field = fieldParts(node);
    if (field) {
      let parts = field;
      return (ctx) => readField(ctx.record, parts);
    }
    switch (node.type) {
      case 'literal':
        if (
          node.valueType === 'number' ||
          node.valueType === 'boolean' ||
          node.valueType === 'string' ||
          node.valueType === 'null'
        ) {
          let v = node.value as SpreadsheetValue;
          return () => v;
        }
        break;
      case 'unary': {
        let x = this.value(node.expr);
        if (node.operator === '-') {
          return (ctx) => {
            let n = toNumber(x(ctx));
            return isErr(n) ? n : -n;
          };
        }
        if (node.operator === '+') return x;
        break;
      }
      case 'binary':
        return this.#binary(node);
      case 'if': {
        let branches = [
          { cond: node.cond, then: node.then },
          ...node.elifs,
        ].map((b) => ({ cond: this.value(b.cond), then: this.value(b.then) }));
        let otherwise = node.else ? this.value(node.else) : () => false;
        return (ctx) => {
          for (let b of branches) {
            let c = toCondition(b.cond(ctx));
            if (isErr(c)) return c;
            if (c) return b.then(ctx);
          }
          return otherwise(ctx);
        };
      }
      case 'call':
        return this.#call(node.name.toUpperCase(), callArgs(node));
    }
    throw new SpreadsheetFormulaUnsupported(
      `${node.type} is not part of a spreadsheet formula`,
    );
  }

  #binary(node: Extract<BxlAstNode, { type: 'binary' }>): Compiled {
    let op = node.operator;
    // `a & b` arrives as `(a | tostring) + (b | tostring)`
    if (op === '+' && (isToString(node.left) || isToString(node.right))) {
      let a = this.#text(node.left);
      let b = this.#text(node.right);
      return (ctx) => {
        let x = a(ctx);
        if (isErr(x)) return x;
        let y = b(ctx);
        return isErr(y) ? y : `${x}${y}`;
      };
    }
    if (isToString(node)) {
      let t = this.#text(node);
      return (ctx) => t(ctx);
    }
    // NOT(x) arrives as `x | not`
    if (isPipeTo(node, 'not')) {
      let x = this.value(
        (node as Extract<BxlAstNode, { type: 'binary' }>).left,
      );
      return (ctx) => {
        let c = toCondition(x(ctx));
        return isErr(c) ? c : !c;
      };
    }
    if (op === 'and' || op === 'or') {
      return this.#logical(op === 'and' ? 'AND' : 'OR', [
        this.value(node.left),
        this.value(node.right),
      ]);
    }
    let a = this.value(node.left);
    let b = this.value(node.right);
    let cmp = COMPARISON[op];
    if (cmp) {
      return (ctx) => {
        let c = compare(a(ctx), b(ctx));
        return isErr(c) ? c : cmp(c);
      };
    }
    let arith = ARITHMETIC[op];
    if (arith) {
      return (ctx) => {
        let x = toNumber(a(ctx));
        if (isErr(x)) return x;
        let y = toNumber(b(ctx));
        if (isErr(y)) return y;
        return arith(x, y);
      };
    }
    throw new SpreadsheetFormulaUnsupported(
      `the operator ${op} is not part of a spreadsheet formula`,
    );
  }

  #text(node: BxlAstNode): (ctx: Ctx) => string | SpreadsheetError {
    let inner = isToString(node)
      ? this.value((node as Extract<BxlAstNode, { type: 'binary' }>).left)
      : this.value(node);
    return (ctx) => toText(inner(ctx));
  }

  #logical(name: 'AND' | 'OR', args: Compiled[]): Compiled {
    return (ctx) => {
      let seen = false;
      let out = name === 'AND';
      for (let arg of args) {
        let v = arg(ctx);
        if (isErr(v)) return v;
        // blanks are skipped
        if (v === null || v === undefined) continue;
        let c = toCondition(v);
        if (isErr(c)) return c;
        seen = true;
        out = name === 'AND' ? out && c : out || c;
      }
      return seen ? out : VALUE;
    };
  }

  // The values an aggregate reads: a field read directly gives its numbers
  // (a list field, each of them); anything else gives its value as a number,
  // a blank skipped.
  #aggregate(nodes: BxlAstNode[]): (ctx: Ctx) => number[] | SpreadsheetError {
    let parts = nodes.map((n) => {
      let field = fieldParts(n);
      return field
        ? { field, value: undefined }
        : { field: undefined, value: this.value(n) };
    });
    return (ctx) => {
      let out: number[] = [];
      for (let p of parts) {
        if (p.field) {
          let v = readField(ctx.record, p.field);
          for (let x of Array.isArray(v) ? v : [v]) {
            if (isErr(x)) return x;
            if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
          }
          continue;
        }
        let v = p.value!(ctx);
        if (v === null || v === undefined) continue;
        let n = toNumber(v);
        if (isErr(n)) return n;
        out.push(n);
      }
      return out;
    };
  }

  #call(name: string, argNodes: BxlAstNode[]): Compiled {
    if (!CORE.has(name)) return this.#delegate(name, argNodes);
    if (
      name === 'MIN' ||
      name === 'MAX' ||
      name === 'SUM' ||
      name === 'AVERAGE'
    ) {
      arity(name, argNodes, 1, Infinity);
      let values = this.#aggregate(argNodes);
      return (ctx) => {
        let xs = values(ctx);
        if (isErr(xs)) return xs;
        if (name === 'AVERAGE') {
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : DIV0;
        }
        if (name === 'SUM') return finite(xs.reduce((a, b) => a + b, 0));
        if (!xs.length) return 0;
        return name === 'MIN' ? Math.min(...xs) : Math.max(...xs);
      };
    }
    if (name === 'COUNT') {
      arity(name, argNodes, 1, Infinity);
      // COUNT counts numbers and passes over everything else, errors too
      let args = argNodes.map((n) => {
        let field = fieldParts(n);
        return field ? { field } : { value: this.value(n) };
      });
      return (ctx) => {
        let count = 0;
        for (let a of args) {
          let v = a.field ? readField(ctx.record, a.field) : a.value!(ctx);
          for (let x of Array.isArray(v) ? v : [v]) {
            if (typeof x === 'number' && Number.isFinite(x)) count++;
            else if (!a.field && typeof x === 'boolean') count++;
          }
        }
        return count;
      };
    }
    let args = argNodes.map((n) => this.value(n));
    let n = (ctx: Ctx, i: number) => toNumber(args[i](ctx));
    switch (name) {
      case 'IF':
        arity(name, args, 2, 3);
        return (ctx) => {
          let c = toCondition(args[0](ctx));
          if (isErr(c)) return c;
          return c ? args[1](ctx) : args[2] ? args[2](ctx) : false;
        };
      case 'IFS':
        if (args.length < 2 || args.length % 2) {
          throw new SpreadsheetFormulaUnsupported(
            'IFS takes pairs of a condition and a value',
          );
        }
        return (ctx) => {
          for (let i = 0; i < args.length; i += 2) {
            let c = toCondition(args[i](ctx));
            if (isErr(c)) return c;
            if (c) return args[i + 1](ctx);
          }
          return NA;
        };
      case 'IFERROR':
        arity(name, args, 2, 2);
        return (ctx) => {
          let v = args[0](ctx);
          return isErr(v) ? args[1](ctx) : v;
        };
      case 'IFNA':
        arity(name, args, 2, 2);
        return (ctx) => {
          let v = args[0](ctx);
          return isErr(v) && v.code === '#N/A' ? args[1](ctx) : v;
        };
      case 'ISBLANK':
      case 'ISERROR':
      case 'ISERR':
      case 'ISNA':
      case 'ISNUMBER':
      case 'ISTEXT':
      case 'ISLOGICAL': {
        arity(name, args, 1, 1);
        let test = IS[name];
        return (ctx) => test(args[0](ctx));
      }
      case 'AND':
      case 'OR':
        arity(name, args, 1, Infinity);
        return this.#logical(name, args);
      case 'NOT':
        arity(name, args, 1, 1);
        return (ctx) => {
          let c = toCondition(args[0](ctx));
          return isErr(c) ? c : !c;
        };
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN':
        arity(name, args, 1, 2);
        return (ctx) => {
          let x = n(ctx, 0);
          if (isErr(x)) return x;
          let d = args[1] ? n(ctx, 1) : 0;
          if (isErr(d)) return d;
          d = Math.trunc(d);
          if (name === 'ROUND') return roundHalfAway(x, d);
          let scale = 10 ** d;
          let fn = name === 'ROUNDUP' ? Math.ceil : Math.floor;
          return (Math.sign(x) * fn(Math.abs(x) * scale)) / scale;
        };
      case 'ABS':
      case 'SIGN':
      case 'SQRT':
      case 'EXP':
      case 'LN':
      case 'LOG10': {
        arity(name, args, 1, 1);
        let fn = UNARY_MATH[name];
        return (ctx) => {
          let x = n(ctx, 0);
          return isErr(x) ? x : fn(x);
        };
      }
      case 'POWER':
        arity(name, args, 2, 2);
        return (ctx) => {
          let a = n(ctx, 0);
          if (isErr(a)) return a;
          let b = n(ctx, 1);
          return isErr(b) ? b : power(a, b);
        };
      case 'LOG':
        arity(name, args, 1, 2);
        return (ctx) => {
          let x = n(ctx, 0);
          if (isErr(x)) return x;
          let base = args[1] ? n(ctx, 1) : 10;
          if (isErr(base)) return base;
          if (x <= 0 || base <= 0 || base === 1) return NUM;
          return Math.log(x) / Math.log(base);
        };
      case 'FLOOR':
      case 'CEILING':
        arity(name, args, 1, 2);
        return (ctx) => {
          let x = n(ctx, 0);
          if (isErr(x)) return x;
          let fn = name === 'FLOOR' ? Math.floor : Math.ceil;
          if (!args[1]) return fn(x);
          let step = n(ctx, 1);
          if (isErr(step)) return step;
          return step === 0 ? DIV0 : fn(x / step) * step;
        };
      case 'DAYS': {
        arity(name, args, 2, 2);
        let end = this.#date(argNodes[0]);
        let start = this.#date(argNodes[1]);
        return (ctx) => {
          let e = end(ctx);
          let s = start(ctx);
          return e === null || s === null ? null : (e - s) / DAY_MS;
        };
      }
      case 'NOW':
        arity(name, args, 0, 0);
        return (ctx) => (ctx.now.getTime() - EXCEL_EPOCH) / DAY_MS;
      case 'TODAY':
        arity(name, args, 0, 0);
        return (ctx) => Math.floor((ctx.now.getTime() - EXCEL_EPOCH) / DAY_MS);
    }
    throw new SpreadsheetFormulaUnsupported(`${name} is not supported`);
  }

  // A date inside DAYS, as milliseconds: NOW(), TODAY() or a field holding
  // an ISO date; null for anything else, as the score profile reads it.
  #date(node: BxlAstNode): (ctx: Ctx) => number | null {
    if (node.type === 'call' && node.args.length === 0) {
      let name = node.name.toUpperCase();
      if (name === 'NOW') return (ctx) => ctx.now.getTime();
      if (name === 'TODAY') {
        return (ctx) => {
          let d = ctx.now;
          return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        };
      }
    }
    let field = fieldParts(node);
    if (field) {
      let parts = field;
      return (ctx) => {
        let v = readField(ctx.record, parts);
        if (typeof v !== 'string' || !ISO_DATE.test(v)) return null;
        let t = Date.parse(v);
        return Number.isNaN(t) ? null : t;
      };
    }
    throw new SpreadsheetFormulaUnsupported(
      'DAYS takes dates: a date field, NOW() or TODAY()',
    );
  }

  // Any other function, through `callFunction`: its arguments are evaluated
  // first, and an error among them is the result, as in Excel.
  #delegate(name: string, argNodes: BxlAstNode[]): Compiled {
    let fn = this.options.callFunction?.(name, argNodes.length);
    if (!fn) {
      throw new SpreadsheetFormulaUnsupported(`${name} is not a function`);
    }
    let call = fn;
    let args = argNodes.map((n) => this.value(n));
    return (ctx) => {
      let values: unknown[] = [];
      for (let a of args) {
        let v = a(ctx);
        if (isErr(v)) return v;
        values.push(v ?? null);
      }
      try {
        let out = call(values);
        if (
          typeof out === 'string' &&
          ERROR_CODE.test(out) &&
          out.startsWith('#')
        ) {
          return new SpreadsheetError(out);
        }
        if (typeof out === 'number' && !Number.isFinite(out)) return NUM;
        return (out ?? null) as SpreadsheetValue;
      } catch (e) {
        let code = ERROR_CODE.exec(String((e as Error)?.message ?? e));
        return code ? new SpreadsheetError(code[0]) : VALUE;
      }
    };
  }
}

const ARITHMETIC: Record<
  string,
  (a: number, b: number) => number | SpreadsheetError
> = {
  '+': (a, b) => finite(a + b),
  '-': (a, b) => finite(a - b),
  '*': (a, b) => finite(a * b),
  '/': (a, b) => (b === 0 ? DIV0 : finite(a / b)),
  '%': (a, b) => (b === 0 ? DIV0 : decimalMod(a, b)),
};

// `%` on the 15 significant digits a double holds, in exact decimal, as
// Postgres' numeric computes it in the score profile: 0.3 % 0.1 is 0.
function decimalMod(a: number, b: number): number | SpreadsheetError {
  let parse = (x: number) => {
    let [mantissa, exp = '0'] = Math.abs(x).toPrecision(15).split('e');
    let [whole, frac = ''] = mantissa.split('.');
    return {
      digits: BigInt(whole + frac),
      scale: frac.length - Number(exp),
      negative: x < 0,
    };
  };
  let x = parse(a);
  let y = parse(b);
  let scale = Math.max(x.scale, y.scale);
  let up = (p: { digits: bigint; scale: number }) =>
    p.digits * 10n ** BigInt(scale - p.scale);
  let rest = up(x) % up(y);
  let text = rest.toString().padStart(scale + 1, '0');
  let n =
    scale > 0
      ? Number(`${text.slice(0, -scale)}.${text.slice(-scale)}`)
      : Number(`${text}e${-scale}`);
  // the remainder takes the dividend's sign, as Postgres' does
  return x.negative ? -n : n;
}

const UNARY_MATH: Record<string, (x: number) => number | SpreadsheetError> = {
  ABS: Math.abs,
  SIGN: Math.sign,
  SQRT: (x) => (x < 0 ? NUM : Math.sqrt(x)),
  EXP: (x) => (x < MAX_EXP ? Math.exp(x) : NUM),
  LN: (x) => (x > 0 ? Math.log(x) : NUM),
  LOG10: (x) => (x > 0 ? Math.log10(x) : NUM),
};

function power(a: number, b: number): number | SpreadsheetError {
  if (a === 0) return b < 0 || b === 0 ? NUM : 0;
  if (a < 0 && b !== Math.trunc(b)) return NUM;
  if (Math.abs(b * Math.log(Math.abs(a))) >= MAX_EXP) return NUM;
  return a ** b;
}

const IS: Record<string, (v: SpreadsheetValue) => boolean> = {
  ISBLANK: (v) => v === null || v === undefined,
  ISERROR: (v) => isErr(v),
  ISERR: (v) => isErr(v) && v.code !== '#N/A',
  ISNA: (v) => isErr(v) && v.code === '#N/A',
  ISNUMBER: (v) => typeof v === 'number',
  ISTEXT: (v) => typeof v === 'string',
  ISLOGICAL: (v) => typeof v === 'boolean',
};

function readField(
  record: Record<string, unknown>,
  parts: string[],
): SpreadsheetValue {
  let v: unknown = record;
  for (let p of parts) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
    v = (v as Record<string, unknown>)[p];
  }
  return v === undefined ? null : (v as SpreadsheetValue);
}

// A field reference: `.a.b`, a bare name that is not a function (`rating`),
// or a dotted chain of them (`brand.name`).
function fieldParts(node: BxlAstNode): string[] | undefined {
  if (node.type === 'path' && node.root === 'current') {
    if (node.parts.length === 0) return undefined;
    return node.parts.map((p) => {
      if (p.type !== 'field') {
        throw new SpreadsheetFormulaUnsupported(
          'a list position is not part of a spreadsheet formula',
        );
      }
      return p.key;
    });
  }
  if (
    node.type === 'call' &&
    node.args.length === 0 &&
    !NULLARY.has(node.name.toUpperCase())
  ) {
    return [node.name];
  }
  if (node.type === 'index' && typeof node.index === 'string') {
    let head = fieldParts(node.expr);
    return head ? [...head, node.index] : undefined;
  }
  return undefined;
}

function isPipeTo(node: BxlAstNode, name: string): boolean {
  return (
    node.type === 'binary' &&
    node.operator === '|' &&
    node.right.type === 'call' &&
    node.right.name === name &&
    node.right.args.length === 0
  );
}
const isToString = (node: BxlAstNode) => isPipeTo(node, 'tostring');

// Excel's argument list arrives as one array of comma-joined values.
function callArgs(node: Extract<BxlAstNode, { type: 'call' }>): BxlAstNode[] {
  if (node.args.length === 1 && node.args[0].type === 'array') {
    let expr = node.args[0].expr;
    return expr ? flattenComma(expr) : [];
  }
  return node.args.flatMap((a) =>
    a.type === 'binary' && a.operator === ',' ? flattenComma(a) : [a],
  );
}

function flattenComma(node: BxlAstNode): BxlAstNode[] {
  if (node.type === 'binary' && node.operator === ',') {
    return [...flattenComma(node.left), ...flattenComma(node.right)];
  }
  return [node];
}

function arity(name: string, args: unknown[], min: number, max: number) {
  if (args.length < min || args.length > max) {
    throw new SpreadsheetFormulaUnsupported(
      `${name} takes ${min === max ? min : `${min} to ${max === Infinity ? 'any number of' : max}`} arguments`,
    );
  }
}
