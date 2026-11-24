// The names a query expression may call and the calls a source writes: what
// the browser's checks on a query expression read (query-expression.ts), and
// what the SQL compilers on '@cardstack/bxl/sql' share with them, so both
// sides agree on a name. Nothing here compiles or evaluates a formula.
import { parseBxlAst, type BxlAstNode } from '../ast/index.ts';
import { JQ_KEYWORDS } from '../compiler/lexicon.ts';
import {
  BXL_COMMA_ARGUMENT_HELPERS,
  tokenizeReadableSyntax,
  type ReadableSyntaxToken,
} from '../compiler/readable-syntax.ts';
import { resolveBuiltinRegistry } from '../registry/index.ts';

// The functions the score profile computes in SQL (sql/score.ts lists them
// under its own name for its messages).
export const SCORE_PROFILE_FUNCTIONS = [
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
const SCORE_FUNCTIONS = new Set<string>(SCORE_PROFILE_FUNCTIONS);

// The functions the spreadsheet interpreter (sql/formula-eval.ts) computes
// itself, for their rules about blanks and errors; it hands any other
// function to its caller.
export const SPREADSHEET_CORE_FUNCTIONS: ReadonlySet<string> = new Set([
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

// Names that are functions even written without parentheses; any other bare
// name is a field. The score profile and the spreadsheet interpreter share
// the list, so a name is a field in both or neither.
export const BXL_NULLARY_FUNCTIONS: ReadonlySet<string> = new Set([
  'NOW',
  'TODAY',
  'PI',
  'RAND',
  'NA',
  'TRUE',
  'FALSE',
]);

// A score formula's length limit, past which it is refused unread.
export const SCORE_FORMULA_MAX_LENGTH = 2000;

// A score formula's syntax tree, or why it has none: empty, too long, or a
// syntax error, in the words the score compiler refuses it with (it reads
// a formula through this), so a check that only parses refuses as it does.
export function readScoreFormula(
  source: string,
): { body: BxlAstNode } | { error: string } {
  if (typeof source !== 'string' || source.trim() === '') {
    return { error: 'A score formula cannot be empty.' };
  }
  if (source.length > SCORE_FORMULA_MAX_LENGTH) {
    return {
      error: `A score formula is at most ${SCORE_FORMULA_MAX_LENGTH} characters.`,
    };
  }
  let program;
  try {
    program = parseBxlAst(source.trim(), {});
  } catch (e) {
    return { error: `The formula does not parse: ${(e as Error).message}` };
  }
  if (!program.body) {
    return { error: 'A score formula cannot be empty.' };
  }
  return { body: program.body };
}

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

// The names a source calls: a name directly followed by `(`, with whether
// the parentheses are empty (`RAND()` is a call, never a field, though the
// syntax tree gives a bare name and an empty call the same shape).
export function formulaCalls(
  source: string,
): { name: string; empty: boolean }[] {
  return calledNames(tokensOf(source));
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
      SCORE_FUNCTIONS.has(name.toUpperCase()) ||
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
