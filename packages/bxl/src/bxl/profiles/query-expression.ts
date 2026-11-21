import {
  parseBxlAst,
  type BxlAstNode,
  type BxlProfileIssue,
} from '../ast/index.ts';
import { classifyBxlProfileFunction } from './function-safety.ts';
import {
  BXL_NULLARY_FUNCTIONS,
  SPREADSHEET_CORE_FUNCTIONS,
  formulaCalls,
  readScoreFormula,
} from './score-functions.ts';

/**
 * The Profile.query refusals for an expression a query carries (a sort
 * `expression`, with or without `top`, or a blend's expression signal), as
 * error issues; none when it may run.
 *
 * A spreadsheet formula is read as the spreadsheet interpreter reads it, so a
 * bare name is a field (`input * 2` reads the field `input`), and only the
 * functions it calls are checked against the profile. Anything the
 * interpreter does not take (a binding from `LET`, a jq construct) is checked
 * node by node under Profile.query. A source that does not parse has no
 * issues here: compiling it reports the syntax error.
 *
 * A light check, for the browser too: it reads the source's shape and loads
 * neither the score compiler nor the interpreter ('@cardstack/bxl/sql').
 * Whether the expression compiles to SQL is the server's check.
 */
export function queryExpressionIssues(source: string): BxlProfileIssue[] {
  let called = spreadsheetFormulaCalls(source);
  if (called) {
    let issues: BxlProfileIssue[] = [];
    for (let name of new Set(called)) {
      let decision = classifyBxlProfileFunction('query', name);
      if (decision.safety === 'deny') {
        issues.push({
          code: 'query-call-banned',
          severity: 'error',
          message: `Profile.query computes one value from a row in a query and cannot use ${name}${decision.message ? `: ${decision.message}` : ''}.`,
          nodeType: 'call',
        });
      }
    }
    return issues;
  }
  let program;
  try {
    program = parseBxlAst(source.trim(), { profile: 'query' });
  } catch (e) {
    // a module directive reads code from elsewhere; any other syntax error
    // is the compiler's to report
    let word = /"(import|include)" is a reserved word/.exec(
      String((e as Error)?.message),
    )?.[1];
    return word
      ? [
          {
            code: 'query-module-banned',
            severity: 'error',
            message: `Profile.query computes one value from a row in a query and cannot use jq \`${word}\`.`,
          },
        ]
      : [];
  }
  return program.profileIssues.filter((issue) => issue.severity === 'error');
}

class NotASpreadsheetFormula {}
const NOT_A_SPREADSHEET_FORMULA = new NotASpreadsheetFormula();

/**
 * The functions a spreadsheet formula hands to its caller, upper-cased, in
 * the order the spreadsheet interpreter (sql/formula-eval.ts) asks for them;
 * undefined when the interpreter would not take the source. It reads the
 * source as the interpreter does (the same parse, length limit, shapes and
 * argument counts) without loading it; tests/unit/query-expression-cli.ts
 * holds the two to the same answer.
 */
export function spreadsheetFormulaCalls(source: string): string[] | undefined {
  let read = readScoreFormula(source);
  if ('error' in read) return undefined;
  let body = read.body;
  let emptyCalls = new Set(
    formulaCalls(source)
      .filter((c) => c.empty)
      .map((c) => c.name),
  );
  let calls: string[] = [];
  try {
    new SpreadsheetShape(emptyCalls, calls).value(body);
  } catch (e) {
    if (e === NOT_A_SPREADSHEET_FORMULA) return undefined;
    throw e;
  }
  return calls;
}

const COMPARISON = new Set(['==', '=', '!=', '<>', '<', '<=', '>', '>=']);
const ARITHMETIC = new Set(['+', '-', '*', '/', '%']);
const AGGREGATES = new Set(['MIN', 'MAX', 'SUM', 'AVERAGE', 'COUNT']);
// The argument counts the interpreter takes for its own scalar functions.
const ARITY: Record<string, [number, number]> = {
  IF: [2, 3],
  IFERROR: [2, 2],
  IFNA: [2, 2],
  ISBLANK: [1, 1],
  ISERROR: [1, 1],
  ISERR: [1, 1],
  ISNA: [1, 1],
  ISNUMBER: [1, 1],
  ISTEXT: [1, 1],
  ISLOGICAL: [1, 1],
  AND: [1, Infinity],
  OR: [1, Infinity],
  NOT: [1, 1],
  ROUND: [1, 2],
  ROUNDUP: [1, 2],
  ROUNDDOWN: [1, 2],
  ABS: [1, 1],
  SIGN: [1, 1],
  SQRT: [1, 1],
  EXP: [1, 1],
  LN: [1, 1],
  LOG10: [1, 1],
  POWER: [2, 2],
  LOG: [1, 2],
  FLOOR: [1, 2],
  CEILING: [1, 2],
  DAYS: [2, 2],
  NOW: [0, 0],
  TODAY: [0, 0],
};

