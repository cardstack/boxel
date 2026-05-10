import { parseNativeJq } from '../bridge/native.js';
import {
  analyzeReadableFunctionCall,
  compileReadableSyntax,
  type ReadableSchema,
  type ReadableSyntaxOptions,
  type ReadableSyntaxToken,
  tokenizeReadableSyntax,
} from '../compiler/readable-syntax.js';
// Shared with readable-syntax.ts — single source of truth in lexicon.ts.
import { JQ_KEYWORDS as KEYWORDS } from '../compiler/lexicon.js';

export type BxlLintSeverity = 'error' | 'warning' | 'info';

export interface BxlLintIssue {
  code: string;
  severity: BxlLintSeverity;
  message: string;
  suggestion?: string;
}

export interface BxlLintOptions extends ReadableSyntaxOptions {
  parseNative?: boolean;
}

export interface BxlLintResult {
  ok: boolean;
  source: string;
  compiledSource?: string;
  issues: BxlLintIssue[];
}

interface LabelInfo {
  label: string;
  normalized: string;
  path: string;
  quoteRequired: boolean;
}

const PREDICATE_OPERATORS = new Set([
  '=',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'IN',
  'BETWEEN',
  'IS',
  'LIKE',
]);

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
}

// Map a ReadableSyntaxError message to a specific linter code so callers can
// handle errors structurally instead of string-matching. Unknown messages fall
// back to 'compile-error' so adding a new thrown message in the compiler never
// breaks existing consumers.
function codeForCompileError(message: string): string {
  if (/1-based/i.test(message)) return 'human-row-zero';
  if (/must be increasing/i.test(message)) return 'descending-row-range';
  if (/Unsupported predicate operator/i.test(message)) return 'unsupported-predicate-op';
  if (/CSS-style pseudo-class syntax was removed/i.test(message)) return 'legacy-pseudo-class-removed';
  if (/Unsupported positional selector keyword/i.test(message)) return 'unsupported-positional-selector';
  if (/Filter-all \[\* \.\.\.\] predicates must use explicit current-item paths/i.test(message)) return 'filter-all-requires-dot';
  if (/Unclosed '/i.test(message)) return 'unclosed-bracket';
  if (/Unterminated string/i.test(message)) return 'unterminated-string';
  if (/Cannot tokenize character/i.test(message)) return 'untokenizable-character';
  if (/Unexpected opener/i.test(message)) return 'unexpected-opener';
  if (/Expected opening punctuation/i.test(message)) return 'missing-opener';
  return 'compile-error';
}

function addIssue(issues: BxlLintIssue[], issue: BxlLintIssue) {
  if (
    issues.some(
      (existing) =>
        existing.code === issue.code &&
        existing.severity === issue.severity &&
        existing.message === issue.message,
    )
  ) {
    return;
  }
  issues.push(issue);
}

function collectLabels(
  schema: ReadableSchema | undefined,
  path: string[] = [],
): LabelInfo[] {
  if (!schema) {
    return [];
  }

  const labels: LabelInfo[] = [];
  for (const field of schema.fields) {
    const names = new Set(
      [field.displayName, field.label, field.key].filter(
        (entry): entry is string => Boolean(entry),
      ),
    );
    const preferred = field.label ?? field.displayName ?? field.key;
    const nextPath = [...path, preferred];

    for (const label of names) {
      labels.push({
        label,
        normalized: normalizeLabel(label),
        path: nextPath.join('.'),
        quoteRequired: /[^A-Za-z0-9_]/.test(label),
      });
    }

    const child =
      field.kind === 'array'
        ? field.item
        : field.item ?? (field.fields ? { fields: field.fields } : undefined);
    labels.push(...collectLabels(child, nextPath));
  }

  return labels;
}

function tokenText(token: ReadableSyntaxToken): string {
  return token.type === 'string' ? `"${token.value}"` : token.value;
}

function identLower(token: ReadableSyntaxToken | undefined): string | undefined {
  return token?.type === 'ident' ? token.value.toLowerCase() : undefined;
}

function isIdent(token: ReadableSyntaxToken | undefined, value: string): boolean {
  return identLower(token) === value.toLowerCase();
}

function matchingClose(open: string): string {
  switch (open) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    default:
      return open;
  }
}

