import {
  BXL_COMMA_ARGUMENT_HELPERS,
  BXL_FORMULA_FUNCTIONS,
  compileReadableSyntax,
  preprocessReadableSource,
  registerCompiledJqFormatter,
  tokenizeReadableSyntax,
  type ReadableField,
  type ReadableSchema,
  type ReadableSyntaxCompileResult,
  type ReadableSyntaxOptions,
  type ReadableSyntaxToken,
} from '../compiler/readable-syntax.js';
import {
  lintBxlExpression,
  type BxlLintIssue,
  type BxlLintResult,
} from '../linter/index.js';

export interface BxlConversionOptions extends ReadableSyntaxOptions {
  schema?: ReadableSchema;
}

export interface BxlRewrite {
  code: string;
  message: string;
}

export interface BxlSolidifyResult {
  source: string;
  changed: boolean;
  rewrites: BxlRewrite[];
  before: BxlLintResult;
  after: BxlLintResult;
}

export interface JqToReadableBxlResult {
  source: string;
  changed: boolean;
  rewrites: BxlRewrite[];
  lint: BxlLintResult;
}

interface Edit extends BxlRewrite {
  start: number;
  end: number;
  text: string;
}

interface LabelCandidate {
  normalized: string;
  tokenCount: number;
  label: string;
}

interface FieldPath {
  field: ReadableField;
  scope?: ReadableSchema;
  itemScope?: ReadableSchema;
}

type PathPart =
  | { type: 'field'; key: string }
  | { type: 'index'; value: number }
  | { type: 'iterator' };

const BXL_KEYWORDS = new Set([
  'and',
  'as',
  'break',
  'catch',
  'def',
  'elif',
  'else',
  'end',
  'foreach',
  'if',
  'label',
  'not',
  'or',
  'reduce',
  'then',
  'try',
]);

const BXL_CANONICAL_WORDS = new Map([
  ['all', 'all'],
  ['and', 'and'],
  ['contains', 'contains'],
  ['else', 'else'],
  ['end', 'end'],
  ['endswith', 'endswith'],
  ['false', 'false'],
  ['if', 'if'],
  ['in', 'IN'],
  ['null', 'null'],
  ['or', 'or'],
  ['overlaps', 'overlaps'],
  ['row', 'row'],
  ['startswith', 'startswith'],
  ['then', 'then'],
  ['true', 'true'],
]);

const TOP_LEVEL_COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>=']);

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokenRaw(source: string, token: ReadableSyntaxToken): string {
  if (typeof token.start === 'number' && typeof token.end === 'number') {
    return source.slice(token.start, token.end);
  }
  return token.raw ?? token.value;
}

function quoteLabel(label: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(label) &&
    !BXL_KEYWORDS.has(label.toLowerCase())
    ? label
    : JSON.stringify(label);
}

function childScope(field: ReadableField): ReadableSchema | undefined {
  if (field.kind === 'array') {
    return field.item;
  }
  return field.item ?? (field.fields ? { fields: field.fields } : undefined);
}

function itemScope(field: ReadableField): ReadableSchema | undefined {
  return field.kind === 'array' ? field.item : undefined;
}

function preferredLabel(field: ReadableField): string {
  return field.label ?? field.displayName ?? field.key;
}

function collectLabelCandidates(
  schema: ReadableSchema | undefined,
): LabelCandidate[] {
  if (!schema) {
    return [];
  }

  const rawCandidates: LabelCandidate[] = [];
  function visit(scope: ReadableSchema) {
    for (const field of scope.fields) {
      const label = preferredLabel(field);
      const names = new Set(
        [field.key, field.label, field.displayName].filter(
          (entry): entry is string => Boolean(entry),
        ),
      );
      for (const name of names) {
        rawCandidates.push({
          normalized: normalizeLabel(name),
          tokenCount: name.split(/[^A-Za-z0-9_]+/).filter(Boolean).length,
          label,
        });
      }
      const child = childScope(field);
      if (child) {
        visit(child);
      }
    }
  }
  visit(schema);

  const byNormalized = new Map<string, Set<string>>();
  for (const candidate of rawCandidates) {
    if (!byNormalized.has(candidate.normalized)) {
      byNormalized.set(candidate.normalized, new Set());
    }
    byNormalized.get(candidate.normalized)!.add(candidate.label);
  }

  return rawCandidates.filter(
    (candidate) => byNormalized.get(candidate.normalized)?.size === 1,
  );
}

function findField(scope: ReadableSchema | undefined, key: string): FieldPath | undefined {
  const field = scope?.fields.find((candidate) => candidate.key === key);
  if (!field) {
    return undefined;
  }
  return {
    field,
    scope: childScope(field),
    itemScope: itemScope(field),
  };
}

function dedupeEdits(edits: Edit[]): Edit[] {
  const sorted = [...edits].sort((left, right) =>
    left.start - right.start ||
    right.end - left.end ||
    left.code.localeCompare(right.code),
  );
  const output: Edit[] = [];
  let occupiedUntil = -1;

  for (const edit of sorted) {
    if (edit.start < occupiedUntil || edit.start === edit.end && edit.text === '') {
      continue;
    }
    output.push(edit);
    occupiedUntil = edit.end;
  }

  return output;
}

