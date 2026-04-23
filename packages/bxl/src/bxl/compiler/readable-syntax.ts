// Shared lexical sets live in lexicon.ts — single source of truth for jq
// keywords and BXL literals, also imported by linter.ts.
import { JQ_KEYWORDS as KEYWORDS, BXL_LITERALS as LITERALS } from './lexicon.js';

export type ReadableFieldKind = 'scalar' | 'object' | 'array';

export interface ReadableSchema {
  fields: ReadableField[];
}

export interface ReadableField {
  key: string;
  label?: string;
  displayName?: string;
  kind?: ReadableFieldKind;
  fields?: ReadableField[];
  item?: ReadableSchema;
}

export interface ReadableSyntaxOptions {
  schema?: ReadableSchema;
  mode?: 'schema-free' | 'schema-aware';
}

export interface ReadableSyntaxWarning {
  code: string;
  message: string;
}

export interface ReadableSyntaxCompileResult {
  source: string;
  changed: boolean;
  warnings: ReadableSyntaxWarning[];
}

export interface ReadableSyntaxToken {
  type: 'ident' | 'number' | 'string' | 'var' | 'format' | 'op' | 'punc';
  value: string;
  start?: number;
  end?: number;
  raw?: string;
}

type Token = ReadableSyntaxToken;

interface CompileChunk {
  source: string;
  changed: boolean;
  warnings: ReadableSyntaxWarning[];
  streamItemScope?: ReadableSchema;
  needsRootBinding?: boolean;
}

interface PathCompileResult extends CompileChunk {
  next: number;
  valueScope?: ReadableSchema;
  arrayItemScope?: ReadableSchema;
  openMaterialized?: boolean;
}

interface FieldResolution {
  field: ReadableField;
  valueScope?: ReadableSchema;
  arrayItemScope?: ReadableSchema;
}

export class ReadableSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadableSyntaxError';
  }
}


const FORMULA_FUNCTIONS = new Set([
  'ABS',
  'ACCRINT',
  'ACOS',
  'ACOSH',
  'ACOT',
  'ACOTH',
  'AND',
  'ARABIC',
  'ASIN',
  'ASINH',
  'ATAN',
  'ATAN2',
  'ATANH',
  'AVEDEV',
  'AVERAGE',
  'AVERAGEIF',
  'AVERAGEIFS_BY',
  'AVERAGEIF_BY',
  'BASE',
  'BIN2DEC',
  'BIN2HEX',
  'BIN2OCT',
  'BITAND',
  'BITLSHIFT',
  'BITOR',
  'BITRSHIFT',
  'BITXOR',
  'CEILING',
  'CEILING_MATH',
  'CHAR',
  'CHOOSE',
  'CLEAN',
  'CODE',
  'COL',
  'COLUMNS',
  'COMBIN',
  'COMBINA',
  'COMPLEX',
  'CONCAT',
  'CONCATENATE',
  'CONVERT',
  'CORREL',
  'COS',
  'COSH',
  'COT',
  'COTH',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'COUNTIF',
  'COUNTIFS_BY',
  'COUNTIF_BY',
  'COUPDAYS',
  'CSC',
  'CSCH',
  'CUMIPMT',
  'CUMPRINC',
  'DATE',
  'DATEDIF',
  'DATEVALUE',
  'DAY',
  'DAYS',
  'DAYS360',
  'DB',
  'DDB',
  'DEC2BIN',
  'DEC2HEX',
  'DEC2OCT',
  'DECIMAL',
  'DEGREES',
  'DELTA',
  'DEVSQ',
  'DISC',
  'DOLLAR',
  'DOLLARDE',
  'DOLLARFR',
  'EDATE',
  'EFFECT',
  'EOMONTH',
  'ERF',
  'ERFC',
  'EVEN',
  'EXACT',
  'EXP',
  'FACT',
  'FACTDOUBLE',
  'FALSE',
  'FIND',
  'FIXED',
  'FLOOR',
  'FLOOR_MATH',
  'FORECAST',
  'FV',
  'FVSCHEDULE',
  'GCD',
  'GEOMEAN',
  'GESTEP',
  'HARMEAN',
  'HEX2BIN',
  'HEX2DEC',
  'HEX2OCT',
  'HLOOKUP',
  'HOUR',
  'IF',
  'IFERROR',
  'IFNA',
  'IFS',
  'IMABS',
  'IMAGINARY',
  'IMARGUMENT',
  'IMCONJUGATE',
  'IMCOS',
  'IMCOSH',
  'IMCOT',
  'IMCSC',
  'IMCSCH',
  'IMDIV',
  'IMEXP',
  'IMLN',
  'IMLOG10',
  'IMLOG2',
  'IMPOWER',
  'IMPRODUCT',
  'IMREAL',
  'IMSEC',
  'IMSECH',
  'IMSIN',
  'IMSINH',
  'IMSQRT',
  'IMSUB',
  'IMSUM',
  'IMTAN',
  'INDEX',
  'INT',
  'INTERCEPT',
  'IPMT',
  'IRR',
  'IRR_BY',
  'ISBLANK',
  'ISERR',
  'ISERROR',
  'ISEVEN',
  'ISLOGICAL',
  'ISNA',
  'ISNONTEXT',
  'ISNUMBER',
  'ISODD',
  'ISOWEEKNUM',
  'ISPMT',
  'ISTEXT',
  'KURT',
  'LARGE',
  'LCM',
  'LEFT',
  'LEN',
  'LN',
  'LOG',
  'LOG10',
  'LOOKUP',
  'LOOKUP_BY',
  'LOWER',
  'MATCH',
  'MAX',
  'MAXIFS',
  'MEDIAN',
  'MID',
  'MIN',
  'MINIFS',
  'MINUTE',
  'MIRR',
  'MOD',
  'MONTH',
  'MROUND',
  'MULTINOMIAL',
  'N',
  'NETWORKDAYS',
  'NETWORKDAYS_INTL',
  'NOMINAL',
  'NOT',
  'NOW',
  'NPER',
  'NPV',
  'NPV_BY',
  'NUMBERVALUE',
  'OCT2BIN',
  'OCT2DEC',
  'OCT2HEX',
  'ODD',
  'OR',
  'PDURATION',
  'PEARSON',
  'PERCENTILE_EXC',
  'PERCENTILE_INC',
  'PERCENTRANK_EXC',
  'PERCENTRANK_INC',
  'PERMUT',
  'PI',
  'PMT',
  'POWER',
  'PPMT',
  'PRICEDISC',
  'PRODUCT',
  'PROPER',
  'PV',
  'QUARTILE_EXC',
  'QUARTILE_INC',
  'QUOTIENT',
  'RADIANS',
  'RAND',
  'RANDBETWEEN',
  'RANK_AVG',
  'RANK_EQ',
  'RATE',
  'REPLACE',
  'REPT',
  'RIGHT',
  'ROMAN',
  'ROUND',
  'ROUNDDOWN',
  'ROUNDUP',
  'ROWS',
  'RRI',
  'SEARCH',
  'SEC',
  'SECH',
  'SECOND',
  'SERIESSUM',
  'SIGN',
  'SIN',
  'SINH',
  'SKEW',
  'SLN',
  'SLOPE',
  'SMALL',
  'SQRT',
  'SQRTPI',
  'STDEV',
  'STDEV_P',
  'STDEV_S',
  'SUBSTITUTE',
  'SUM',
  'SUMIF',
  'SUMIFS_BY',
  'SUMIF_BY',
  'SUMPRODUCT',
  'SUMSQ',
  'SUMX2MY2',
  'SUMX2PY2',
  'SUMXMY2',
  'SWITCH',
  'SYD',
  'T',
  'TAN',
  'TANH',
  'TBILLEQ',
  'TBILLPRICE',
  'TBILLYIELD',
  'TEXT',
  'TEXTJOIN',
  'TIME',
  'TIMEVALUE',
  'TODAY',
  'TRIM',
  'TRIMMEAN',
  'TRUE',
  'TRUNC',
  'TYPE',
  'UNICHAR',
  'UNICODE',
  'UPPER',
  'VALUE',
  'VAR',
  'VAR_P',
  'VAR_S',
  'VLOOKUP',
  'VLOOKUP_BY',
  'WEEKDAY',
  'WEEKNUM',
  'WORKDAY',
  'WORKDAY_INTL',
  'XIRR',
  'XIRR_BY',
  'XNPV',
  'XNPV_BY',
  'XOR',
  'YEAR',
  'YEARFRAC',
]);

export const BXL_FORMULA_FUNCTIONS = FORMULA_FUNCTIONS;

const LOWERCASE_BXL_HELPERS = new Set([
  'implies',
  'nonempty',
  'present',
  'when',
  'words',
]);

export const BXL_COMMA_ARGUMENT_HELPERS = LOWERCASE_BXL_HELPERS;

const ARRAY_PACKED_VARIADIC_FORMULAS = new Set([
  'AND',
  'AVERAGE',
  'CONCAT',
  'CONCATENATE',
  'COUNT',
  'COUNTA',
  'MAX',
  'MEDIAN',
  'MIN',
  'OR',
  'PRODUCT',
  'STDEV',
  'STDEV_P',
  'STDEV_S',
  'SUM',
  'SUMPRODUCT',
  'SUMSQ',
  'SWITCH',
  'VAR',
  'VAR_P',
  'VAR_S',
  'XOR',
]);

const TRAILING_ARRAY_PACKED_VARIADIC_FORMULAS = new Map<string, number>([
  ['CHOOSE', 1],
  ['TEXTJOIN', 2],
]);

const CASE_INSENSITIVE_JQ_FUNCTIONS = new Set([
  'add',
  'all',
  'any',
  'contains',
  'endswith',
  'first',
  'flatten',
  'from_entries',
  'fromjson',
  'group_by',
  'has',
  'implies',
  'keys',
  'last',
  'length',
  'map',
  'map_values',
  'max',
  'min',
  'nonempty',
  'present',
  'reverse',
  'select',
  'sort',
  'sort_by',
  'split',
  'startswith',
  'to_entries',
  'tojson',
  'tonumber',
  'tostring',
  'type',
  'unique',
  'unique_by',
  'when',
  'with_entries',
  'words',
]);