function findMatching(tokens: ReadableSyntaxToken[], start: number): number {
  const open = tokens[start];
  if (!open || open.type !== 'punc') {
    return -1;
  }

  const close = matchingClose(open.value);
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'punc' && token.value === open.value) {
      depth++;
    } else if (token.type === 'punc' && token.value === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function isIdentifierPhrase(tokens: ReadableSyntaxToken[]): boolean {
  return tokens.every(
    (token) =>
      token.type === 'ident' &&
      !KEYWORDS.has(token.value.toLowerCase()) &&
      token.value.toLowerCase() !== 'row' &&
      token.value.toLowerCase() !== 'item' &&
      token.value.toLowerCase() !== 'all',
  );
}

function lintMissingQuotedLabels(
  issues: BxlLintIssue[],
  tokens: ReadableSyntaxToken[],
  labels: LabelInfo[],
) {
  const phraseLabels = new Map(
    labels
      .filter((label) => label.quoteRequired)
      .map((label) => [label.normalized, label]),
  );

  for (let start = 0; start < tokens.length; start++) {
    for (let length = 2; length <= 5 && start + length <= tokens.length; length++) {
      const phraseTokens = tokens.slice(start, start + length);
      if (!isIdentifierPhrase(phraseTokens)) {
        continue;
      }

      const phrase = phraseTokens.map((token) => token.value).join(' ');
      const label = phraseLabels.get(normalizeLabel(phrase));
      if (!label) {
        continue;
      }

      addIssue(issues, {
        code: 'unquoted-label-phrase',
        severity: 'info',
        message: `The words '${phrase}' are accepted as the readable label '${label.label}'.`,
        suggestion: `Quoting it as "${label.label}" is clearer for generated examples and docs.`,
      });
    }
  }
}

function lintTopLevelEquals(
  issues: BxlLintIssue[],
  tokens: ReadableSyntaxToken[],
) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let objectDepth = 0;

  for (const token of tokens) {
    if (token.type === 'punc') {
      if (token.value === '(') {
        parenDepth++;
      } else if (token.value === ')') {
        parenDepth--;
      } else if (token.value === '[') {
        bracketDepth++;
      } else if (token.value === ']') {
        bracketDepth--;
      } else if (token.value === '{') {
        objectDepth++;
      } else if (token.value === '}') {
        objectDepth--;
      }
      continue;
    }

    // Top-level `==` is accepted but non-canonical — BXL prefers the
    // Excel-style `=` everywhere. Silent; solidify rewrites on save.
    if (
      token.type === 'op' &&
      token.value === '==' &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      objectDepth === 0
    ) {
      addIssue(issues, {
        code: 'prefer-excel-equality',
        severity: 'info',
        message:
          'Top-level `==` is accepted, but BXL canonicalizes equality to Excel-style `=`.',
        suggestion: 'Rely on solidify to rewrite, or type `=` directly.',
      });
    }
  }
}

function isHumanIndex(tokens: ReadableSyntaxToken[]): boolean {
  return (
    tokens.length >= 2 &&
    ['row', 'item'].includes(identLower(tokens[0]) ?? '') &&
    tokens[1].type === 'number'
  );
}

function isNativeNumericIndex(tokens: ReadableSyntaxToken[]): boolean {
  return tokens.length === 1 && tokens[0].type === 'number';
}

function isNativeNumericSlice(tokens: ReadableSyntaxToken[]): boolean {
  return (
    tokens.length === 3 &&
    tokens[0].type === 'number' &&
    tokens[1].value === ':' &&
    tokens[2].type === 'number'
  );
}