function applyEdits(source: string, edits: Edit[]) {
  const safeEdits = dedupeEdits(edits);
  let output = source;

  for (const edit of [...safeEdits].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }

  return {
    source: output,
    rewrites: safeEdits.map(({ code, message }) => ({ code, message })),
  };
}

function tokenDepthBefore(tokens: ReadableSyntaxToken[], index: number) {
  let paren = 0;
  let bracket = 0;
  let object = 0;

  for (let i = 0; i < index; i++) {
    const token = tokens[i];
    if (token.type !== 'punc') {
      continue;
    }
    if (token.value === '(') paren++;
    else if (token.value === ')') paren--;
    else if (token.value === '[') bracket++;
    else if (token.value === ']') bracket--;
    else if (token.value === '{') object++;
    else if (token.value === '}') object--;
  }

  return { paren, bracket, object };
}

function isTopLevel(tokens: ReadableSyntaxToken[], index: number) {
  const depth = tokenDepthBefore(tokens, index);
  return depth.paren === 0 && depth.bracket === 0 && depth.object === 0;
}

function normalizationEdits(source: string, options: BxlConversionOptions): Edit[] {
  let tokens: ReadableSyntaxToken[];
  try {
    tokens = tokenizeReadableSyntax(source);
  } catch {
    // Source has a tokenize-level error (unknown character, unterminated
    // string, etc.). Leave the source unchanged — the linter surfaces the
    // diagnostic separately, and callers see the original text.
    return [];
  }
  const labelCandidates = collectLabelCandidates(options.schema);
  const maxLabelTokens = Math.max(
    1,
    ...labelCandidates.map((candidate) => candidate.tokenCount),
  );
  const labelByNormalized = new Map(
    labelCandidates.map((candidate) => [candidate.normalized, candidate]),
  );
  const edits: Edit[] = [];
  const consumedTokenIndexes = new Set<number>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'ident' || consumedTokenIndexes.has(index)) {
      continue;
    }

    const next = tokens[index + 1];
    const upper = token.value.toUpperCase();
    const lower = token.value.toLowerCase();

    if (next?.value === '(' && BXL_FORMULA_FUNCTIONS.has(upper)) {
      const raw = tokenRaw(source, token);
      if (raw !== upper && token.start !== undefined && token.end !== undefined) {
        edits.push({
          start: token.start,
          end: token.end,
          text: upper,
          code: 'formula-case',
          message: `Normalized formula function ${raw} to ${upper}.`,
        });
      }
      continue;
    }

    // Skip canonicalization for idents in object-literal key position:
    // `{ category: ... }` passes data-level keys, not BXL display labels.
    // Detected as "inside an unclosed `{` AND followed by `:` punc".
    if (
      next?.type === 'punc' &&
      next.value === ':' &&
      tokenDepthBefore(tokens, index).object > 0
    ) {
      continue;
    }

    for (let length = Math.min(maxLabelTokens, tokens.length - index); length >= 1; length--) {
      const phraseTokens = tokens.slice(index, index + length);
      if (
        phraseTokens.some(
          (entry) =>
            entry.type !== 'ident' ||
            BXL_KEYWORDS.has(entry.value.toLowerCase()) ||
            BXL_CANONICAL_WORDS.has(entry.value.toLowerCase()),
        )
      ) {
        continue;
      }

      const normalized = normalizeLabel(
        phraseTokens.map((entry) => entry.value).join(' '),
      );
      const candidate = labelByNormalized.get(normalized);
      if (!candidate) {
        continue;
      }

      const first = phraseTokens[0];
      const last = phraseTokens[phraseTokens.length - 1];
      if (first.start === undefined || last.end === undefined) {
        continue;
      }

      const replacement = quoteLabel(candidate.label);
      const raw = source.slice(first.start, last.end);
      if (raw !== replacement) {
        edits.push({
          start: first.start,
          end: last.end,
          text: replacement,
          code: 'label-canonicalized',
          message: `Normalized ${raw} to ${replacement}.`,
        });
      }
      for (let consumed = index; consumed < index + length; consumed++) {
        consumedTokenIndexes.add(consumed);
      }
      break;
    }

    if (consumedTokenIndexes.has(index)) {
      continue;
    }

    if (BXL_CANONICAL_WORDS.has(lower)) {
      const replacement = BXL_CANONICAL_WORDS.get(lower)!;
      const raw = tokenRaw(source, token);
      if (
        raw !== replacement &&
        token.start !== undefined &&
        token.end !== undefined
      ) {
        edits.push({
          start: token.start,
          end: token.end,
          text: replacement,
          code: 'keyword-case',
          message: `Normalized ${raw} to ${replacement}.`,
        });
      }
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.value !== '[' || token.start === undefined) {
      continue;
    }

    const first = tokens[index + 1];
    const second = tokens[index + 2];
    const third = tokens[index + 3];
    const fourth = tokens[index + 4];
    const fifth = tokens[index + 5];

    // `[row N]` / `[item N]` — legacy pseudo-row shortcuts, now canonicalized
    // to `[#N]`. The runtime still parses both for backward compat.
    if (
      first?.type === 'ident' &&
      ['row', 'item'].includes(first.value.toLowerCase()) &&
      second?.type === 'number' &&
      third?.value === ']' &&
      third.end !== undefined
    ) {
      edits.push({
        start: token.start,
        end: third.end,
        text: `[#${second.value}]`,
        code: 'row-shortcut-to-hash',
        message: `Rewrote [${first.value} ${second.value}] to canonical [#${second.value}].`,
      });
      continue;
    }

    // `[row N..M]` / `[item N..M]` — legacy range form, canonicalized to
    // `[#N..#M]` so the inclusive end stays visually explicit.
    if (
      first?.type === 'ident' &&
      ['row', 'item'].includes(first.value.toLowerCase()) &&
      second?.type === 'number' &&
      third?.type === 'op' &&
      third.value === '..' &&
      fourth?.type === 'number' &&
      fifth?.value === ']' &&
      fifth.end !== undefined
    ) {
      edits.push({
        start: token.start,
        end: fifth.end,
        text: `[#${second.value}..#${fourth.value}]`,
        code: 'row-shortcut-to-hash',
        message: `Rewrote [${first.value} ${second.value}..${fourth.value}] to canonical [#${second.value}..#${fourth.value}].`,
      });
      continue;
    }

    if (
      first?.type === 'number' &&
      second?.value === ':' &&
      third?.type === 'number' &&
      fourth?.value === ':' &&
      fifth?.value === ']'
    ) {
      continue;
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token.type === 'op' &&
      token.value === '=' &&
      token.start !== undefined &&
      token.end !== undefined &&
      isTopLevel(tokens, index)
    ) {
      edits.push({
        start: token.start,
        end: token.end,
        text: '==',
        code: 'top-level-equals-to-comparison',
        message: 'Converted top-level = to ==.',
      });
    }
  }

  // Prefer comma as the argument separator inside readable formula calls,
  // BXL-native lowercase helper calls, and the `all` / `any` combinators.
  // Keeps `;` for anything the parser doesn't recognise as a comma-safe
  // name (unknown identifiers, raw jq constructs, etc.) so we don't break
  // edge cases.
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'ident') {
      continue;
    }
    const upper = token.value.toUpperCase();
    const lower = token.value.toLowerCase();
    const isFormula = BXL_FORMULA_FUNCTIONS.has(upper);
    const isHelper = BXL_COMMA_ARGUMENT_HELPERS.has(lower);
    const isAllAny = lower === 'all' || lower === 'any';
    if (!isFormula && !isHelper && !isAllAny) {
      continue;
    }

    const open = tokens[index + 1];
    if (!open || open.type !== 'punc' || open.value !== '(') {
      continue;
    }

    let depth = 1;
    let close = -1;
    for (let j = index + 2; j < tokens.length; j++) {
      const inner = tokens[j];
      if (inner.type !== 'punc') continue;
      if (['(', '[', '{'].includes(inner.value)) {
        depth++;
      } else if ([')', ']', '}'].includes(inner.value)) {
        depth--;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1) {
      continue;
    }

    let topLevelDepth = 0;
    for (let j = index + 2; j < close; j++) {
      const inner = tokens[j];
      if (inner.type === 'punc' && ['(', '[', '{'].includes(inner.value)) {
        topLevelDepth++;
        continue;
      }
      if (inner.type === 'punc' && [')', ']', '}'].includes(inner.value)) {
        topLevelDepth--;
        continue;
      }
      if (
        topLevelDepth === 0 &&
        inner.type === 'punc' &&
        inner.value === ';' &&
        inner.start !== undefined &&
        inner.end !== undefined
      ) {
        const displayName = isFormula ? upper : lower;
        edits.push({
          start: inner.start,
          end: inner.end,
          text: ',',
          code: 'separator-comma-normalized',
          message: `Normalized ; to , inside ${displayName}(...).`,
        });
      }
    }
  }

  return edits;
}