const PATH_RESERVED = new Set([
  'all',
  'item',
  'last',
  'position',
  'row',
]);

const POSITIONAL_SELECTOR_KEYWORDS = new Set([
  'first',
  'last',
  'only',
  'odd',
  'even',
]);

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function identLower(token: Token | undefined): string | undefined {
  return token?.type === 'ident' ? token.value.toLowerCase() : undefined;
}

function isIdent(token: Token | undefined, value: string): boolean {
  return identLower(token) === value.toLowerCase();
}

function canonicalFunctionName(name: string): string {
  const upper = name.toUpperCase();
  if (FORMULA_FUNCTIONS.has(upper)) {
    return upper;
  }

  const lower = name.toLowerCase();
  if (CASE_INSENSITIVE_JQ_FUNCTIONS.has(lower)) {
    return lower;
  }

  return name;
}

function isCommaArgumentFunction(name: string): boolean {
  return (
    FORMULA_FUNCTIONS.has(name.toUpperCase()) ||
    LOWERCASE_BXL_HELPERS.has(name.toLowerCase()) ||
    ['all', 'any'].includes(name.toLowerCase())
  );
}

function formatFunctionCallSource(name: string, args: CompileChunk[]): string {
  const upper = name.toUpperCase();
  if (ARRAY_PACKED_VARIADIC_FORMULAS.has(upper) && args.length > 1) {
    return `${name}([${args.map((arg) => arg.source).join(', ')}])`;
  }

  const trailingArrayPrefix = TRAILING_ARRAY_PACKED_VARIADIC_FORMULAS.get(upper);
  if (trailingArrayPrefix !== undefined && args.length > trailingArrayPrefix + 1) {
    const leading = args
      .slice(0, trailingArrayPrefix)
      .map((arg) => arg.source);
    const trailing = `[${args
      .slice(trailingArrayPrefix)
      .map((arg) => arg.source)
      .join(', ')}]`;
    return `${name}(${[...leading, trailing].join('; ')})`;
  }

  return `${name}(${args.map((arg) => arg.source).join('; ')})`;
}

function canonicalTokenSource(token: Token): string {
  if (token.type === 'ident') {
    const lower = token.value.toLowerCase();
    if (KEYWORDS.has(lower) || LITERALS.has(lower)) {
      return lower;
    }
  }

  return tokenSource(token);
}

function childScope(field: ReadableField): ReadableSchema | undefined {
  if (field.kind === 'array') {
    return field.item;
  }
  if (field.item) {
    return field.item;
  }
  if (field.fields) {
    return { fields: field.fields };
  }
  return undefined;
}

function itemScope(field: ReadableField): ReadableSchema | undefined {
  if (field.kind === 'array' || field.item) {
    return field.item ?? (field.fields ? { fields: field.fields } : undefined);
  }
  return undefined;
}

function resolveField(
  scope: ReadableSchema | undefined,
  label: string,
): FieldResolution | undefined {
  if (!scope) {
    return undefined;
  }

  const normalized = normalizeLabel(label);
  const candidates = scope.fields.filter((field) => {
    const labels = [
      field.displayName,
      field.label,
      field.key,
    ].filter((entry): entry is string => Boolean(entry));

    return labels.some(
      (entry) => entry === label || normalizeLabel(entry) === normalized,
    );
  });

  if (candidates.length > 1) {
    throw new ReadableSyntaxError(
      `Ambiguous readable label '${label}' in schema scope`,
    );
  }

  const field = candidates[0];
  if (!field) {
    return undefined;
  }

  return {
    field,
    valueScope: childScope(field),
    arrayItemScope: itemScope(field),
  };
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function previousNonWhitespaceChar(source: string, index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const value = source[cursor];
    if (!/\s/.test(value)) {
      return value;
    }
  }
  return undefined;
}

function previousNonWhitespaceChars(source: string, index: number, count: number): string {
  const values: string[] = [];
  for (let cursor = index - 1; cursor >= 0 && values.length < count; cursor--) {
    const value = source[cursor];
    if (!/\s/.test(value)) {
      values.unshift(value);
    }
  }
  return values.join('');
}

function startsHashSelector(source: string, index: number): boolean {
  const previous = previousNonWhitespaceChar(source, index);
  const previousTwo = previousNonWhitespaceChars(source, index, 2);
  if (previous !== '[' && previousTwo !== '..') {
    return false;
  }

  const next = source[index + 1] ?? '';
  if (/[0-9]/.test(next)) {
    return true;
  }

  if (next === '-' && /[0-9]/.test(source[index + 2] ?? '')) {
    return true;
  }

  if (!isIdentifierStart(next)) {
    return false;
  }

  let cursor = index + 1;
  let word = '';
  while (cursor < source.length && isIdentifierChar(source[cursor])) {
    word += source[cursor++];
  }

  return POSITIONAL_SELECTOR_KEYWORDS.has(word.toLowerCase());
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === '#' && !startsHashSelector(source, index) && !/[0-9]/.test(source[index + 1] ?? '')) {
      while (index < source.length && source[index] !== '\n') {
        index++;
      }
      continue;
    }

    if (char === '"') {
      let value = '';
      const start = index;
      index++;
      while (index < source.length) {
        const current = source[index++];
        if (current === '\\') {
          const next = source[index++];
          if (next === undefined) {
            throw new ReadableSyntaxError('Unterminated string escape');
          }
          value += `\\${next}`;
        } else if (current === '"') {
          break;
        } else {
          value += current;
        }
      }
      // jq string interpolation `"\(...)"` is not a JSON escape, so the
      // naive JSON.parse pass below would choke. When we detect any
      // non-JSON escape sequence, preserve the raw decoded form without
      // JSON parsing. The string's semantic content matters only for
      // literal comparison; compilation is downstream and the raw source
      // is faithfully preserved in `raw`.
      let decoded: string;
      try {
        decoded = JSON.parse(`"${value}"`);
      } catch {
        // Fall back: strip only the simple escapes JSON does support.
        decoded = value
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
      tokens.push({
        type: 'string',
        value: decoded,
        start,
        end: index,
        raw: source.slice(start, index),
      });
      continue;
    }

    if (/[0-9]/.test(char)) {
      let value = char;
      let hasDecimal = false;
      const start = index;
      index++;
      while (index < source.length) {
        const current = source[index];
        if (/[0-9]/.test(current)) {
          value += source[index++];
          continue;
        }
        if (current === '.' && !hasDecimal && source[index + 1] !== '.') {
          hasDecimal = true;
          value += source[index++];
          continue;
        }
        break;
      }
      tokens.push({ type: 'number', value, start, end: index, raw: value });
      continue;
    }

    if (char === '$' && isIdentifierStart(source[index + 1] ?? '')) {
      let value = '$';
      const start = index;
      index++;
      while (index < source.length && isIdentifierChar(source[index])) {
        value += source[index++];
      }
      tokens.push({ type: 'var', value, start, end: index, raw: value });
      continue;
    }

    if (char === '@' && isIdentifierStart(source[index + 1] ?? '')) {
      let value = '@';
      const start = index;
      index++;
      while (index < source.length && isIdentifierChar(source[index])) {
        value += source[index++];
      }
      tokens.push({ type: 'format', value, start, end: index, raw: value });
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = char;
      const start = index;
      index++;
      while (index < source.length && isIdentifierChar(source[index])) {
        value += source[index++];
      }
      tokens.push({ type: 'ident', value, start, end: index, raw: value });
      continue;
    }

    const three = source.slice(index, index + 3);
    const two = source.slice(index, index + 2);
    if (['?//', '//=', '...'].includes(three)) {
      tokens.push({
        type: 'op',
        value: three,
        start: index,
        end: index + 3,
        raw: three,
      });
      index += 3;
      continue;
    }
    // Excel's `<>` inequality — normalize to canonical `!=`, keep the raw
    // source for linter/workbench so we can surface a rewrite hint.
    if (two === '<>') {
      tokens.push({
        type: 'op',
        value: '!=',
        start: index,
        end: index + 2,
        raw: '<>',
      });
      index += 2;
      continue;
    }

    if (
      [
        '==',
        '!=',
        '<=',
        '>=',
        '+=',
        '-=',
        '*=',
        '/=',
        '%=',
        '//',
        '|=',
        '?//',
        '..',
        '?.',
        '^=',
        '$=',
      ].includes(two)
    ) {
      tokens.push({
        type: 'op',
        value: two,
        start: index,
        end: index + 2,
        raw: two,
      });
      index += 2;
      continue;
    }

    if ('()[]{}:;\\'.includes(char)) {
      tokens.push({
        type: 'punc',
        value: char,
        start: index,
        end: index + 1,
        raw: char,
      });
      index++;
      continue;
    }

    if ('.=!|+-*/%?<>,#^&'.includes(char)) {
      tokens.push({
        type: 'op',
        value: char,
        start: index,
        end: index + 1,
        raw: char,
      });
      index++;
      continue;
    }

    throw new ReadableSyntaxError(
      `Cannot tokenize character '${char}' at position ${index}`,
    );
  }

  return tokens;
}

export function tokenizeReadableSyntax(source: string): ReadableSyntaxToken[] {
  return tokenize(source);
}

function tokenSource(token: Token): string {
  if (token.type === 'string') {
    // Preserve the original source form for strings that contain jq
    // interpolation (`\(...)`) — JSON.stringify would double-escape the
    // backslash and jq would no longer recognize the interpolation.
    // The `raw` field captures the literal source slice.
    if (token.raw && token.raw.includes('\\(')) {
      return token.raw;
    }
    return JSON.stringify(token.value);
  }
  return token.value;
}

function isWordLike(source: string): boolean {
  return /^[A-Za-z_$@][A-Za-z0-9_$@]*$/.test(source);
}

function endsWithWordBoundary(source: string): boolean {
  return /[A-Za-z0-9_$@\])]$/.test(source);
}