function isRawIndex(tokens: ReadableSyntaxToken[]): boolean {
  return (
    tokens.length === 2 &&
    tokens[0].value === '#' &&
    tokens[1].type === 'number'
  );
}

function isAllSelector(tokens: ReadableSyntaxToken[]): boolean {
  return (
    tokens.length === 1 &&
    (isIdent(tokens[0], 'all') ||
      tokens[0].value === '...')
  );
}

function isLastCall(tokens: ReadableSyntaxToken[]): boolean {
  return (
    tokens.length >= 3 &&
    isIdent(tokens[0], 'last') &&
    tokens[1].value === '(' &&
    tokens[2].value === ')'
  );
}

function isPredicateSelector(tokens: ReadableSyntaxToken[]): boolean {
  if (
    tokens.length === 0 ||
    isHumanIndex(tokens) ||
    isRawIndex(tokens) ||
    isAllSelector(tokens) ||
    isLastCall(tokens) ||
    isNativeNumericIndex(tokens) ||
    isNativeNumericSlice(tokens)
  ) {
    return false;
  }

  return tokens.some(
    (token) =>
      PREDICATE_OPERATORS.has(token.value) ||
      PREDICATE_OPERATORS.has(token.value.toUpperCase()),
  );
}

// Names where spelling is style-only but useful: Excel dispatch should read
// uppercase, jq dispatch should read lowercase. The compiler decides meaning
// from arity/call shape first, then separator, so the linter must inspect the
// same call context before suggesting a spelling.
const COLLISION_STYLE_NAMES = new Set<string>([
  // Trig
  'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2',
  // Hyperbolic
  'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh',
  // Exp / Log
  'exp', 'log', 'log10', 'log2', 'sqrt',
  // Special
  'gamma', 'erf', 'erfc',
  // Rounding
  'floor', 'round', 'trunc',
  // Practical same-name collisions.
  'index', 'match', 'now', 'trim', 'type',
  // Array (Excel SORT/UNIQUE/TRANSPOSE — single-arg call sites only)
  'sort', 'unique', 'transpose',
]);

const JQ_BARE_STYLE_NAMES = new Set<string>([
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atanh',
  'cos',
  'cosh',
  'erf',
  'erfc',
  'exp',
  'floor',
  'gamma',
  'log',
  'log10',
  'max',
  'min',
  'not',
  'now',
  'round',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trim',
  'trunc',
  'type',
]);

function lintFunctionDispatchStyle(
  issues: BxlLintIssue[],
  tokens: ReadableSyntaxToken[],
  labels: LabelInfo[],
) {
  const singleWordLabels = new Set(
    labels
      .filter((label) => !label.quoteRequired)
      .map((label) => label.normalized),
  );
  for (let index = 0; index < tokens.length; index++) {
    const ident = tokens[index];
    if (ident.type !== 'ident') continue;
    const next = tokens[index + 1];
    const name = ident.value;
    const lower = name.toLowerCase();

    if (next?.type === 'punc' && next.value === '(') {
      const call = analyzeReadableFunctionCall(tokens, index);
      if (!call || !COLLISION_STYLE_NAMES.has(lower)) continue;
      if (call.dispatch.dialect === 'excel') {
        const upper = call.dispatch.name.toUpperCase();
        if (name === upper) continue;
        addIssue(issues, {
          code: 'excel-name-uppercase-preferred',
          severity: 'info',
          message: `${upper} is an Excel formula — spell it UPPERCASE.`,
          suggestion: `Use ${upper}(...) instead of ${name}(...). The lookup is case-insensitive, but UPPERCASE makes the paste-from-spreadsheet contract obvious to readers.`,
        });
      } else if (call.dispatch.dialect === 'jq') {
        const jqName = call.dispatch.name.toLowerCase();
        if (name === jqName) continue;
        addIssue(issues, {
          code: 'jq-name-lowercase-preferred',
          severity: 'info',
          message: `${jqName} is a jq filter in this call shape — spell it lowercase.`,
          suggestion: `Use ${jqName}(...) instead of ${name}(...). Arity and separators decide semantics; lowercase makes the jq intent obvious.`,
        });
      }
      continue;
    }

    if (
      name !== lower &&
      JQ_BARE_STYLE_NAMES.has(lower) &&
      !singleWordLabels.has(lower) &&
      next?.value !== ':' &&
      tokens[index - 1]?.value !== '.'
    ) {
      addIssue(issues, {
        code: 'jq-name-lowercase-preferred',
        severity: 'info',
        message: `${lower} is a jq filter in bare filter shape — spell it lowercase.`,
        suggestion: `Use ${lower} instead of ${name}. Bare filter shape resolves to jq; parenthesized calls such as NOW() keep Excel semantics where applicable.`,
      });
    }
  }
}