function hasOuterParens(source: string) {
  const trimmed = source.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return false;
  }

  let depth = 0;
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0 && index < trimmed.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function parenthesizePipedComparison(source: string): { source: string; rewrite?: BxlRewrite } {
  const tokens = tokenizeReadableSyntax(source);
  let sawPipe = false;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!isTopLevel(tokens, index)) {
      continue;
    }
    if (token.type === 'op' && token.value === '|') {
      sawPipe = true;
      continue;
    }
    if (
      sawPipe &&
      token.type === 'op' &&
      TOP_LEVEL_COMPARISONS.has(token.value) &&
      token.start !== undefined &&
      token.end !== undefined
    ) {
      const left = source.slice(0, token.start).trim();
      const right = source.slice(token.end).trim();
      if (!left || !right || hasOuterParens(left)) {
        return { source };
      }
      return {
        source: `(${left}) ${token.value} ${right}`,
        rewrite: {
          code: 'pipe-comparison-parenthesized',
          message: 'Parenthesized the piped side of a top-level comparison.',
        },
      };
    }
  }

  return { source };
}

function issueCodes(issues: BxlLintIssue[]) {
  return new Set(issues.map((issue) => issue.code));
}

function isValueToken(token: ReadableSyntaxToken | undefined) {
  return Boolean(
    token &&
      (
        ['ident', 'number', 'string', 'var', 'format'].includes(token.type) ||
        [')', ']'].includes(token.value)
      ),
  );
}