function startsWithWordBoundary(source: string): boolean {
  // Include digits and `"` (string literals) so `then 1`, `else "x"`, and
  // `end 2` stay spaced apart from the preceding keyword when emitted by
  // `appendPart`. Without digits here, `if true then 1 else 2 end`
  // compiled as `if true then1 else2 end` and jq's parser choked.
  return /^[A-Za-z_$@.0-9"]/.test(source);
}

function appendPart(parts: string[], source: string) {
  if (!source) {
    return;
  }
  const previous = parts[parts.length - 1];
  // Always separate a jq control keyword (`if`, `then`, `else`, `elif`,
  // `end`, `as`, `reduce`, `foreach`, `try`, `catch`, `and`, `or`, `not`,
  // etc.) from the next token. Without this, `then [1]` / `then {x:1}`
  // collapsed to `then[1]` / `then{x:1}` and jq's parser treated them
  // as path expressions rather than the intended array/object literal
  // that follows the keyword.
  if (
    previous &&
    KEYWORDS.has(previous) &&
    source &&
    !/^[\s)\]},;]/.test(source)
  ) {
    parts.push(' ');
  }
  // Space after jq separators `;` / `,` so compiled output reads nicely
  // (`DATE(2025; 1; 1)` rather than `DATE(2025;1;1)`).
  if (
    previous &&
    (previous.endsWith(';') || previous.endsWith(',')) &&
    !source.startsWith(' ')
  ) {
    parts.push(' ');
  }
  if (
    previous &&
    (isWordLike(previous) || KEYWORDS.has(previous) || endsWithWordBoundary(previous)) &&
    (isWordLike(source) || KEYWORDS.has(source) || startsWithWordBoundary(source))
  ) {
    parts.push(' ');
  }
  parts.push(source);
}

function joinParts(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    appendPart(out, part);
  }
  return out.join('');
}

type SelectorRangeEndpoint =
  | {
      family: 'front';
      display: string;
      oneBased: number;
    }
  | {
      family: 'back';
      display: string;
      offsetFromLast: number;
    };

type SelectorUnionTerm =
  | {
      kind: 'single';
      display: string;
      indexExpr: string;
    }
  | {
      kind: 'range';
      display: string;
      startExpr: string;
      endExpr: string;
    };

function hasUnclosedMaterializedArray(source: string): boolean {
  const opens = [...source].filter((char) => char === '[').length;
  const closes = [...source].filter((char) => char === ']').length;
  return opens > closes;
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
      throw new ReadableSyntaxError(`Unexpected opener '${open}'`);
  }
}