function lintSelectors(issues: BxlLintIssue[], tokens: ReadableSyntaxToken[]) {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'punc' || token.value !== '[') {
      continue;
    }

    const close = findMatching(tokens, index);
    if (close === -1) {
      continue;
    }

    const inner = tokens.slice(index + 1, close);

    if (isHumanIndex(inner)) {
      // `[row N]` / `[item N]` are legacy shortcuts kept for backward
      // compatibility. Canonical BXL is `[#N]`.
      addIssue(issues, {
        code: 'row-shortcut-deprecated',
        severity: 'info',
        message: `Selector [${inner[0].value} ${inner[1].value}] is the legacy form of the one-based shortcut.`,
        suggestion: `Prefer [#${inner[1].value}] — solidify will rewrite automatically.`,
      });
    } else if (isNativeNumericIndex(inner) || isNativeNumericSlice(inner)) {
      // Bare `[N]` / `[A:B]` is the jq-native zero-based escape hatch.
      // We surface an info-level nudge toward the one-based readable
      // form so a human reader isn't left wondering.
      addIssue(issues, {
        code: 'native-zero-based-index',
        severity: 'info',
        message: `Selector [${inner.map((part) => part.value).join('')}] uses native jq zero-based indexing.`,
        suggestion:
          'Use [#N] for one-based BXL row access, or keep the native form when that is intentional.',
      });
    }

    if (isPredicateSelector(inner)) {
      addIssue(issues, {
        code: 'predicate-first-match',
        severity: 'info',
        message: `Selector [${inner.map(tokenText).join(' ')}] returns the first matching item.`,
        suggestion:
          'Use any(Collection[]; predicate) for existence checks, all(Collection[]; predicate) for universal checks, or materialize/filter explicitly for all matches.',
      });
    }

    index = close;
  }
}

export function lintBxlExpression(
  source: string,
  options: BxlLintOptions = {},
): BxlLintResult {
  const issues: BxlLintIssue[] = [];
  let tokens: ReadableSyntaxToken[] = [];
  const labels = collectLabels(options.schema);

  try {
    tokens = tokenizeReadableSyntax(source);
    lintMissingQuotedLabels(issues, tokens, labels);
    lintTopLevelEquals(issues, tokens);
    lintSelectors(issues, tokens);
    lintFunctionDispatchStyle(issues, tokens, labels);
  } catch (error) {
    addIssue(issues, {
      code: 'tokenize-error',
      severity: 'error',
      message: errorMessage(error),
    });
  }

  let compiledSource: string | undefined;
  try {
    const compiled = compileReadableSyntax(source, options);
    compiledSource = compiled.source;
    for (const warning of compiled.warnings) {
      addIssue(issues, {
        code: warning.code,
        severity: 'warning',
        message: warning.message,
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    addIssue(issues, {
      code: codeForCompileError(message),
      severity: 'error',
      message,
    });
  }

  if (options.parseNative !== false && compiledSource) {
    try {
      parseNativeJq(source, { schema: options.schema });
    } catch (error) {
      addIssue(issues, {
        code: 'native-parse-error',
        severity: 'error',
        message: errorMessage(error),
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    source,
    compiledSource,
    issues,
  };
}