function shouldInsertSpace(
  previous: ReadableSyntaxToken | undefined,
  current: ReadableSyntaxToken,
) {
  if (!previous) {
    return false;
  }

  // Argument separators always get a trailing space — even before a
  // tight-binding `.` that starts the next argument. Guard by token type
  // so a string literal whose content happens to be ',' or ';' isn't
  // mistaken for a separator.
  if (
    (previous.type === 'op' || previous.type === 'punc') &&
    (previous.value === ',' || previous.value === ';')
  ) {
    return true;
  }

  if (['.', '[', ']', ')', ':'].includes(current.value)) {
    return false;
  }
  if (['.', '[', '(', ':', '#'].includes(previous.value)) {
    return false;
  }
  if (current.value === '(') {
    return false;
  }
  if (current.value === ',' || current.value === ';') {
    return false;
  }
  if (['==', '!=', '<', '<=', '>', '>=', '=', '|'].includes(current.value)) {
    return true;
  }
  if (['==', '!=', '<', '<=', '>', '>=', '=', '|'].includes(previous.value)) {
    return true;
  }
  if (current.value === '..' || previous.value === '..') {
    return false;
  }

  return isValueToken(previous) && isValueToken(current);
}

function formatBxlSource(source: string): string {
  try {
    const tokens = tokenizeReadableSyntax(source);
    let output = '';
    let previous: ReadableSyntaxToken | undefined;

    for (const token of tokens) {
      if (shouldInsertSpace(previous, token)) {
        output += ' ';
      }
      output += token.raw ?? tokenRaw(source, token);
      previous = token;
    }
    return output;
  } catch {
    return source;
  }
}

function shouldInsertReadableSpace(
  previous: ReadableSyntaxToken | undefined,
  current: ReadableSyntaxToken,
  prevPrev?: ReadableSyntaxToken,
) {
  if (!previous) {
    return false;
  }

  // Argument separators always get a trailing space — even before a
  // tight-binding `.` that starts the next argument. Guard by token type
  // so a string literal whose content happens to be ',' or ';' isn't
  // mistaken for a separator.
  if (
    (previous.type === 'op' || previous.type === 'punc') &&
    (previous.value === ',' || previous.value === ';')
  ) {
    return true;
  }

  if ([',', ';', ')', ']', '}'].includes(current.value)) {
    return false;
  }
  if (['(', '[', '{', '#'].includes(previous.value)) {
    return false;
  }
  // `(` after a jq keyword (`or`, `and`, `not`, `if`, etc.) must have a
  // space — `or(.x)` would be parsed as a call to `or/1` by jq. Only
  // collapse `(` when it's a call or parenthesized expression attached
  // to a value token.
  const JQ_BINDING_KEYWORDS = new Set(['as', 'if', 'then', 'else', 'elif', 'end', 'and', 'or', 'not', 'try', 'catch', 'reduce', 'foreach', 'label', 'def']);
  if (
    current.value === '(' &&
    previous.type === 'ident' &&
    JQ_BINDING_KEYWORDS.has(previous.value.toLowerCase())
  ) {
    return true;
  }
  if (current.value === '(') {
    return false;
  }
  if (current.value === '..' || previous.value === '..') {
    return false;
  }
  // jq keywords (`and`, `or`, `not`, `if`, `then`, …) LOOK like idents
  // so `isValueToken` returns true for them, but `and.foo` / `not.foo`
  // are invalid jq. Force a space between a jq keyword and anything
  // word-like or path-like that follows.
  if (
    previous.type === 'ident' &&
    JQ_BINDING_KEYWORDS.has(previous.value.toLowerCase()) &&
    (current.value === '.' ||
      current.value === '..' ||
      current.type === 'ident' ||
      current.type === 'var' ||
      current.type === 'number' ||
      current.type === 'string' ||
      current.value === '(' ||
      current.value === '[' ||
      current.value === '{' ||
      current.value === '-')
  ) {
    return true;
  }

  // Field access stays tight-binding — `Customer.Name`, `[all].SKU`,
  // `[#last].Field`. But `.field` after a binary arith op (`a - .foo`)
  // should still get a space; only suppress the space when the `.` is
  // attached to a value token or another `.` (chained field access).
  // Also: `. as $root` should stay spaced — the bare identity dot is
  // not gluing to the following keyword.
  if (
    current.value === '.' &&
    (isValueToken(previous) || previous.value === '.')
  ) {
    return false;
  }
  if (
    previous.value === '.' &&
    current.type === 'ident' &&
    JQ_BINDING_KEYWORDS.has(current.value.toLowerCase())
  ) {
    return true;
  }
  if (previous.value === '.' && (isValueToken(current) || current.value === '.')) {
    return false;
  }
  if (current.value === '[' && isValueToken(previous)) {
    return false;
  }
  if (['==', '!=', '<', '<=', '>', '>=', '=', '|'].includes(current.value)) {
    return true;
  }
  if (['==', '!=', '<', '<=', '>', '>=', '=', '|'].includes(previous.value)) {
    return true;
  }
  // Binary arithmetic gets breathing room in readable output. `+`, `*`,
  // `/`, `%` are always binary; `-` needs a look-back to tell unary
  // (`(-5)`) from binary (`a - b`) — it's binary when the token before
  // the operator is a value-ish token.
  const valueStart = (tok: ReadableSyntaxToken | undefined) =>
    Boolean(
      tok &&
        (isValueToken(tok) ||
          (tok.type === 'op' && tok.value === '.') ||
          (tok.type === 'punc' && tok.value === '(')),
    );
  if (
    current.type === 'op' &&
    isValueToken(previous) &&
    ['+', '*', '/', '%'].includes(current.value)
  ) {
    return true;
  }
  if (
    previous.type === 'op' &&
    valueStart(current) &&
    ['+', '*', '/', '%'].includes(previous.value)
  ) {
    // Exception: `*` immediately after `[` is the BXL filter-all marker
    // (`[* .pred]`), not a binary op. Same goes for `[` after a comma /
    // semicolon / `,` (inner argument boundary).
    if (
      previous.value === '*' &&
      prevPrev &&
      prevPrev.type === 'punc' &&
      (prevPrev.value === '[' || prevPrev.value === ',' || prevPrev.value === ';')
    ) {
      return false;
    }
    return true;
  }
  if (
    current.type === 'op' &&
    current.value === '-' &&
    isValueToken(previous)
  ) {
    return true;
  }
  if (
    previous.type === 'op' &&
    previous.value === '-' &&
    valueStart(current) &&
    isValueToken(prevPrev)
  ) {
    return true;
  }

  return isValueToken(previous) && isValueToken(current);
}