function findMatching(tokens: Token[], start: number): number {
  const open = tokens[start];
  if (!open || open.type !== 'punc') {
    throw new ReadableSyntaxError('Expected opening punctuation');
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
  throw new ReadableSyntaxError(`Unclosed '${open.value}'`);
}

function splitTopLevel(
  tokens: Token[],
  start: number,
  end: number,
  separator: string,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let rangeStart = start;

  for (let i = start; i < end; i++) {
    const token = tokens[i];
    if (token.type === 'punc' && ['(', '[', '{'].includes(token.value)) {
      depth++;
    } else if (token.type === 'punc' && [')', ']', '}'].includes(token.value)) {
      depth--;
    } else if (
      depth === 0 &&
      // Match the separator by value + structural type only. Never treat a
      // string or number literal whose content happens to equal the
      // separator (e.g. the string `","` inside `NUMBERVALUE(..., ",")`) as
      // a separator.
      (((token.type === 'punc' || token.type === 'op') &&
        token.value === separator) ||
        (token.type === 'ident' &&
          token.value.toLowerCase() === separator.toLowerCase()))
    ) {
      ranges.push([rangeStart, i]);
      rangeStart = i + 1;
    }
  }

  ranges.push([rangeStart, end]);
  return ranges;
}

function parseSelectorRangeEndpoint(
  tokens: Token[],
  options: { allowBareNumber?: boolean } = {},
): SelectorRangeEndpoint | undefined {
  if (options.allowBareNumber && tokens.length === 1 && tokens[0].type === 'number') {
    const oneBased = Number(tokens[0].value);
    if (!Number.isInteger(oneBased) || oneBased < 1) {
      throw new ReadableSyntaxError(
        `[${tokens[0].value}] must be a positive 1-based row number`,
      );
    }
    return {
      family: 'front',
      display: `#${tokens[0].value}`,
      oneBased,
    };
  }

  if (tokens.length === 2 && tokens[0].value === '#' && tokens[1].type === 'number') {
    const oneBased = Number(tokens[1].value);
    if (!Number.isInteger(oneBased) || oneBased < 1) {
      throw new ReadableSyntaxError(
        `[#${tokens[1].value}] must be a positive 1-based row number`,
      );
    }
    return {
      family: 'front',
      display: `#${tokens[1].value}`,
      oneBased,
    };
  }

  if (tokens.length === 2 && tokens[0].value === '#' && tokens[1].type === 'ident') {
    const keyword = tokens[1].value.toLowerCase();
    if (keyword === 'first') {
      return {
        family: 'front',
        display: '#first',
        oneBased: 1,
      };
    }
    if (keyword === 'last') {
      return {
        family: 'back',
        display: '#last',
        offsetFromLast: 0,
      };
    }
    return undefined;
  }

  if (
    tokens.length === 4 &&
    tokens[0].value === '#' &&
    tokens[1].type === 'ident' &&
    tokens[1].value.toLowerCase() === 'last' &&
    tokens[2].type === 'op' &&
    tokens[2].value === '-' &&
    tokens[3].type === 'number'
  ) {
    const offset = Number(tokens[3].value);
    if (!Number.isInteger(offset) || offset < 1) {
      throw new ReadableSyntaxError(
        `[#last-${tokens[3].value}] must subtract a positive whole number`,
      );
    }
    return {
      family: 'back',
      display: `#last-${tokens[3].value}`,
      offsetFromLast: offset,
    };
  }

  return undefined;
}

function selectorRangeIsIncreasing(
  start: SelectorRangeEndpoint,
  end: SelectorRangeEndpoint,
): boolean {
  if (start.family === 'front' && end.family === 'front') {
    return start.oneBased <= end.oneBased;
  }
  if (start.family === 'front' && end.family === 'back') {
    return true;
  }
  if (start.family === 'back' && end.family === 'back') {
    return start.offsetFromLast >= end.offsetFromLast;
  }
  return false;
}

function selectorEndpointIndexExpr(endpoint: SelectorRangeEndpoint, lengthExpr: string): string {
  if (endpoint.family === 'front') {
    return `${endpoint.oneBased - 1}`;
  }
  return endpoint.offsetFromLast === 0
    ? `(${lengthExpr} - 1)`
    : `(${lengthExpr} - ${endpoint.offsetFromLast + 1})`;
}

function selectorRangeStartExpr(endpoint: SelectorRangeEndpoint, lengthExpr: string): string {
  return selectorEndpointIndexExpr(endpoint, lengthExpr);
}

function selectorRangeEndExpr(endpoint: SelectorRangeEndpoint, lengthExpr: string): string {
  if (endpoint.family === 'front') {
    return `${endpoint.oneBased}`;
  }
  return endpoint.offsetFromLast === 0
    ? `${lengthExpr}`
    : `(${lengthExpr} - ${endpoint.offsetFromLast})`;
}

function parseSelectorUnionTerm(tokens: Token[]): SelectorUnionTerm | undefined {
  const rangeParts = splitTopLevel(tokens, 0, tokens.length, '..');
  if (rangeParts.length === 1) {
    const endpoint = parseSelectorRangeEndpoint(tokens);
    if (!endpoint) {
      return undefined;
    }
    return {
      kind: 'single',
      display: endpoint.display,
      indexExpr: selectorEndpointIndexExpr(endpoint, '$__len'),
    };
  }
  if (rangeParts.length === 2) {
    const startEndpoint = parseSelectorRangeEndpoint(tokens.slice(...rangeParts[0]));
    const endEndpoint = parseSelectorRangeEndpoint(tokens.slice(...rangeParts[1]), {
      allowBareNumber: true,
    });
    if (!startEndpoint || !endEndpoint) {
      return undefined;
    }
    if (!selectorRangeIsIncreasing(startEndpoint, endEndpoint)) {
      throw new ReadableSyntaxError(
        `[${startEndpoint.display}..${endEndpoint.display}] range must move forward in collection order`,
      );
    }
    return {
      kind: 'range',
      display: `${startEndpoint.display}..${endEndpoint.display}`,
      startExpr: selectorRangeStartExpr(startEndpoint, '$__len'),
      endExpr: selectorRangeEndExpr(endEndpoint, '$__len'),
    };
  }
  return undefined;
}

function selectorUnionCondition(terms: SelectorUnionTerm[]): string {
  return terms
    .map((term) =>
      term.kind === 'single'
        ? `$__idx == ${term.indexExpr}`
        : `($__idx >= ${term.startExpr} and $__idx < ${term.endExpr})`,
    )
    .join(' or ');
}

function isSimpleHumanIndex(tokens: Token[]): boolean {
  return (
    tokens.length >= 2 &&
    ['row', 'item'].includes(identLower(tokens[0]) ?? '') &&
    tokens[1].type === 'number'
  );
}

function indexTextFromHumanIndex(tokens: Token[]): string | undefined {
  if (!isSimpleHumanIndex(tokens)) {
    return undefined;
  }
  const start = Number(tokens[1].value);
  if (!Number.isInteger(start) || start < 1) {
    throw new ReadableSyntaxError('Human row/item indices are 1-based');
  }

  if (tokens.length === 2) {
    return String(start - 1);
  }

  if (tokens.length === 4 && tokens[2].type === 'op' && tokens[2].value === '..') {
    const end = Number(tokens[3].value);
    if (!Number.isInteger(end) || end < start) {
      throw new ReadableSyntaxError('Human row/item range must be increasing');
    }
    return `${start - 1}:${end}`;
  }

  return undefined;
}

function isLastCall(tokens: Token[]): boolean {
  return (
    tokens.length >= 3 &&
    isIdent(tokens[0], 'last') &&
    tokens[1].value === '(' &&
    tokens[2].value === ')'
  );
}

function isPredicateLike(tokens: Token[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  if (
    tokens[0].type === 'ident' &&
    PATH_RESERVED.has(tokens[0].value.toLowerCase()) &&
    tokens[0].value.toLowerCase() !== 'not'
  ) {
    return false;
  }
  return tokens.some(
    (token) =>
      token.type === 'ident' ||
      ['=', '==', '!=', '<', '<=', '>', '>=', '^=', '$=', '*='].includes(
        token.value,
      ) ||
      ['STARTSWITH', 'ENDSWITH', 'CONTAINS', 'IN'].includes(
        token.value.toUpperCase(),
      ),
  );
}

function compileValue(tokens: Token[], scope: ReadableSchema | undefined): CompileChunk {
  const compiler = new Compiler(tokens, { schema: scope });
  return compiler.compile(scope);
}

function compilePredicate(
  tokens: Token[],
  itemScope: ReadableSchema | undefined,
): CompileChunk {
  const rangesOr = splitTopLevel(tokens, 0, tokens.length, 'or');
  if (rangesOr.length > 1) {
    const parts = rangesOr.map(([start, end]) =>
      compilePredicate(tokens.slice(start, end), itemScope),
    );
    return {
      source: parts.map((part) => `(${part.source})`).join(' or '),
      changed: parts.some((part) => part.changed),
      warnings: parts.flatMap((part) => part.warnings),
    };
  }

  const rangesAnd = splitTopLevel(tokens, 0, tokens.length, 'and');
  if (rangesAnd.length > 1) {
    const parts = rangesAnd.map(([start, end]) =>
      compilePredicate(tokens.slice(start, end), itemScope),
    );
    return {
      source: parts.map((part) => `(${part.source})`).join(' and '),
      changed: parts.some((part) => part.changed),
      warnings: parts.flatMap((part) => part.warnings),
    };
  }

  if (isIdent(tokens[0], 'not')) {
    const inner = compilePredicate(tokens.slice(1), itemScope);
    return {
      source: `(${inner.source}) | not`,
      changed: true,
      warnings: inner.warnings,
    };
  }

  if (tokens[0]?.value === '(' && tokens[tokens.length - 1]?.value === ')') {
    const inner = compilePredicate(tokens.slice(1, -1), itemScope);
    return {
      source: `(${inner.source})`,
      changed: inner.changed,
      warnings: inner.warnings,
    };
  }

  const opIndex = tokens.findIndex((token) =>
    ['=', '==', '!=', '<', '<=', '>', '>=', '^=', '$=', '*='].includes(
      token.value,
    ) ||
    ['STARTSWITH', 'ENDSWITH', 'CONTAINS', 'IN'].includes(
      token.value.toUpperCase(),
    ),
  );

  if (opIndex === -1) {
    // Bare-value predicate — use jq's truthy semantics via bare
    // `select(<value>)`. Matches Excel's `[Taxable]` convention where a
    // literal `true` keeps the row and `false` / `null` / missing filter
    // it out.
    const presence = compileValue(tokens, itemScope);
    return {
      source: presence.source,
      changed: true,
      warnings: presence.warnings,
    };
  }

  const left = compileValue(tokens.slice(0, opIndex), itemScope);
  const op = ['STARTSWITH', 'ENDSWITH', 'CONTAINS', 'IN'].includes(
    tokens[opIndex].value.toUpperCase(),
  )
    ? tokens[opIndex].value.toUpperCase()
    : tokens[opIndex].value;
  const right = compileValue(tokens.slice(opIndex + 1), itemScope);
  const warnings = [...left.warnings, ...right.warnings];

  switch (op) {
    case '=':
      return {
        source: `${left.source} == ${right.source}`,
        changed: true,
        warnings,
      };
    case '==':
    case '!=':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return {
        source: `${left.source} ${op} ${right.source}`,
        changed: left.changed || right.changed,
        warnings,
      };
    case '^=':
    case 'STARTSWITH':
      return {
        source: `(${left.source} | startswith(${right.source}))`,
        changed: true,
        warnings,
      };
    case '$=':
    case 'ENDSWITH':
      return {
        source: `(${left.source} | endswith(${right.source}))`,
        changed: true,
        warnings,
      };
    case '*=':
    case 'CONTAINS':
      return {
        source: `(${left.source} | contains(${right.source}))`,
        changed: true,
        warnings,
      };
    case 'IN':
      return {
        source: `(${left.source} | IN(${right.source}))`,
        changed: true,
        warnings: [
          ...warnings,
          {
            code: 'in-predicate-needs-helper',
            message:
              'Readable IN predicates compile to IN(value); add a native helper before using this in production.',
          },
        ],
      };
    default:
      throw new ReadableSyntaxError(`Unsupported predicate operator '${op}'`);
  }
}

class Compiler {
  private index = 0;
  private readonly end: number;
  private readonly schema?: ReadableSchema;

  constructor(
    private readonly tokens: Token[],
    options: {
      schema?: ReadableSchema;
      rootPathPrefix?: string;
      itemScope?: ReadableSchema;
    },
    start = 0,
    end = tokens.length,
  ) {
    this.index = start;
    this.end = end;
    this.schema = options.schema;
    this.rootPathPrefix = options.rootPathPrefix;
    this.constructorItemScope = options.itemScope;
  }

  private readonly rootPathPrefix?: string;
  // The `.` scope at the start of this Compiler. Distinct from `scope`
  // (which is the root for bare-ident lookup). Gets mutated during a
  // pipeline: after `|`, `.` points at the prior stream's element scope.
  private readonly constructorItemScope?: ReadableSchema;

  compile(scope = this.schema): CompileChunk {
    const parts: string[] = [];
    const warnings: ReadableSyntaxWarning[] = [];
    let changed = false;
    let streamItemScope: ReadableSchema | undefined;
    let needsRootBinding = false;
    let readableRootPrefix = this.rootPathPrefix;
    // Current `.` scope. Before a pipe it equals `scope` (the root). After
    // a pipe, it is the stream-item scope of the last expression, so that
    // `.field` inside the RHS resolves against the per-element shape.
    let itemScope: ReadableSchema | undefined = this.constructorItemScope ?? scope;

    while (this.index < this.end) {
      const token = this.tokens[this.index];

      if (token.type === 'op' && token.value === '|') {
        appendPart(parts, '|');
        this.index++;
        if (this.schema) {
          readableRootPrefix = '$root';
        }
        if (streamItemScope) {
          itemScope = streamItemScope;
          streamItemScope = undefined;
        }
        continue;
      }

      if (isIdent(token, 'not')) {
        const nextTok = this.tokens[this.index + 1];
        // NOT (expr)  → recurse into the parenthesized group
        if (nextTok?.type === 'punc' && nextTok.value === '(') {
          const open = this.index + 1;
          const close = findMatching(this.tokens, open);
          const inner = new Compiler(
            this.tokens,
            { schema: this.schema, rootPathPrefix: readableRootPrefix, itemScope },
            open + 1,
            close,
          ).compile(scope);
          appendPart(parts, `((${inner.source}) | not)`);
          warnings.push(...inner.warnings);
          needsRootBinding = needsRootBinding || Boolean(inner.needsRootBinding);
          changed = true;
          this.index = close + 1;
          continue;
        }
        // NOT FUNC(args)  → compile the function call, then pipe to not.
        // jq has no prefix `not`; it's a filter, used as `expr | not`.
        if (
          nextTok?.type === 'ident' &&
          this.tokens[this.index + 2]?.type === 'punc' &&
          this.tokens[this.index + 2]?.value === '('
        ) {
          this.index++; // consume `not`
          const fn = this.compileFunctionCall(scope, readableRootPrefix, itemScope);
          appendPart(parts, `((${fn.source}) | not)`);
          warnings.push(...fn.warnings);
          needsRootBinding = needsRootBinding || Boolean(fn.needsRootBinding);
          streamItemScope = fn.streamItemScope ?? streamItemScope;
          changed = true;
          continue;
        }
        // NOT <path>  → compile the path, then pipe to not.
        if (nextTok?.type === 'ident' || nextTok?.value === '.') {
          this.index++; // consume `not`
          const path = this.tryCompilePath(scope, readableRootPrefix, itemScope);
          if (path) {
            appendPart(parts, `((${path.source}) | not)`);
            warnings.push(...path.warnings);
            needsRootBinding = needsRootBinding || Boolean(path.needsRootBinding);
            streamItemScope = path.streamItemScope ?? streamItemScope;
            changed = true;
            continue;
          }
          // Not a path either — back up and let the token fall through.
          this.index--;
        }
      }

      if (
        token.type === 'ident' &&
        this.tokens[this.index + 1]?.type === 'punc' &&
        this.tokens[this.index + 1]?.value === '(' &&
        !(
          ['and', 'or'].includes(token.value.toLowerCase()) &&
          parts.length > 0
        ) &&
        !resolveField(scope, token.value) &&
        !resolveField(itemScope, token.value)
      ) {
        const fn = this.compileFunctionCall(scope, readableRootPrefix, itemScope);
        appendPart(parts, fn.source);
        warnings.push(...fn.warnings);
        changed = changed || fn.changed;
        needsRootBinding = needsRootBinding || Boolean(fn.needsRootBinding);
        streamItemScope = fn.streamItemScope ?? streamItemScope;
        continue;
      }

      const path = this.tryCompilePath(scope, readableRootPrefix, itemScope);
      if (path) {
        appendPart(parts, path.source);
        warnings.push(...path.warnings);
        changed = changed || path.changed;
        needsRootBinding = needsRootBinding || Boolean(path.needsRootBinding);
        streamItemScope = path.streamItemScope ?? streamItemScope;
        continue;
      }

      if (token.type === 'punc' && token.value === '(') {
        const close = findMatching(this.tokens, this.index);
        const inner = new Compiler(
          this.tokens,
          { schema: this.schema, rootPathPrefix: readableRootPrefix, itemScope },
          this.index + 1,
          close,
        ).compile(scope);
        appendPart(parts, `(${inner.source})`);
        warnings.push(...inner.warnings);
        changed = changed || inner.changed;
        needsRootBinding = needsRootBinding || Boolean(inner.needsRootBinding);
        this.index = close + 1;
        continue;
      }

      if (token.type === 'punc' && token.value === '[') {
        const close = findMatching(this.tokens, this.index);
        const inner = new Compiler(
          this.tokens,
          { schema: this.schema, rootPathPrefix: readableRootPrefix, itemScope },
          this.index + 1,
          close,
        ).compile(scope);
        appendPart(parts, `[${inner.source}]`);
        warnings.push(...inner.warnings);
        changed = changed || inner.changed;
        needsRootBinding = needsRootBinding || Boolean(inner.needsRootBinding);
        this.index = close + 1;
        continue;
      }

      if (token.type === 'punc' && token.value === '{') {
        const object = this.compileObject(scope, readableRootPrefix, itemScope);
        appendPart(parts, object.source);
        warnings.push(...object.warnings);
        changed = changed || object.changed;
        needsRootBinding = needsRootBinding || Boolean(object.needsRootBinding);
        continue;
      }

      appendPart(parts, canonicalTokenSource(token));
      this.index++;
    }

    return {
      source: joinParts(parts),
      changed,
      warnings,
      streamItemScope,
      needsRootBinding,
    };
  }

  private compileObject(
    scope: ReadableSchema | undefined,
    rootPathPrefix?: string,
    itemScope?: ReadableSchema,
  ): CompileChunk {
    const close = findMatching(this.tokens, this.index);
    const ranges = splitTopLevel(this.tokens, this.index + 1, close, ',');
    const entries: string[] = [];
    const warnings: ReadableSyntaxWarning[] = [];
    let changed = false;
    let needsRootBinding = false;

    for (const [start, end] of ranges) {
      if (start === end) {
        continue;
      }
      const colon = this.findTopLevelToken(start, end, ':');
      if (colon === -1) {
        entries.push(
          this.tokens
            .slice(start, end)
            .map(tokenSource)
            .join(''),
        );
        continue;
      }

      const key = this.tokens.slice(start, colon).map(tokenSource).join('');
      const value = new Compiler(
        this.tokens,
        { schema: this.schema, rootPathPrefix, itemScope },
        colon + 1,
        end,
      ).compile(scope);
      entries.push(`${key}:${value.source}`);
      warnings.push(...value.warnings);
      changed = changed || value.changed;
      needsRootBinding = needsRootBinding || Boolean(value.needsRootBinding);
    }

    this.index = close + 1;
    return {
      source: `{${entries.join(', ')}}`,
      changed,
      warnings,
      needsRootBinding,
    };
  }

  private findTopLevelToken(start: number, end: number, value: string): number {
    let depth = 0;
    for (let i = start; i < end; i++) {
      const token = this.tokens[i];
      if (token.type === 'punc' && ['(', '[', '{'].includes(token.value)) {
        depth++;
      } else if (token.type === 'punc' && [')', ']', '}'].includes(token.value)) {
        depth--;
      } else if (depth === 0 && token.value === value) {
        return i;
      }
    }
    return -1;
  }

  private compileFunctionCall(
    scope: ReadableSchema | undefined,
    rootPathPrefix?: string,
    itemScope?: ReadableSchema,
  ): CompileChunk {
    const originalName = this.tokens[this.index].value;
    const name = canonicalFunctionName(originalName);
    const open = this.index + 1;
    const close = findMatching(this.tokens, open);
    const semicolonRanges = splitTopLevel(this.tokens, open + 1, close, ';');
    const useCommaArgs =
      semicolonRanges.length === 1 && isCommaArgumentFunction(name);
    const ranges = useCommaArgs
      ? splitTopLevel(this.tokens, open + 1, close, ',')
      : semicolonRanges;

    // Thread the caller's `.` scope through into each argument's compile.
    // For filter combinators like `map`/`select`, callers always arrive with
    // `itemScope` already set to the element shape (pipes set itemScope to
    // the prior stream's element scope). For value-style formula calls this
    // is harmless: args typically don't use `.` so the item scope is never
    // consulted.
    const args = ranges.map(([start, end]) =>
      new Compiler(
        this.tokens,
        { schema: this.schema, rootPathPrefix, itemScope },
        start,
        end,
      ).compile(scope),
    );

    if (
      ['all', 'any'].includes(name) &&
      args.length === 2 &&
      args[0].streamItemScope
    ) {
      const conditionRange = ranges[1];
      args[1] = compilePredicate(
        this.tokens.slice(conditionRange[0], conditionRange[1]),
        args[0].streamItemScope,
      );
    }

    this.index = close + 1;
    const source = formatFunctionCallSource(name, args);
    return {
      source,
      changed:
        originalName !== name ||
        useCommaArgs ||
        source !== `${name}(${args.map((arg) => arg.source).join('; ')})` ||
        args.some((arg) => arg.changed),
      warnings: args.flatMap((arg) => arg.warnings),
      streamItemScope: args[0]?.streamItemScope,
      needsRootBinding: args.some((arg) => arg.needsRootBinding),
    };
  }

  private tryCompilePath(
    scope: ReadableSchema | undefined,
    rootPathPrefix?: string,
    itemScope?: ReadableSchema,
  ): PathCompileResult | null {
    const start = this.index;
    const first = this.tokens[this.index];
    let out = '';
    let changed = false;
    const warnings: ReadableSyntaxWarning[] = [];
    let valueScope: ReadableSchema | undefined;
    let arrayItemScope: ReadableSchema | undefined;
    let streamItemScope: ReadableSchema | undefined;
    let materialized = false;
    let needsRootBinding = false;
    // Set by an initial or chained field-resolve whose field is an
    // `array`-kind. A following `.field` suffix will then auto-iterate
    // — see implicit [all] logic below. Any explicit `[...]` suffix
    // (including `[all]`, `[row N]`, slices, predicates) clears the
    // flag since the user has committed to a specific indexing shape.
    let pendingImplicitArray = false;

    // `.field` and `?.field` resolve against the current `.` scope
    // (itemScope) if one is set — for example, after a pipe where the
    // prior stage yielded a stream. Falls back to `scope` when no
    // itemScope was threaded, which matches top-level behavior.
    const dotScope = itemScope ?? scope;

    if (first?.type === 'op' && first.value === '.') {
      out = '.';
      this.index++;
      const label = this.readLabelToken(dotScope);
      if (label) {
        const resolved = resolveField(dotScope, label.value);
        out += resolved?.field.key ?? label.value;
        valueScope = resolved?.valueScope;
        arrayItemScope = resolved?.arrayItemScope;
        pendingImplicitArray = Boolean(resolved?.field.kind === 'array');
        changed = changed || Boolean(resolved && resolved.field.key !== label.value);
      }
    } else if (first?.type === 'op' && first.value === '?.') {
      out = '.';
      this.index++;
      const label = this.readLabelToken(dotScope);
      if (!label) {
        this.index = start;
        return null;
      }
      const resolved = resolveField(dotScope, label.value);
      out += `${resolved?.field.key ?? label.value}?`;
      valueScope = resolved?.valueScope;
      arrayItemScope = resolved?.arrayItemScope;
      pendingImplicitArray = Boolean(resolved?.field.kind === 'array');
      changed = true;
    } else {
      const label = this.readLabelToken(scope);
      if (!label || this.tokens[this.index]?.value === '(') {
        this.index = start;
        return null;
      }
      const resolved = resolveField(scope, label.value);
      if (!resolved) {
        this.index = start;
        return null;
      }
      out = rootPathPrefix
        ? `${rootPathPrefix}.${resolved.field.key}`
        : `.${resolved.field.key}`;
      valueScope = resolved.valueScope;
      arrayItemScope = resolved.arrayItemScope;
      pendingImplicitArray = resolved.field.kind === 'array';
      changed = true;
    }

    while (this.index < this.end) {
      const token = this.tokens[this.index];

      if (token.type === 'op' && token.value === '?') {
        out += '?';
        changed = true;
        this.index++;
        continue;
      }

      if (token.type === 'op' && (token.value === '.' || token.value === '?.')) {
        const optional = token.value === '?.';
        // Implicit [all] iteration. When the previous path step landed
        // on an array-typed field AND the user navigates straight into
        // an item field without an explicit `[all]` / `[]` / `[n]`,
        // auto-materialize here so the chain reads the per-item field
        // — e.g. `"Line Item"."Line Total"` compiles to
        // `[.lineItems[].lineTotal]`, matching the explicit `[all]` form.
        // `materialized = true` ensures the outer path loop closes the
        // bracket at end-of-path. `pendingImplicitArray` is cleared by
        // any `[...]` suffix, so `"Line Item"[row 4].Quantity` stays
        // single-element as the user intended.
        if (pendingImplicitArray && !materialized) {
          out = `[${out}[]`;
          materialized = true;
          changed = true;
          pendingImplicitArray = false;
        }
        this.index++;
        const label = this.readLabelToken(valueScope);
        if (!label) {
          this.index = start;
          return null;
        }
        const resolved = resolveField(valueScope, label.value);
        out += `${optional ? '?' : ''}.${resolved?.field.key ?? label.value}`;
        valueScope = resolved?.valueScope;
        arrayItemScope = resolved?.arrayItemScope;
        pendingImplicitArray = Boolean(resolved?.field.kind === 'array');
        changed = changed || optional || Boolean(resolved && resolved.field.key !== label.value);
        continue;
      }

      if (token.type === 'punc' && token.value === '[') {
        const suffix = this.compileIndexSuffix(
          out,
          valueScope,
          arrayItemScope,
          materialized,
          rootPathPrefix,
        );
        out = suffix.source;
        changed = changed || suffix.changed;
        warnings.push(...suffix.warnings);
        needsRootBinding = needsRootBinding || Boolean(suffix.needsRootBinding);
        valueScope = suffix.valueScope;
        arrayItemScope = suffix.arrayItemScope;
        streamItemScope = suffix.streamItemScope ?? streamItemScope;
        materialized = suffix.openMaterialized ?? materialized;
        // Explicit `[...]` — user committed to an indexing shape, so the
        // implicit-array flag no longer applies.
        pendingImplicitArray = false;
        continue;
      }

      if (token.type === 'punc' && token.value === ':') {
        throw new ReadableSyntaxError(
          'CSS-style pseudo-class syntax was removed; use [#first], [#last], [#last-N], [#only], [#odd], [#even], [#N], or [#-N].',
        );
      }

      break;
    }

    if (materialized && hasUnclosedMaterializedArray(out)) {
      out += ']';
    }

    return {
      source: out,
      changed,
      warnings,
      next: this.index,
      valueScope,
      arrayItemScope,
      streamItemScope,
      needsRootBinding:
        needsRootBinding || Boolean(rootPathPrefix && out.includes(rootPathPrefix)),
    };
  }

  private readLabelToken(scope: ReadableSchema | undefined): Token | undefined {
    const token = this.tokens[this.index];
    if (!token || !['ident', 'string'].includes(token.type)) {
      return undefined;
    }

    if (token.type === 'ident') {
      let best:
        | {
            value: string;
            next: number;
          }
        | undefined;
      const parts: string[] = [];

      for (let i = this.index; i < this.end; i++) {
        const current = this.tokens[i];
        if (current.type !== 'ident') {
          break;
        }

        const lower = current.value.toLowerCase();
        if (i > this.index && (KEYWORDS.has(lower) || LITERALS.has(lower))) {
          break;
        }

        parts.push(current.value);
        const phrase = parts.join(' ');
        if (scope && resolveField(scope, phrase)) {
          best = { value: phrase, next: i + 1 };
        }
      }

      if (best) {
        this.index = best.next;
        return { type: 'ident', value: best.value };
      }
    }

    this.index++;
    return token;
  }

  private compileIndexSuffix(
    base: string,
    currentScope: ReadableSchema | undefined,
    currentItemScope: ReadableSchema | undefined,
    materialized: boolean,
    rootPathPrefix?: string,
  ): PathCompileResult {
    const open = this.index;
    const close = findMatching(this.tokens, open);
    const inner = this.tokens.slice(open + 1, close);
    this.index = close + 1;
    const item = currentItemScope ?? currentScope;

    if (inner.length === 0) {
      return {
        source: `${base}[]`,
        changed: false,
        warnings: [],
        next: this.index,
        valueScope: item,
        streamItemScope: item,
      };
    }

    if (
      inner.length === 1 &&
      (isIdent(inner[0], 'all') ||
        inner[0].value === '...')
    ) {
      return {
        source: `[${base}[]`,
        changed: true,
        warnings: [],
        next: this.index,
        valueScope: item,
        streamItemScope: item,
        openMaterialized: true,
      };
    }

    // `[*pred]` — filter-all. The leading `*` marks "keep every row that
    // satisfies the predicate" and emits a materialized stream that the
    // rest of the path can navigate into. Composes with downstream
    // `.field` via implicit `[all]` just like the bare `[all]` form:
    //   "Line Item"[*Taxable]."Line Total"
    //     → [.lineItems[] | select(.taxable).lineTotal]
    //   COUNT("Line Item"[*Category = "Service"])
    //     → COUNT([.lineItems[] | select(.category == "Service")])
    // Bare-label shorthand: `[*Taxable]` means `[*Taxable == true]` in
    // the Excel-truthy sense; jq's own `select(.x)` already does the
    // right thing (null/false filter out, everything else keeps).
    if (inner[0]?.type === 'op' && inner[0].value === '*' && item) {
      const predTokens = inner.slice(1);
      const predicate = compilePredicate(predTokens, item);
      return {
        source: `[${base}[] | select(${predicate.source})`,
        changed: true,
        warnings: predicate.warnings,
        next: this.index,
        valueScope: item,
        arrayItemScope: item,
        streamItemScope: item,
        openMaterialized: true,
      };
    }

    const selectorTerms = splitTopLevel(inner, 0, inner.length, ',');
    if (selectorTerms.length > 1) {
      const parsedTerms = selectorTerms.map(([start, end]) =>
        parseSelectorUnionTerm(inner.slice(start, end)),
      );
      if (parsedTerms.every((term): term is SelectorUnionTerm => Boolean(term))) {
        const closedBase = hasUnclosedMaterializedArray(base) ? `${base}]` : base;
        return {
          source:
            `[(${closedBase}) as $__seq | ($__seq | length) as $__len | ` +
            `range(0; $__len) as $__idx | select(${selectorUnionCondition(parsedTerms)}) | $__seq[$__idx]`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
          arrayItemScope: item,
          streamItemScope: item,
          openMaterialized: true,
        };
      }
    }

    if (
      inner.length === 4 &&
      inner[0].value === '#' &&
      inner[1].type === 'ident' &&
      inner[1].value.toLowerCase() === 'last' &&
      inner[2].type === 'op' &&
      inner[2].value === '-' &&
      inner[3].type === 'number'
    ) {
      const offset = Number(inner[3].value);
      if (!Number.isInteger(offset) || offset < 1) {
        throw new ReadableSyntaxError(
          `[#last-${inner[3].value}] must subtract a positive whole number`,
        );
      }
      return {
        source: `${base}[-${offset + 1}]`,
        changed: true,
        warnings: [],
        next: this.index,
        valueScope: item,
      };
    }

    if (inner.length === 2 && inner[0].value === '#' && inner[1].type === 'ident') {
      const keyword = inner[1].value.toLowerCase();
      const closedBase = hasUnclosedMaterializedArray(base) ? `${base}]` : base;

      if (keyword === 'first') {
        return {
          source: `${base}[0]`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
        };
      }

      if (keyword === 'last') {
        return {
          source: `${base}[-1]`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
        };
      }

      if (keyword === 'only') {
        return {
          source:
            `((${closedBase}) as $__seq | ($__seq | length) as $__len | ` +
            `if $__len == 1 then $__seq[0] else error("expected exactly 1 element, got \\($__len)") end)`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
        };
      }

      if (keyword === 'odd' || keyword === 'even') {
        const start = keyword === 'odd' ? 0 : 1;
        return {
          source: `[${closedBase} | .[range(${start}; length; 2)]`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
          arrayItemScope: item,
          streamItemScope: item,
          openMaterialized: true,
        };
      }

      throw new ReadableSyntaxError(
        `Unsupported positional selector keyword '#${inner[1].value}'`,
      );
    }

    if (
      inner.length === 3 &&
      inner[0].value === '#' &&
      inner[1].type === 'op' &&
      inner[1].value === '-' &&
      inner[2].type === 'number'
    ) {
      const fromEnd = Number(inner[2].value);
      if (!Number.isInteger(fromEnd) || fromEnd < 1) {
        throw new ReadableSyntaxError(
          `[#-${inner[2].value}] must be a negative index with a positive magnitude`,
        );
      }
      return {
        source: `${base}[-${fromEnd}]`,
        changed: true,
        warnings: [],
        next: this.index,
        valueScope: item,
      };
    }

    if (inner.length === 2 && inner[0].value === '#' && inner[1].type === 'number') {
      // `[#N]` — one-based, human-friendly single-row selector. Compiles
      // to zero-based jq by subtracting 1.
      const oneBased = Number(inner[1].value);
      if (!Number.isInteger(oneBased) || oneBased < 1) {
        throw new ReadableSyntaxError(
          `[#${inner[1].value}] must be a positive 1-based row number`,
        );
      }
      return {
        source: `${base}[${oneBased - 1}]`,
        changed: true,
        warnings: [],
        next: this.index,
        valueScope: item,
      };
    }

    // `[#N..M]`, `[#4..#last-3]`, `[#last-119..#last-1]` — forward,
    // human-authored inclusive ranges. Start/end endpoints can be
    // anchored from the front (`#first`, `#N`) or the back (`#last`,
    // `#last-N`), but ranges must still move forward in collection
    // order. We deliberately reject `[#last-3..4]` rather than hiding a
    // reverse traversal in the syntax.
    const rangeParts = splitTopLevel(inner, 0, inner.length, '..');
    if (rangeParts.length === 2) {
      const startEndpoint = parseSelectorRangeEndpoint(inner.slice(...rangeParts[0]));
      const endEndpoint = parseSelectorRangeEndpoint(inner.slice(...rangeParts[1]), {
        allowBareNumber: true,
      });
      if (startEndpoint && endEndpoint) {
        if (!selectorRangeIsIncreasing(startEndpoint, endEndpoint)) {
          throw new ReadableSyntaxError(
            `[${startEndpoint.display}..${endEndpoint.display}] range must move forward in collection order`,
          );
        }

        if (
          startEndpoint.family === 'front' &&
          endEndpoint.family === 'front'
        ) {
          return {
            source: `[${base}[${startEndpoint.oneBased - 1}:${endEndpoint.oneBased}][]`,
            changed: true,
            warnings: [],
            next: this.index,
            valueScope: item,
            arrayItemScope: item,
            streamItemScope: item,
            openMaterialized: true,
          };
        }

        const closedBase = hasUnclosedMaterializedArray(base) ? `${base}]` : base;
        const seqVar = '$__seq';
        const lengthExpr = `(${seqVar} | length)`;
        return {
          source:
            `[(${closedBase}) as ${seqVar} | ` +
            `${seqVar}[${selectorRangeStartExpr(startEndpoint, lengthExpr)}:` +
            `${selectorRangeEndExpr(endEndpoint, lengthExpr)}][]`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
          arrayItemScope: item,
          streamItemScope: item,
          openMaterialized: true,
        };
      }
    }

    const commaRanges = splitTopLevel(inner, 0, inner.length, ',');
    if (commaRanges.length === 2 && isSimpleHumanIndex(inner.slice(...commaRanges[0]))) {
      const indexText = indexTextFromHumanIndex(inner.slice(...commaRanges[0]));
      const predicate = compilePredicate(inner.slice(...commaRanges[1]), item);
      return {
        source: `(${base}[${indexText}] | select(${predicate.source}))`,
        changed: true,
        warnings: predicate.warnings,
        next: this.index,
        valueScope: item,
      };
    }

    const humanIndex = indexTextFromHumanIndex(inner);
    if (humanIndex !== undefined) {
      if (humanIndex.includes(':')) {
        return {
          source: `[${base}[${humanIndex}][]`,
          changed: true,
          warnings: [],
          next: this.index,
          valueScope: item,
          arrayItemScope: item,
          streamItemScope: item,
          openMaterialized: true,
        };
      }

      return {
        source: `${base}[${humanIndex}]`,
        changed: true,
        warnings: [],
        next: this.index,
        valueScope: item,
        arrayItemScope: currentItemScope,
      };
    }

    if (isLastCall(inner)) {
      let indexText = '-1';
      if (inner.length === 5 && inner[3].value === '-' && inner[4].type === 'number') {
        indexText = `-${Number(inner[4].value) + 1}`;
      }
      return {
        source: `${base}[${indexText}]`,
        changed: true,
        warnings: [],
        next: this.index,
        valueScope: item,
      };
    }

    if (isPredicateLike(inner) && item) {
      const predicate = compilePredicate(inner, item);
      return {
        source: `first(${base}[] | select(${predicate.source}))`,
        changed: true,
        warnings: predicate.warnings,
        next: this.index,
        valueScope: item,
      };
    }

    if (splitTopLevel(inner, 0, inner.length, ':').length === 2) {
      const compiled = new Compiler(inner, {
        schema: this.schema,
        rootPathPrefix,
      }).compile(currentScope);
      return {
        source: `[${base}[${compiled.source}][]`,
        changed: compiled.changed,
        warnings: compiled.warnings,
        next: this.index,
        valueScope: item,
        arrayItemScope: item,
        streamItemScope: item,
        openMaterialized: true,
        needsRootBinding: compiled.needsRootBinding,
      };
    }

    const compiled = new Compiler(inner, {
      schema: this.schema,
      rootPathPrefix,
    }).compile(currentScope);
    return {
      source: `${base}[${compiled.source}]`,
      changed: compiled.changed,
      warnings: compiled.warnings,
      next: this.index,
      valueScope: item,
      arrayItemScope: materialized ? currentItemScope : undefined,
      needsRootBinding: compiled.needsRootBinding,
    };
  }

}

// Strip a leading `=` (Excel cell-formula prefix) so that a user can
// paste `=SUM(A, B, C)` from a formula bar and have it work as BXL. We
// only strip a SOLO leading `=`; `==` starts a comparison expression and
// must be preserved.
export function stripExcelCellPrefix(source: string): { source: string; changed: boolean } {
  const match = source.match(/^(\s*)=(?!=)/);
  if (!match) {
    return { source, changed: false };
  }
  return { source: match[1] + source.slice(match[0].length), changed: true };
}

// Rewrite Excel-style binary operators that jq/BXL don't speak natively:
//   a ^ b  -> POWER(a, b)
//   a & b  -> ((a|tostring) + (b|tostring))     // Excel coerces both sides
// We process occurrences right-to-left so `^`'s right-associativity and
// `&` chaining both fall out naturally.
/**
 * Rewrite `X STARTSWITH Y` / `X ENDSWITH Y` / `X CONTAINS Y` as infix
 * operators (outside predicate brackets) into pipe-form jq calls:
 *
 *   .donor STARTSWITH "Mr."   →   ((.donor) | startswith("Mr."))
 *   .email CONTAINS "@"       →   ((.email) | contains("@"))
 *
 * The word forms compile correctly inside predicate suffix brackets
 * (`Foo[Bar STARTSWITH "X"]`) via compilePredicate, so this pass skips only
 * those bracket contexts. Array literals/comprehensions like
 * `[range(...) as $r | "abc" STARTSWITH "a"]` still need rewriting.
 * Formula-call form (`STARTSWITH(x; y)`) is already handled by the
 * function-call compiler — we only rewrite when the word is followed by an
 * atom, not `(`.
 */
export function rewriteWordBinaryOperators(
  source: string,
): { source: string; changed: boolean } {
  const WORD_OPS: Record<string, string> = {
    STARTSWITH: 'startswith',
    ENDSWITH: 'endswith',
    CONTAINS: 'contains',
  };
  let current = source;
  let changed = false;
  let guard = 0;
  while (guard++ < 1024) {
    const tokens = tokenizeQuietly(current);
    if (!tokens) break;
    let rewroteThisPass = false;
    // Walk right-to-left so indices on the left remain valid between passes.
    // Track only predicate suffix brackets, not array/comprehension brackets.
    const depthAt = predicateBracketDepths(tokens);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const tok = tokens[i];
      if (tok.type !== 'ident') continue;
      const jqName = WORD_OPS[tok.value.toUpperCase()];
      if (!jqName) continue;
      // Inside predicate suffix brackets? Let compilePredicate handle it.
      if (depthAt[i] > 0) continue;
      // Formula-call form (FUNC(...))? Let function-call compiler handle it.
      // Distinguish `STARTSWITH(x; y)` (call — skip) from `x STARTSWITH (y)`
      // (infix whose RHS happens to be a grouped expression — rewrite).
      // Adjacent `(` = call; whitespace between = infix + paren group.
      const next = tokens[i + 1];
      if (
        next &&
        next.type === 'punc' &&
        next.value === '(' &&
        next.start === tok.end
      ) {
        continue;
      }
      const lhs = excelOperandExtent(tokens, i, -1);
      const rhs = excelOperandExtent(tokens, i, +1);
      if (!lhs || !rhs) continue;
      const lhsText = current.slice(lhs.start, lhs.end);
      const rhsText = current.slice(rhs.start, rhs.end);
      // Capture root as $__ctx so RHS-side `.field` paths resolve against
      // root, not against the piped-in LHS value. Without this, any RHS
      // that traverses `.foo` tries to index into the LHS string and jq
      // throws "Cannot index string with string".
      const replacement = `(. as $__ctx | (${lhsText}) | ${jqName}($__ctx | ${rhsText}))`;
      current = current.slice(0, lhs.start) + replacement + current.slice(rhs.end);
      changed = true;
      rewroteThisPass = true;
      break;
    }
    if (!rewroteThisPass) break;
  }
  return { source: current, changed };
}

export function rewriteExcelOperators(
  source: string,
): { source: string; changed: boolean } {
  let current = source;
  let changed = false;
  let guard = 0;
  while (guard++ < 1024) {
    const tokens = tokenizeQuietly(current);
    if (!tokens) break;
    let rewroteThisPass = false;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const tok = tokens[i];
      if (tok.type !== 'op' || (tok.value !== '^' && tok.value !== '&')) continue;
      const lhs = excelOperandExtent(tokens, i, -1);
      const rhs = excelOperandExtent(tokens, i, +1);
      if (!lhs || !rhs) continue;
      const lhsText = current.slice(lhs.start, lhs.end);
      const rhsText = current.slice(rhs.start, rhs.end);
      const replacement = tok.value === '^'
        ? `POWER(${lhsText}, ${rhsText})`
        : `((${lhsText}|tostring) + (${rhsText}|tostring))`;
      current = current.slice(0, lhs.start) + replacement + current.slice(rhs.end);
      changed = true;
      rewroteThisPass = true;
      break;
    }
    if (!rewroteThisPass) break;
  }
  return { source: current, changed };
}