// The interpreter's compile pass, keeping only whether a node is one it
// takes and which functions it hands to the caller.
class SpreadsheetShape {
  private emptyCalls: ReadonlySet<string>;
  private calls: string[];
  constructor(emptyCalls: ReadonlySet<string>, calls: string[]) {
    this.emptyCalls = emptyCalls;
    this.calls = calls;
  }

  value(node: BxlAstNode): void {
    if (fieldParts(node, this.emptyCalls)) return;
    switch (node.type) {
      case 'literal':
        if (
          node.valueType === 'number' ||
          node.valueType === 'boolean' ||
          node.valueType === 'string' ||
          node.valueType === 'null'
        ) {
          return;
        }
        break;
      case 'unary':
        this.value(node.expr);
        if (node.operator === '-' || node.operator === '+') return;
        break;
      case 'binary':
        return this.#binary(node);
      case 'if':
        for (let b of [{ cond: node.cond, then: node.then }, ...node.elifs]) {
          this.value(b.cond);
          this.value(b.then);
        }
        if (node.else) this.value(node.else);
        return;
      case 'call':
        return this.#call(node.name.toUpperCase(), callArgs(node));
    }
    throw NOT_A_SPREADSHEET_FORMULA;
  }

  #binary(node: Extract<BxlAstNode, { type: 'binary' }>): void {
    let op = node.operator;
    // `a & b` arrives as `(a | tostring) + (b | tostring)`
    if (op === '+' && (isToString(node.left) || isToString(node.right))) {
      this.#text(node.left);
      this.#text(node.right);
      return;
    }
    if (isToString(node)) return this.#text(node);
    // NOT(x) arrives as `x | not`
    if (isPipeTo(node, 'not')) return this.value(node.left);
    this.value(node.left);
    this.value(node.right);
    if (
      op === 'and' ||
      op === 'or' ||
      COMPARISON.has(op) ||
      ARITHMETIC.has(op)
    ) {
      return;
    }
    throw NOT_A_SPREADSHEET_FORMULA;
  }

  #text(node: BxlAstNode): void {
    this.value(
      isToString(node)
        ? (node as Extract<BxlAstNode, { type: 'binary' }>).left
        : node,
    );
  }

  #call(name: string, args: BxlAstNode[]): void {
    if (!SPREADSHEET_CORE_FUNCTIONS.has(name)) {
      this.calls.push(name);
      for (let a of args) this.value(a);
      return;
    }
    if (AGGREGATES.has(name)) {
      arity(args, 1, Infinity);
      for (let a of args) {
        if (!fieldParts(a, this.emptyCalls)) this.value(a);
      }
      return;
    }
    for (let a of args) this.value(a);
    if (name === 'IFS') {
      if (args.length < 2 || args.length % 2) throw NOT_A_SPREADSHEET_FORMULA;
      return;
    }
    let [min, max] = ARITY[name] ?? [1, 0];
    arity(args, min, max);
    if (name === 'DAYS') {
      this.#date(args[0]);
      this.#date(args[1]);
    }
  }

  // A date inside DAYS: NOW(), TODAY() or a field.
  #date(node: BxlAstNode): void {
    if (node.type === 'call' && node.args.length === 0) {
      let name = node.name.toUpperCase();
      if (name === 'NOW' || name === 'TODAY') return;
    }
    if (fieldParts(node, this.emptyCalls)) return;
    throw NOT_A_SPREADSHEET_FORMULA;
  }
}

function arity(args: unknown[], min: number, max: number) {
  if (args.length < min || args.length > max) throw NOT_A_SPREADSHEET_FORMULA;
}

// A field reference: `.a.b`, a bare name that is not a function (`rating`),
// or a dotted chain of them (`brand.name`). A name written with parentheses
// (`RAND()`) is a call.
function fieldParts(
  node: BxlAstNode,
  emptyCalls: ReadonlySet<string>,
): string[] | undefined {
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
      // a list position is not part of a spreadsheet formula
      if (p.type !== 'field') throw NOT_A_SPREADSHEET_FORMULA;
      return p.key;
    });
  }
  if (
    node.type === 'call' &&
    node.args.length === 0 &&
    !BXL_NULLARY_FUNCTIONS.has(node.name.toUpperCase()) &&
    !emptyCalls.has(node.name)
  ) {
    return [node.name];
  }
  if (node.type === 'index' && typeof node.index === 'string') {
    let head = fieldParts(node.expr, emptyCalls);
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