function formatReadableBxlSource(source: string): string {
  try {
    const tokens = tokenizeReadableSyntax(source);
    let output = '';
    let previous: ReadableSyntaxToken | undefined;
    let prevPrev: ReadableSyntaxToken | undefined;

    for (const token of tokens) {
      if (shouldInsertReadableSpace(previous, token, prevPrev)) {
        output += ' ';
      }
      output += token.raw ?? tokenRaw(source, token);
      prevPrev = previous;
      previous = token;
    }
    return output
      .replace(/\[#last\s*-\s*(\d+)\]/g, '[#last-$1]')
      .replace(/#(\d+)\s*\.\.\s*(\d+)(?=[,\]])/g, '#$1..#$2');
  } catch {
    return source;
  }
}

// Rewrite canonical `==` / `!=` to Excel-style `=` / `<>` for readable
// BXL display. Operates via the tokenizer so string literals and raw
// jq tokens like `>=` / `<=` (which contain `=` internally but aren't
// equality ops) are untouched. Called only by the BXL-display
// functions (solidify, jqToReadable, expand, collapse) — the compile
// path keeps canonical jq `==` / `!=` so the runtime stays valid.
function rewriteToExcelComparisons(source: string): string {
  let tokens: ReadableSyntaxToken[];
  try {
    tokens = tokenizeReadableSyntax(source);
  } catch {
    // Source has a tokenize error — skip the display rewrite; the
    // linter surfaces the diagnostic via a separate path.
    return source;
  }
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const tok of tokens) {
    if (tok.type !== 'op') continue;
    if (tok.start === undefined || tok.end === undefined) continue;
    if (tok.value === '==') {
      edits.push({ start: tok.start, end: tok.end, replacement: '=' });
    } else if (tok.value === '!=') {
      edits.push({ start: tok.start, end: tok.end, replacement: '<>' });
    }
  }
  if (edits.length === 0) return source;
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  out += source.slice(cursor);
  return out;
}

export function solidifyBxlExpression(
  source: string,
  options: BxlConversionOptions = {},
): BxlSolidifyResult {
  const before = lintBxlExpression(source, options);
  let nextSource = source;
  const rewrites: BxlRewrite[] = [];

  // Absorb Excel-specific idioms (leading `=`, `a ^ b`, `a & b`,
  // `<>` already handled in the tokenizer) up front.
  const pre = preprocessReadableSource(nextSource);
  if (pre.source !== nextSource) {
    nextSource = pre.source;
    rewrites.push(...pre.rewrites);
  }

  const firstPass = applyEdits(nextSource, normalizationEdits(nextSource, options));
  nextSource = firstPass.source;
  rewrites.push(...firstPass.rewrites);

  const currentIssues = issueCodes(lintBxlExpression(nextSource, options).issues);
  if (currentIssues.has('root-label-after-pipe')) {
    const pipeFix = parenthesizePipedComparison(nextSource);
    nextSource = pipeFix.source;
    if (pipeFix.rewrite) {
      rewrites.push(pipeFix.rewrite);
    }
  }

  const secondPass = applyEdits(nextSource, normalizationEdits(nextSource, options));
  nextSource = secondPass.source;
  rewrites.push(...secondPass.rewrites);

  const formatted = formatBxlSource(nextSource);
  if (formatted !== nextSource) {
    nextSource = formatted;
    rewrites.push({
      code: 'spacing-normalized',
      message: 'Normalized BXL token spacing.',
    });
  }

  const excelified = rewriteToExcelComparisons(nextSource);
  if (excelified !== nextSource) {
    nextSource = excelified;
    rewrites.push({
      code: 'excel-style-comparisons',
      message: 'Normalized `==`/`!=` to Excel-style `=`/`<>` in readable BXL.',
    });
  }

  const after = lintBxlExpression(nextSource, options);
  return {
    source: nextSource,
    changed: nextSource !== source,
    rewrites,
    before,
    after,
  };
}

// Hook the readable-spacing formatter into `compileReadableSyntax` so
// every caller (evaluateBxlExpression, bxlToJqExpression, linter, etc.)
// sees the polished jq output. The forward-declaration in
// readable-syntax.ts avoids a module cycle.
registerCompiledJqFormatter((source) => {
  try {
    const out = formatReadableBxlSource(source);
    return out || source;
  } catch {
    return source;
  }
});

export function bxlToJqExpression(
  source: string,
  options: BxlConversionOptions = {},
): ReadableSyntaxCompileResult {
  return compileReadableSyntax(source, options);
}

export function bxlToStorageExpression(
  source: string,
  options: BxlConversionOptions = {},
): ReadableSyntaxCompileResult {
  return compileReadableSyntax(source, options);
}

function parseJqPath(source: string, start: number): { end: number; parts: PathPart[] } | undefined {
  if (source[start] !== '.' || !/[A-Za-z_]/.test(source[start + 1] ?? '')) {
    return undefined;
  }

  const parts: PathPart[] = [];
  let index = start;

  while (index < source.length) {
    if (source[index] === '.') {
      if (source[index + 1] === '[') {
        break;
      }
      index++;
      let key = '';
      while (/[A-Za-z0-9_]/.test(source[index] ?? '')) {
        key += source[index++];
      }
      if (!key) {
        return undefined;
      }
      parts.push({ type: 'field', key });
      continue;
    }

    if (source[index] === '[' && source[index + 1] === ']') {
      parts.push({ type: 'iterator' });
      index += 2;
      continue;
    }

    const indexMatch = source.slice(index).match(/^\[(-?\d+)\]/);
    if (indexMatch) {
      parts.push({ type: 'index', value: Number(indexMatch[1]) });
      index += indexMatch[0].length;
      continue;
    }

    break;
  }

  return parts.some((part) => part.type === 'field')
    ? { end: index, parts }
    : undefined;
}

function readablePathFromParts(
  parts: PathPart[],
  schema: ReadableSchema | undefined,
): string | undefined {
  let scope = schema;
  let pendingArrayItemScope: ReadableSchema | undefined;
  let output = '';

  for (const part of parts) {
    if (part.type === 'field') {
      const resolved = findField(scope, part.key);
      if (!resolved) {
        return undefined;
      }
      output += output ? `.${quoteLabel(preferredLabel(resolved.field))}` : quoteLabel(preferredLabel(resolved.field));
      scope = resolved.scope;
      pendingArrayItemScope = resolved.itemScope;
      continue;
    }

    if (!pendingArrayItemScope) {
      return undefined;
    }

    if (part.type === 'iterator') {
      output += '[all]';
      scope = pendingArrayItemScope;
      pendingArrayItemScope = undefined;
      continue;
    }

    if (part.value === 0) {
      output += '[#first]';
    } else if (part.value === -1) {
      output += '[#last]';
    } else if (part.value < 0) {
      output += `[#last-${Math.abs(part.value) - 1}]`;
    } else {
      output += `[#${part.value + 1}]`;
    }
    scope = pendingArrayItemScope;
    pendingArrayItemScope = undefined;
  }

  return output;
}

function readableJqPath(
  source: string,
  schema: ReadableSchema | undefined,
): string | undefined {
  const parsed = parseJqPath(source, 0);
  return parsed && parsed.end === source.length
    ? readablePathFromParts(parsed.parts, schema)
    : undefined;
}

function convertFirstSelect(source: string, schema: ReadableSchema | undefined) {
  return source.replace(
    /first\((\.[A-Za-z_][A-Za-z0-9_]*)\[\]\s*\|\s*select\((\.[A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*([^)]*)\)\)(\.[A-Za-z_][A-Za-z0-9_]*)/g,
    (match, collectionPath, predicatePath, operator, value, outputPath) => {
      const collection = parseJqPath(collectionPath, 0);
      const predicate = parseJqPath(predicatePath, 0);
      const output = parseJqPath(outputPath, 0);
      if (!collection || !predicate || !output) {
        return match;
      }

      const collectionReadable = readablePathFromParts(
        [...collection.parts, { type: 'iterator' }],
        schema,
      )?.replace(/\[all\]$/, '');
      const predicateReadable = readablePathFromParts(predicate.parts, itemScopeForPath(collection.parts, schema));
      const outputReadable = readablePathFromParts(output.parts, itemScopeForPath(collection.parts, schema));
      if (!collectionReadable || !predicateReadable || !outputReadable) {
        return match;
      }

      const bxlOperator = operator === '==' ? '=' : operator;
      return `${collectionReadable}[${predicateReadable} ${bxlOperator} ${value.trim()}].${outputReadable}`;
    },
  );
}

function itemScopeForPath(
  parts: PathPart[],
  schema: ReadableSchema | undefined,
): ReadableSchema | undefined {
  let scope = schema;
  let pendingArrayItemScope: ReadableSchema | undefined;

  for (const part of parts) {
    if (part.type === 'field') {
      const resolved = findField(scope, part.key);
      if (!resolved) {
        return undefined;
      }
      scope = resolved.scope;
      pendingArrayItemScope = resolved.itemScope;
    } else if (part.type === 'iterator' || part.type === 'index') {
      scope = pendingArrayItemScope;
      pendingArrayItemScope = undefined;
    }
  }

  return pendingArrayItemScope ?? scope;
}

function convertAggregateComparison(source: string, schema: ReadableSchema | undefined) {
  return source.replace(
    /\(\s*\[\s*(\.[A-Za-z_][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\]\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*(==|!=|<=|>=|<|>)\s*(\.[A-Za-z_][A-Za-z0-9_.]*)/g,
    (match, path, filter, operator, rightPath) => {
      const leftReadable = readableJqPath(path, schema);
      const rightReadable = readableJqPath(rightPath, schema);
      if (!leftReadable || !rightReadable) {
        return match;
      }
      return `(${leftReadable} | ${filter}) ${operator} ${rightReadable}`;
    },
  );
}

function convertSimpleJqPaths(source: string, schema: ReadableSchema | undefined) {
  let output = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < source.length) {
    const char = source[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index++;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index++;
      continue;
    }

    const path = parseJqPath(source, index);
    if (path) {
      const readable = readablePathFromParts(path.parts, schema);
      if (readable) {
        output += readable;
        index = path.end;
        continue;
      }
    }

    output += char;
    index++;
  }

  return output;
}

export function jqToReadableBxlExpression(
  source: string,
  options: BxlConversionOptions = {},
): JqToReadableBxlResult {
  let nextSource = source;
  const rewrites: BxlRewrite[] = [];

  const firstSelect = convertFirstSelect(nextSource, options.schema);
  if (firstSelect !== nextSource) {
    rewrites.push({
      code: 'jq-first-select-to-readable-predicate',
      message: 'Converted first(select(...)) jq shape to a readable BXL predicate selector.',
    });
    nextSource = firstSelect;
  }

  const aggregate = convertAggregateComparison(nextSource, options.schema);
  if (aggregate !== nextSource) {
    rewrites.push({
      code: 'jq-aggregate-comparison-to-readable',
      message: 'Converted a materialized jq aggregate comparison to readable BXL.',
    });
    nextSource = aggregate;
  }

  const simplePaths = convertSimpleJqPaths(nextSource, options.schema);
  if (simplePaths !== nextSource) {
    rewrites.push({
      code: 'jq-paths-to-readable-labels',
      message: 'Converted jq object paths to readable BXL labels.',
    });
    nextSource = simplePaths;
  }

  const solid = solidifyBxlExpression(nextSource, options);
  const readableSource = formatReadableBxlSource(solid.source);
  const readableLint = lintBxlExpression(readableSource, options);
  const spacingRewrite: BxlRewrite[] = readableSource === solid.source
    ? []
    : [{
        code: 'readable-spacing-normalized',
        message: 'Expanded BXL spacing for readability.',
      }];

  return {
    source: readableSource,
    changed: readableSource !== source,
    rewrites: [...rewrites, ...solid.rewrites, ...spacingRewrite],
    lint: readableLint,
  };
}

export function storageToReadableBxlExpression(
  source: string,
  options: BxlConversionOptions = {},
): JqToReadableBxlResult {
  return jqToReadableBxlExpression(source, options);
}

// =========================================================================
// Multi-line / single-line format conversion
// =========================================================================
//
// These helpers toggle BXL expressions between a compact single-line form
// (handy for copy/paste and narrow UI surfaces) and an indented multi-line
// form (handy for reading large pipelines or deeply-nested formula calls
// in a textarea). Both round-trip: collapsing an expanded form produces
// the same canonical single-line text that `formatReadableBxlSource`
// would.

export interface BxlFormatResult {
  source: string;
  changed: boolean;
  rewrites: BxlRewrite[];
}

// Strip line breaks and collapse runs of whitespace into single spaces,
// then re-run the canonical readable spacing so the output matches the
// form emitted by `jqToReadableBxlExpression` / the workbench highlight.
export function collapseBxlExpression(
  source: string,
  _options: BxlConversionOptions = {},
): BxlFormatResult {
  const stripped = source.replace(/\s+/g, ' ').trim();
  let next: string;
  try {
    next = formatReadableBxlSource(stripped);
  } catch {
    next = stripped;
  }
  if (!next) next = stripped;
  return {
    source: next,
    changed: next !== source,
    rewrites:
      next !== source
        ? [{ code: 'format-collapsed', message: 'Collapsed to a single line.' }]
        : [],
  };
}

const MULTI_LINE_INDENT = '  ';
const MULTI_LINE_WRAP_THRESHOLD = 40;

// Decide which opening punctuation spans ought to wrap onto multiple
// lines. A span qualifies when its inline rendering (tokens joined with
// canonical spacing) exceeds MULTI_LINE_WRAP_THRESHOLD characters AND it
// contains at least one top-level separator (`,`, `;`, or `|`) to split
// on. Nested spans are considered independently.
function computeMultiLineWraps(
  source: string,
  tokens: ReadableSyntaxToken[],
): Set<number> {
  const wraps = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'punc' || !['(', '[', '{'].includes(tok.value)) continue;
    const close = findMatchingBracket(tokens, i);
    if (close < 0) continue;
    const inline = renderTokenRange(source, tokens, i + 1, close);
    if (inline.length <= MULTI_LINE_WRAP_THRESHOLD) continue;
    if (!spanHasTopLevelSeparator(tokens, i + 1, close)) continue;
    wraps.add(i);
  }
  return wraps;
}

function findMatchingBracket(tokens: ReadableSyntaxToken[], openIndex: number): number {
  const open = tokens[openIndex].value;
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 1;
  for (let i = openIndex + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'punc') continue;
    if (tok.value === open) depth++;
    else if (tok.value === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function spanHasTopLevelSeparator(
  tokens: ReadableSyntaxToken[],
  start: number,
  end: number,
): boolean {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const tok = tokens[i];
    if (tok.type === 'punc' && ['(', '[', '{'].includes(tok.value)) {
      depth++;
      continue;
    }
    if (tok.type === 'punc' && [')', ']', '}'].includes(tok.value)) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (
      (tok.type === 'op' && (tok.value === ',' || tok.value === '|')) ||
      (tok.type === 'punc' && tok.value === ';')
    ) {
      return true;
    }
  }
  return false;
}

function renderTokenRange(
  source: string,
  tokens: ReadableSyntaxToken[],
  start: number,
  end: number,
): string {
  let output = '';
  let prev: ReadableSyntaxToken | undefined;
  let prevPrev: ReadableSyntaxToken | undefined;
  for (let i = start; i < end; i++) {
    const tok = tokens[i];
    if (prev && shouldInsertReadableSpace(prev, tok, prevPrev)) output += ' ';
    output += tokenRaw(source, tok);
    prevPrev = prev;
    prev = tok;
  }
  return output;
}

// Expand a BXL source to a multi-line, indented form. Safe-by-default:
// if tokenization fails the source is returned unchanged so the caller
// can still preview whatever the user typed.
export function expandBxlExpression(
  source: string,
  _options: BxlConversionOptions = {},
): BxlFormatResult {
  const stripped = source.replace(/\s+/g, ' ').trim();
  let tokens: ReadableSyntaxToken[];
  try {
    tokens = tokenizeReadableSyntax(stripped);
  } catch {
    return { source, changed: false, rewrites: [] };
  }

  const wraps = computeMultiLineWraps(stripped, tokens);
  // Wrap pipelines onto separate lines whenever their total length
  // exceeds the threshold.
  const topLevelPipes = findTopLevelOps(tokens, 0, tokens.length, '|');
  const wrapPipeline =
    topLevelPipes.length > 0 &&
    renderTokenRange(stripped, tokens, 0, tokens.length).length >
      MULTI_LINE_WRAP_THRESHOLD;

  let output = '';
  let indent = 0;
  const wrapStack: boolean[] = [];
  let prev: ReadableSyntaxToken | undefined;
  let prevPrev: ReadableSyntaxToken | undefined;

  const emitNewlineIndent = () => {
    output += '\n' + MULTI_LINE_INDENT.repeat(indent);
    prev = undefined;
    prevPrev = undefined;
  };

  const advance = (tok: ReadableSyntaxToken | undefined) => {
    prevPrev = prev;
    prev = tok;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // Top-level pipe: newline + indent, then the pipe itself. Let the
    // normal spacing rule insert the space between `|` and the next token.
    const isTopPipe =
      wrapPipeline &&
      tok.type === 'op' &&
      tok.value === '|' &&
      bracketDepthAt(tokens, i) === 0;
    if (isTopPipe) {
      emitNewlineIndent();
      output += '|';
      advance(tok);
      continue;
    }

    // Opening bracket: emit + maybe newline+indent.
    if (tok.type === 'punc' && ['(', '[', '{'].includes(tok.value)) {
      if (prev && shouldInsertReadableSpace(prev, tok, prevPrev)) output += ' ';
      output += tokenRaw(source, tok);
      const wrap = wraps.has(i);
      wrapStack.push(wrap);
      if (wrap) {
        indent++;
        emitNewlineIndent();
      } else {
        advance(tok);
      }
      continue;
    }

    // Closing bracket: maybe newline+indent before emitting.
    if (tok.type === 'punc' && [')', ']', '}'].includes(tok.value)) {
      const wrap = wrapStack.pop() ?? false;
      if (wrap) {
        indent--;
        emitNewlineIndent();
      }
      output += tokenRaw(source, tok);
      advance(tok);
      continue;
    }

    // Separator inside a wrapped group: emit + newline + indent.
    const inWrappedGroup = wrapStack[wrapStack.length - 1] === true;
    const isSeparator =
      (tok.type === 'op' && (tok.value === ',' || tok.value === ';')) ||
      (tok.type === 'punc' && tok.value === ';');
    if (inWrappedGroup && isSeparator) {
      output += tokenRaw(source, tok);
      emitNewlineIndent();
      continue;
    }

    // Default: canonical-spaced token emit.
    if (prev && shouldInsertReadableSpace(prev, tok, prevPrev)) output += ' ';
    output += tokenRaw(source, tok);
    advance(tok);
  }

  return {
    source: output,
    changed: output !== source,
    rewrites:
      output !== source
        ? [{ code: 'format-expanded', message: 'Expanded to multi-line.' }]
        : [],
  };
}

function bracketDepthAt(tokens: ReadableSyntaxToken[], index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    const tok = tokens[i];
    if (tok.type !== 'punc') continue;
    if (['(', '[', '{'].includes(tok.value)) depth++;
    else if ([')', ']', '}'].includes(tok.value)) depth--;
  }
  return depth;
}

function findTopLevelOps(
  tokens: ReadableSyntaxToken[],
  start: number,
  end: number,
  op: string,
): number[] {
  const indices: number[] = [];
  let depth = 0;
  for (let i = start; i < end; i++) {
    const tok = tokens[i];
    if (tok.type === 'punc' && ['(', '[', '{'].includes(tok.value)) {
      depth++;
      continue;
    }
    if (tok.type === 'punc' && [')', ']', '}'].includes(tok.value)) {
      depth--;
      continue;
    }
    if (depth === 0 && tok.type === 'op' && tok.value === op) indices.push(i);
  }
  return indices;
}