// Best-effort tokenize that swallows tokenizer errors so we can walk
// tokens without blowing up the whole pipeline.
function tokenizeQuietly(source: string): Token[] | undefined {
  try {
    return tokenize(source);
  } catch {
    return undefined;
  }
}

// Extent of an operand atom relative to an operator position. `direction`
// is -1 (look back for LHS) or +1 (look forward for RHS). Handles simple
// values (ident/number/string), dotted paths, optional brackets, and
// balanced parens/brackets (including `FUNC(...)` call form).
function excelOperandExtent(
  tokens: Token[],
  opIndex: number,
  direction: -1 | 1,
): { start: number; end: number } | undefined {
  const startIdx = opIndex + direction;
  const first = tokens[startIdx];
  if (!first || first.start === undefined || first.end === undefined) return undefined;

  if (direction === -1) {
    // LHS: anchor at the token just before the op and walk left over
    //      dotted path and bracket chains.
    let anchor = startIdx;
    // Closing bracket: span back to matching open, then absorb a
    // preceding identifier (function-call form).
    if (first.type === 'punc' && (first.value === ')' || first.value === ']')) {
      anchor = matchOpen(tokens, startIdx);
      if (anchor < 0) return undefined;
      if (anchor > 0 && tokens[anchor - 1].type === 'ident') anchor--;
    } else if (!['ident', 'number', 'string'].includes(first.type)) {
      return undefined;
    }
    // Extend left over `.field` / `.["Label"]` suffixes so
    // operators like `&` / `^` absorb the full chain on their left.
    while (anchor > 0) {
      const current = tokens[anchor];
      if (current.type === 'punc' && (current.value === ')' || current.value === ']')) {
        anchor = matchOpen(tokens, anchor);
        if (anchor < 0) return undefined;
        if (
          anchor > 0 &&
          ['ident', 'number', 'string'].includes(tokens[anchor - 1].type)
        ) {
          anchor -= 1;
        }
        continue;
      }
      const prev = tokens[anchor - 1];
      if (prev.type === 'op' && (prev.value === '.' || prev.value === '?.')) {
        const beforeDot = tokens[anchor - 2];
        // Extend through ident/number/string (dotted chain) or a closing
        // bracket (subscript / call chain). `;` and `,` are also `punc`
        // tokens but they must stop the walker — they separate function
        // args or jq generators. See bug #7 regression.
        const okPunc =
          beforeDot && beforeDot.type === 'punc' &&
          (beforeDot.value === ')' || beforeDot.value === ']' || beforeDot.value === '}');
        if (beforeDot && (okPunc || ['ident', 'number', 'string'].includes(beforeDot.type))) {
          anchor -= 2;
          continue;
        }
        anchor -= 1;
        continue;
      }
      break;
    }
    const startTok = tokens[anchor];
    const endTok = tokens[startIdx];
    if (startTok.start === undefined || endTok.end === undefined) return undefined;
    return { start: startTok.start, end: endTok.end };
  }

  // RHS: anchor at the token just after the op and walk right over
  //      dotted path + bracket suffixes.
  let anchor = startIdx;
  let endIdx = startIdx;
  if (first.type === 'punc' && (first.value === '(' || first.value === '[')) {
    endIdx = matchClose(tokens, anchor);
    if (endIdx < 0) return undefined;
  } else if (first.type === 'op' && first.value === '.') {
    // Leading `.ident` path like `.subtotal`.
    endIdx = anchor + 1;
    if (endIdx >= tokens.length) return undefined;
  } else if (!['ident', 'number', 'string'].includes(first.type)) {
    return undefined;
  }
  // Extend right: `ident(...)` call, `foo[...]` subscript, `.field`.
  while (endIdx + 1 < tokens.length) {
    const next = tokens[endIdx + 1];
    if (next.type === 'op' && (next.value === '.' || next.value === '?.')) {
      const afterDot = tokens[endIdx + 2];
      if (afterDot && ['ident', 'number', 'string'].includes(afterDot.type)) {
        endIdx += 2;
        continue;
      }
      break;
    }
    if (next.type === 'punc' && (next.value === '(' || next.value === '[')) {
      const close = matchClose(tokens, endIdx + 1);
      if (close < 0) break;
      endIdx = close;
      continue;
    }
    break;
  }
  const startTok = tokens[anchor];
  const endTok = tokens[endIdx];
  if (startTok.start === undefined || endTok.end === undefined) return undefined;
  return { start: startTok.start, end: endTok.end };
}

function matchOpen(tokens: Token[], closeIndex: number): number {
  const close = tokens[closeIndex].value;
  const open = close === ')' ? '(' : close === ']' ? '[' : '{';
  let depth = 1;
  for (let i = closeIndex - 1; i >= 0; i--) {
    if (tokens[i].type !== 'punc') continue;
    if (tokens[i].value === close) depth++;
    else if (tokens[i].value === open) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchClose(tokens: Token[], openIndex: number): number {
  const open = tokens[openIndex].value;
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 1;
  for (let i = openIndex + 1; i < tokens.length; i++) {
    if (tokens[i].type !== 'punc') continue;
    if (tokens[i].value === open) depth++;
    else if (tokens[i].value === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function opensSuffixBracketContext(tokens: Token[], openIndex: number): boolean {
  const previous = tokens[openIndex - 1];
  if (!previous) {
    return false;
  }

  if (['ident', 'number', 'string', 'var', 'format'].includes(previous.type)) {
    return true;
  }

  if (previous.type === 'punc' && [')', ']', '}'].includes(previous.value)) {
    return true;
  }

  if (previous.type === 'op' && ['.', '?.', '?'].includes(previous.value)) {
    return true;
  }

  return false;
}

function isPredicateBracketContext(tokens: Token[], openIndex: number): boolean {
  if (!opensSuffixBracketContext(tokens, openIndex)) {
    return false;
  }

  const close = matchClose(tokens, openIndex);
  if (close < 0) {
    return false;
  }

  const inner = tokens.slice(openIndex + 1, close);
  if (inner.length === 0) {
    return false;
  }

  if (inner[0]?.type === 'op' && inner[0].value === '*') {
    return true;
  }

  const commaRanges = splitTopLevel(inner, 0, inner.length, ',');
  if (
    commaRanges.length === 2 &&
    isSimpleHumanIndex(inner.slice(...commaRanges[0]))
  ) {
    return true;
  }

  return isPredicateLike(inner);
}

function predicateBracketDepths(tokens: Token[]): number[] {
  const depths = new Array<number>(tokens.length).fill(0);
  let depth = 0;
  const stack: boolean[] = [];

  for (let index = 0; index < tokens.length; index++) {
    depths[index] = depth;
    const token = tokens[index];

    if (token.type === 'punc' && token.value === '[') {
      const isPredicate = isPredicateBracketContext(tokens, index);
      stack.push(isPredicate);
      if (isPredicate) {
        depth++;
      }
      continue;
    }

    if (token.type === 'punc' && token.value === ']') {
      const wasPredicate = stack.pop();
      if (wasPredicate) {
        depth--;
      }
    }
  }

  return depths;
}

// Rewrite `<>` (Excel inequality) to canonical `!=` at the source level,
// skipping occurrences inside string literals. Done via the tokenizer so
// string boundaries are handled for free.
function rewriteInequality(source: string): { source: string; changed: boolean } {
  const tokens = tokenizeQuietly(source);
  if (!tokens) return { source, changed: false };
  const edits: Array<[number, number]> = [];
  for (const tok of tokens) {
    if (
      tok.type === 'op' &&
      tok.value === '!=' &&
      tok.raw === '<>' &&
      tok.start !== undefined &&
      tok.end !== undefined
    ) {
      edits.push([tok.start, tok.end]);
    }
  }
  if (edits.length === 0) return { source, changed: false };
  let out = '';
  let cursor = 0;
  for (const [start, end] of edits) {
    out += source.slice(cursor, start) + '!=';
    cursor = end;
  }
  out += source.slice(cursor);
  return { source: out, changed: true };
}

// Rewrite readable-BXL `=` comparisons to canonical `==`, except inside
// predicate suffix brackets where compilePredicate already treats bare `=`
// as equality.
//
// A prior version skipped *all* square-bracket contexts, which broke array
// literals/comprehensions like `[range(...) as $r | ($r = 0)]` by leaving
// jq assignment semantics in place.
// Pre-existing `==`, `!=`, `<=`, `>=`, `^=`, `$=`, `*=`, `/=`, `%=`,
// `+=`, `-=`, `|=`, `//=` stay untouched — the tokenizer emits those as
// separate multi-char ops, so our scan only ever sees the bare `=`.
function rewriteTopLevelEquals(source: string): { source: string; changed: boolean } {
  const tokens = tokenizeQuietly(source);
  if (!tokens) return { source, changed: false };
  const predicateDepths = predicateBracketDepths(tokens);
  const edits: Array<[number, number]> = [];
  for (let index = 0; index < tokens.length; index++) {
    const tok = tokens[index];
    if (
      predicateDepths[index] === 0 &&
      tok.type === 'op' &&
      tok.value === '=' &&
      tok.start !== undefined &&
      tok.end !== undefined
    ) {
      edits.push([tok.start, tok.end]);
    }
  }
  if (edits.length === 0) return { source, changed: false };
  let out = '';
  let cursor = 0;
  for (const [start, end] of edits) {
    out += source.slice(cursor, start) + '==';
    cursor = end;
  }
  out += source.slice(cursor);
  return { source: out, changed: true };
}

// Preprocess readable BXL source to absorb Excel-specific idioms
// before the compiler/linter sees the tokens.
export function preprocessReadableSource(
  source: string,
): { source: string; rewrites: { code: string; message: string }[] } {
  const rewrites: { code: string; message: string }[] = [];
  let next = source;
  const prefix = stripExcelCellPrefix(next);
  if (prefix.changed) {
    rewrites.push({
      code: 'excel-cell-prefix-stripped',
      message: 'Dropped the leading `=` (Excel cell-formula prefix).',
    });
    next = prefix.source;
  }
  const inequality = rewriteInequality(next);
  if (inequality.changed) {
    rewrites.push({
      code: 'excel-inequality-rewritten',
      message: 'Rewrote Excel-style `<>` to canonical `!=`.',
    });
    next = inequality.source;
  }
  const topLevelEquals = rewriteTopLevelEquals(next);
  if (topLevelEquals.changed) {
    rewrites.push({
      code: 'top-level-equals-to-comparison',
      message: 'Converted top-level = to == (BXL comparison).',
    });
    next = topLevelEquals.source;
  }
  const ops = rewriteExcelOperators(next);
  if (ops.changed) {
    rewrites.push({
      code: 'excel-operator-rewritten',
      message: 'Rewrote Excel-style `^` / `&` operators to BXL equivalents.',
    });
    next = ops.source;
  }
  const wordOps = rewriteWordBinaryOperators(next);
  if (wordOps.changed) {
    rewrites.push({
      code: 'word-binary-operator-rewritten',
      message:
        'Rewrote word-form STARTSWITH / ENDSWITH / CONTAINS (outside predicate brackets) to pipe-form jq calls.',
    });
    next = wordOps.source;
  }
  return { source: next, rewrites };
}

export function compileReadableSyntax(
  source: string,
  options: ReadableSyntaxOptions = {},
): ReadableSyntaxCompileResult {
  const pre = preprocessReadableSource(source);
  const tokens = tokenize(pre.source);
  const compiler = new Compiler(tokens, { schema: options.schema });
  const compiled = compiler.compile(options.schema);
  const compiledSource = compiled.needsRootBinding
    ? `. as $root | ${compiled.source}`
    : compiled.source;
  // Post-format compiled jq with readable spacing (spaces around
  // arithmetic and comparison ops, `; ` / `, ` separators, `. as $root`
  // phrasing). Safe because jq-level tokens are a subset of BXL's and
  // the tokenizer + formatter tolerate both. Falls back silently if the
  // formatter throws on an unexpected shape.
  let formatted = compiledSource;
  try {
    const reformatted = formatCompiledJq(compiledSource);
    if (reformatted) formatted = reformatted;
  } catch {
    // keep unformatted
  }
  return {
    source: formatted,
    changed: compiled.changed || formatted !== source,
    warnings: compiled.warnings,
  };
}

// Forward-declared binding — populated at module load by conversion.ts.
// We can't import the formatter directly without introducing a cycle, so
// the conversion module registers itself here.
let formatCompiledJq: (source: string) => string = (source) => source;
export function registerCompiledJqFormatter(fn: (source: string) => string): void {
  formatCompiledJq = fn;
}
