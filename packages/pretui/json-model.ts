/**
 * json-model.ts — Pretui's JSON document model.
 *
 * A precision-preserving, diagnostic-emitting JSON parser plus an immutable
 * edit algebra. Pure logic: no DOM, no Glimmer, no timers, no `Date.now()`,
 * no `Math.random()`. Safe to evaluate anywhere in the realm graph.
 *
 * Ported from the interaction model and edge-case handling of JsonTree.js
 * v4.7.1 (MIT, (c) 2025 William Troup / Bunoon). No JsonTree.js code is
 * vendored — see `json-tree.gts` for the porting rationale.
 *
 * BETTER THAN THE INSPIRATION — the four things upstream gets wrong:
 *
 *  1. Upstream's `Convert.jsonStringToObject` falls back to `eval()` when
 *     `JSON.parse` throws. That is arbitrary code execution on user input.
 *     We hand-roll a tokenizer instead and never evaluate anything.
 *  2. Upstream deletes a key when you clear its value, so `""` is
 *     unreachable and a slip of the keyboard is silent data loss. Here,
 *     clearing a string yields `""`; removal is only ever an explicit op.
 *  3. Upstream's `Convert.stringToDataTypeValue` coerces every edit back to
 *     the ORIGINAL value's type and returns `null` (edit silently dropped)
 *     when it cannot. Here, type is an explicit operation and a value that
 *     cannot be interpreted stays pending with a diagnostic attached.
 *  4. Upstream round-trips through `JSON.parse`, so a 25-digit integer
 *     silently becomes a different number. Here every number keeps its
 *     source literal and is re-emitted verbatim.
 */

/** A location inside a JSON document. Object steps are keys; array steps are indices. */
export type JsonPath = ReadonlyArray<string | number>;

/** The six JSON types, as a closed union. */
export type JsonKind =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'object';

/**
 * One member of an object. Objects are modelled as an ORDERED LIST of entries
 * rather than a JS object so that key order survives editing and duplicate
 * keys survive parsing (a plain object would silently drop all but the last).
 */
export interface JsonEntry {
  readonly key: string;
  readonly node: JsonNode;
}

export type JsonNode =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  /**
   * `literal` is the exact source text of the number. It is what gets
   * re-emitted, so integers beyond `Number.MAX_SAFE_INTEGER` and
   * high-precision decimals round-trip byte-for-byte even though `value`
   * (the IEEE-754 reading, kept for display and arithmetic) cannot hold them.
   */
  | {
      readonly kind: 'number';
      readonly value: number;
      readonly literal: string;
    }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'array'; readonly items: ReadonlyArray<JsonNode> }
  | { readonly kind: 'object'; readonly entries: ReadonlyArray<JsonEntry> };

export type DiagnosticCode =
  | 'unexpected-end'
  | 'unexpected-token'
  | 'trailing-content'
  | 'bad-number'
  | 'bad-string'
  | 'bad-escape'
  | 'lone-surrogate'
  | 'control-character'
  | 'duplicate-key'
  | 'number-precision'
  | 'empty-document'
  | 'pending-value';

export interface JsonDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: DiagnosticCode;
  /** Human-readable, already sentence-cased. Safe to render directly. */
  readonly message: string;
  /** Zero-based character offset into the source text, when known. */
  readonly offset: number;
  /** One-based line number, for gutter display. */
  readonly line: number;
  /** One-based column number. */
  readonly column: number;
  /** Where in the document tree the problem sits, when known. */
  readonly path?: JsonPath;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly root: JsonNode;
  /**
   * Non-fatal findings: duplicate keys, numbers that exceed IEEE-754
   * precision, lone surrogates. The document parsed; the caller decides
   * whether these matter.
   */
  readonly diagnostics: ReadonlyArray<JsonDiagnostic>;
}

export interface ParseFailure {
  readonly ok: false;
  readonly diagnostics: ReadonlyArray<JsonDiagnostic>;
  /**
   * TRUE when the text ran out mid-value — `{"a": ` or `[1,`. This is the
   * signature of a half-typed document, which is a PENDING state, not a
   * wrong one. UI should stay neutral for `incomplete`, and only show a
   * hard error when this is false.
   */
  readonly incomplete: boolean;
}

export type ParseResult = ParseSuccess | ParseFailure;

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

const BACKSLASH = '\\';
const QUOTE = '"';

interface Cursor {
  readonly text: string;
  pos: number;
}

/** Convert a character offset into 1-based line/column for gutter display. */
function locate(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: limit - lineStart + 1 };
}

function diagnostic(
  text: string,
  offset: number,
  severity: 'error' | 'warning',
  code: DiagnosticCode,
  message: string,
  path?: JsonPath,
): JsonDiagnostic {
  const at = locate(text, offset);
  return {
    severity,
    code,
    message,
    offset,
    line: at.line,
    column: at.column,
    ...(path ? { path } : {}),
  };
}

/** Thrown internally to unwind the recursive-descent parser. Never escapes `parseJson`. */
class ParseAbort extends Error {
  readonly diag: JsonDiagnostic;
  readonly incomplete: boolean;
  constructor(diag: JsonDiagnostic, incomplete: boolean) {
    super(diag.message);
    this.diag = diag;
    this.incomplete = incomplete;
  }
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function skipWhitespace(cur: Cursor): void {
  while (
    cur.pos < cur.text.length &&
    isWhitespace(cur.text.charCodeAt(cur.pos))
  ) {
    cur.pos++;
  }
}

function abortAtEnd(cur: Cursor, what: string): never {
  throw new ParseAbort(
    diagnostic(
      cur.text,
      cur.text.length,
      'error',
      'unexpected-end',
      `The document ends before ${what} is complete.`,
    ),
    true,
  );
}

/**
 * Normalise a JSON number literal to `{negative, significand, exponent}` with
 * no leading or trailing zeros, so two literals can be compared for exact
 * mathematical equality. Used to detect precision loss without any float
 * arithmetic.
 */
function canonicalNumber(literal: string): {
  negative: boolean;
  significand: string;
  exponent: number;
} {
  let rest = literal;
  let negative = false;
  if (rest.startsWith('-')) {
    negative = true;
    rest = rest.slice(1);
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1);
  }

  let exponent = 0;
  const eIndex = rest.search(/[eE]/);
  if (eIndex >= 0) {
    exponent = parseInt(rest.slice(eIndex + 1), 10) || 0;
    rest = rest.slice(0, eIndex);
  }

  const dotIndex = rest.indexOf('.');
  let digits = rest;
  if (dotIndex >= 0) {
    const fraction = rest.slice(dotIndex + 1);
    digits = rest.slice(0, dotIndex) + fraction;
    exponent -= fraction.length;
  }

  // Strip leading zeros.
  let start = 0;
  while (start < digits.length - 1 && digits.charCodeAt(start) === 48) {
    start++;
  }
  digits = digits.slice(start);

  // Strip trailing zeros, folding each into the exponent.
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) {
    end--;
    exponent++;
  }
  digits = digits.slice(0, end);

  if (digits.length === 0) {
    // The value is exactly zero; sign and exponent carry no information.
    return { negative: false, significand: '', exponent: 0 };
  }
  return { negative, significand: digits, exponent };
}

/**
 * TRUE when `literal` survives a round-trip through an IEEE-754 double.
 * `9007199254740993` and `0.1000000000000000055511151231257827` do not.
 */
export function numberIsExact(literal: string): boolean {
  const value = Number(literal);
  if (!Number.isFinite(value)) {
    return false;
  }
  const source = canonicalNumber(literal);
  const roundTrip = canonicalNumber(String(value));
  return (
    source.negative === roundTrip.negative &&
    source.significand === roundTrip.significand &&
    source.exponent === roundTrip.exponent
  );
}

const NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/;

function parseNumberToken(
  cur: Cursor,
  warnings: JsonDiagnostic[],
  path: JsonPath,
): JsonNode {
  const start = cur.pos;
  const match = NUMBER_PATTERN.exec(cur.text.slice(start));
  if (!match || match[0].length === 0) {
    throw new ParseAbort(
      diagnostic(
        cur.text,
        start,
        'error',
        'bad-number',
        'This is not a valid JSON number. JSON has no leading `+`, no leading zeros, no `.5`, and no `Infinity` or `NaN`.',
        path,
      ),
      false,
    );
  }
  const literal = match[0];
  cur.pos = start + literal.length;

  // A number immediately followed by more number-ish characters is a typo,
  // not two tokens: `01`, `1.2.3`, `1e`, `0x10`.
  const nextCode =
    cur.pos < cur.text.length ? cur.text.charCodeAt(cur.pos) : -1;
  const nextChar = nextCode >= 0 ? String.fromCharCode(nextCode) : '';
  if (nextChar !== '' && /[0-9a-zA-Z._+-]/.test(nextChar)) {
    throw new ParseAbort(
      diagnostic(
        cur.text,
        cur.pos,
        'error',
        'bad-number',
        'This is not a valid JSON number. JSON has no leading `+`, no leading zeros, no `.5`, and no `Infinity` or `NaN`.',
        path,
      ),
      cur.pos >= cur.text.length,
    );
  }

  const value = Number(literal);
  if (!numberIsExact(literal)) {
    warnings.push(
      diagnostic(
        cur.text,
        start,
        'warning',
        'number-precision',
        `The number ${literal} is larger or more precise than JavaScript numbers can hold. Its exact text is preserved, but arithmetic on it would lose precision.`,
        path,
      ),
    );
  }
  return { kind: 'number', value, literal };
}

function parseStringToken(
  cur: Cursor,
  warnings: JsonDiagnostic[],
  path: JsonPath,
): string {
  cur.pos++; // consume the opening quote
  let out = '';

  for (;;) {
    if (cur.pos >= cur.text.length) {
      throw new ParseAbort(
        diagnostic(
          cur.text,
          cur.text.length,
          'error',
          'unexpected-end',
          'The document ends inside a string — the closing quote is missing.',
          path,
        ),
        true,
      );
    }

    const code = cur.text.charCodeAt(cur.pos);

    if (code === 34) {
      cur.pos++;
      return out;
    }

    if (code === 92) {
      cur.pos++;
      if (cur.pos >= cur.text.length) {
        abortAtEnd(cur, 'an escape sequence');
      }
      const esc = cur.text[cur.pos];
      cur.pos++;
      if (esc === QUOTE) {
        out += QUOTE;
      } else if (esc === BACKSLASH) {
        out += BACKSLASH;
      } else if (esc === '/') {
        out += '/';
      } else if (esc === 'b') {
        out += '\b';
      } else if (esc === 'f') {
        out += '\f';
      } else if (esc === 'n') {
        out += '\n';
      } else if (esc === 'r') {
        out += '\r';
      } else if (esc === 't') {
        out += '\t';
      } else if (esc === 'u') {
        const hex = cur.text.slice(cur.pos, cur.pos + 4);
        if (hex.length < 4) {
          abortAtEnd(cur, 'a `\\u` escape');
        }
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new ParseAbort(
            diagnostic(
              cur.text,
              cur.pos,
              'error',
              'bad-escape',
              'A `\\u` escape needs exactly four hexadecimal digits.',
              path,
            ),
            false,
          );
        }
        const unit = parseInt(hex, 16);
        cur.pos += 4;
        out += String.fromCharCode(unit);
        if (unit >= 0xd800 && unit <= 0xdfff) {
          // Only warn once the pair is resolvable; a high surrogate followed
          // by its low partner is perfectly legal.
          const previous = out.charCodeAt(out.length - 2);
          const isCompletedPair =
            unit >= 0xdc00 && previous >= 0xd800 && previous <= 0xdbff;
          if (!isCompletedPair && unit >= 0xdc00) {
            warnings.push(
              diagnostic(
                cur.text,
                cur.pos - 6,
                'warning',
                'lone-surrogate',
                'This string contains an unpaired surrogate escape. It is preserved exactly, but it is not valid Unicode text.',
                path,
              ),
            );
          }
        }
      } else {
        throw new ParseAbort(
          diagnostic(
            cur.text,
            cur.pos - 1,
            'error',
            'bad-escape',
            `\\${esc} is not a JSON escape sequence. JSON allows \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.`,
            path,
          ),
          false,
        );
      }
      continue;
    }

    if (code < 0x20) {
      throw new ParseAbort(
        diagnostic(
          cur.text,
          cur.pos,
          'error',
          'control-character',
          'A raw control character is not allowed inside a JSON string. Write it as an escape such as `\\n`.',
          path,
        ),
        false,
      );
    }

    out += cur.text[cur.pos];
    cur.pos++;
  }
}

function parseValue(
  cur: Cursor,
  warnings: JsonDiagnostic[],
  path: JsonPath,
): JsonNode {
  skipWhitespace(cur);
  if (cur.pos >= cur.text.length) {
    abortAtEnd(cur, 'a value');
  }

  const char = cur.text[cur.pos];

  if (char === QUOTE) {
    return { kind: 'string', value: parseStringToken(cur, warnings, path) };
  }
  if (char === '{') {
    return parseObject(cur, warnings, path);
  }
  if (char === '[') {
    return parseArray(cur, warnings, path);
  }
  if (cur.text.startsWith('true', cur.pos)) {
    cur.pos += 4;
    return { kind: 'boolean', value: true };
  }
  if (cur.text.startsWith('false', cur.pos)) {
    cur.pos += 5;
    return { kind: 'boolean', value: false };
  }
  if (cur.text.startsWith('null', cur.pos)) {
    cur.pos += 4;
    return { kind: 'null' };
  }
  if (char === '-' || (char >= '0' && char <= '9')) {
    return parseNumberToken(cur, warnings, path);
  }

  // A bare prefix of a keyword at end-of-input is a half-typed document.
  const tail = cur.text.slice(cur.pos);
  const isKeywordPrefix =
    'true'.startsWith(tail) ||
    'false'.startsWith(tail) ||
    'null'.startsWith(tail);
  if (isKeywordPrefix && tail.length > 0) {
    abortAtEnd(cur, 'a value');
  }

  throw new ParseAbort(
    diagnostic(
      cur.text,
      cur.pos,
      'error',
      'unexpected-token',
      `Expected a value here, found \`${char}\`. A JSON value is an object, array, string, number, \`true\`, \`false\`, or \`null\`.`,
      path,
    ),
    false,
  );
}

function parseArray(
  cur: Cursor,
  warnings: JsonDiagnostic[],
  path: JsonPath,
): JsonNode {
  cur.pos++; // consume `[`
  const items: JsonNode[] = [];
  skipWhitespace(cur);

  if (cur.pos >= cur.text.length) {
    abortAtEnd(cur, 'an array');
  }
  if (cur.text[cur.pos] === ']') {
    cur.pos++;
    return { kind: 'array', items };
  }

  for (;;) {
    items.push(parseValue(cur, warnings, [...path, items.length]));
    skipWhitespace(cur);
    if (cur.pos >= cur.text.length) {
      abortAtEnd(cur, 'an array');
    }
    const char = cur.text[cur.pos];
    if (char === ',') {
      cur.pos++;
      skipWhitespace(cur);
      if (cur.pos >= cur.text.length) {
        abortAtEnd(cur, 'an array');
      }
      if (cur.text[cur.pos] === ']') {
        throw new ParseAbort(
          diagnostic(
            cur.text,
            cur.pos,
            'error',
            'unexpected-token',
            'JSON does not allow a trailing comma before `]`.',
            path,
          ),
          false,
        );
      }
      continue;
    }
    if (char === ']') {
      cur.pos++;
      return { kind: 'array', items };
    }
    throw new ParseAbort(
      diagnostic(
        cur.text,
        cur.pos,
        'error',
        'unexpected-token',
        `Expected \`,\` or \`]\` here, found \`${char}\`.`,
        path,
      ),
      false,
    );
  }
}

function parseObject(
  cur: Cursor,
  warnings: JsonDiagnostic[],
  path: JsonPath,
): JsonNode {
  cur.pos++; // consume `{`
  const entries: JsonEntry[] = [];
  const seen = new Set<string>();
  skipWhitespace(cur);

  if (cur.pos >= cur.text.length) {
    abortAtEnd(cur, 'an object');
  }
  if (cur.text[cur.pos] === '}') {
    cur.pos++;
    return { kind: 'object', entries };
  }

  for (;;) {
    skipWhitespace(cur);
    if (cur.pos >= cur.text.length) {
      abortAtEnd(cur, 'an object');
    }
    if (cur.text[cur.pos] !== QUOTE) {
      throw new ParseAbort(
        diagnostic(
          cur.text,
          cur.pos,
          'error',
          'unexpected-token',
          `Expected a quoted property name here, found \`${cur.text[cur.pos]}\`.`,
          path,
        ),
        false,
      );
    }
    const keyOffset = cur.pos;
    const key = parseStringToken(cur, warnings, path);

    if (seen.has(key)) {
      // JSON.parse keeps the last and drops the rest without a word. We keep
      // BOTH entries and flag it, because dropping a key is data loss.
      warnings.push(
        diagnostic(
          cur.text,
          keyOffset,
          'warning',
          'duplicate-key',
          `The property name "${key}" appears more than once in this object. Both entries are preserved here, but most JSON readers keep only the last.`,
          [...path, key],
        ),
      );
    }
    seen.add(key);

    skipWhitespace(cur);
    if (cur.pos >= cur.text.length) {
      abortAtEnd(cur, 'an object');
    }
    if (cur.text[cur.pos] !== ':') {
      throw new ParseAbort(
        diagnostic(
          cur.text,
          cur.pos,
          'error',
          'unexpected-token',
          `Expected \`:\` after the property name, found \`${cur.text[cur.pos]}\`.`,
          [...path, key],
        ),
        false,
      );
    }
    cur.pos++;

    const node = parseValue(cur, warnings, [...path, key]);
    entries.push({ key, node });

    skipWhitespace(cur);
    if (cur.pos >= cur.text.length) {
      abortAtEnd(cur, 'an object');
    }
    const char = cur.text[cur.pos];
    if (char === ',') {
      cur.pos++;
      skipWhitespace(cur);
      if (cur.pos >= cur.text.length) {
        abortAtEnd(cur, 'an object');
      }
      if (cur.text[cur.pos] === '}') {
        throw new ParseAbort(
          diagnostic(
            cur.text,
            cur.pos,
            'error',
            'unexpected-token',
            'JSON does not allow a trailing comma before `}`.',
            path,
          ),
          false,
        );
      }
      continue;
    }
    if (char === '}') {
      cur.pos++;
      return { kind: 'object', entries };
    }
    throw new ParseAbort(
      diagnostic(
        cur.text,
        cur.pos,
        'error',
        'unexpected-token',
        `Expected \`,\` or \`}\` here, found \`${char}\`.`,
        path,
      ),
      false,
    );
  }
}

/**
 * Parse JSON text into a `JsonNode`, preserving number literals and duplicate
 * keys, and reporting precise diagnostics.
 *
 * Never throws and never calls `eval`. An empty or whitespace-only document
 * fails with `incomplete: true`, because "nothing typed yet" is a pending
 * state rather than a mistake.
 */
export function parseJson(text: string): ParseResult {
  const warnings: JsonDiagnostic[] = [];
  const cur: Cursor = { text, pos: 0 };

  skipWhitespace(cur);
  if (cur.pos >= text.length) {
    return {
      ok: false,
      incomplete: true,
      diagnostics: [
        diagnostic(
          text,
          0,
          'error',
          'empty-document',
          'Nothing has been entered yet.',
        ),
      ],
    };
  }

  try {
    const root = parseValue(cur, warnings, []);
    skipWhitespace(cur);
    if (cur.pos < text.length) {
      return {
        ok: false,
        incomplete: false,
        diagnostics: [
          ...warnings,
          diagnostic(
            text,
            cur.pos,
            'error',
            'trailing-content',
            'There is extra content after the end of the JSON document.',
          ),
        ],
      };
    }
    return { ok: true, root, diagnostics: warnings };
  } catch (error) {
    if (error instanceof ParseAbort) {
      return {
        ok: false,
        incomplete: error.incomplete,
        diagnostics: [...warnings, error.diag],
      };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

const ESCAPE_MAP: Record<string, string> = {
  [QUOTE]: BACKSLASH + QUOTE,
  [BACKSLASH]: BACKSLASH + BACKSLASH,
  '\b': BACKSLASH + 'b',
  '\f': BACKSLASH + 'f',
  '\n': BACKSLASH + 'n',
  '\r': BACKSLASH + 'r',
  '\t': BACKSLASH + 't',
};

/** Quote and escape a string as a JSON string literal, including lone surrogates. */
export function quoteJsonString(value: string): string {
  let out = QUOTE;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    const code = value.charCodeAt(i);
    const mapped = ESCAPE_MAP[char];
    if (mapped !== undefined) {
      out += mapped;
    } else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) {
      // Control characters must be escaped; surrogates are escaped so that a
      // lone one survives transport intact rather than becoming U+FFFD.
      const isPaired =
        code <= 0xdbff &&
        i + 1 < value.length &&
        value.charCodeAt(i + 1) >= 0xdc00 &&
        value.charCodeAt(i + 1) <= 0xdfff;
      if (isPaired) {
        out += char;
      } else {
        out += BACKSLASH + 'u' + code.toString(16).padStart(4, '0');
      }
    } else {
      out += char;
    }
  }
  return out + QUOTE;
}

/**
 * Render a node back to JSON text. Number literals are emitted verbatim, so
 * `stringifyJson(parseJson(text).root)` is text-identical to `text` up to
 * whitespace for every document this parser accepts.
 *
 * @param indent spaces per level; `0` produces a single compact line.
 */
export function stringifyJson(node: JsonNode, indent = 2): string {
  const pad = indent > 0 ? ' '.repeat(indent) : '';
  const newline = indent > 0 ? '\n' : '';
  const colon = indent > 0 ? ': ' : ':';

  const render = (current: JsonNode, depth: number): string => {
    const here = indent > 0 ? pad.repeat(depth) : '';
    const inner = indent > 0 ? pad.repeat(depth + 1) : '';

    switch (current.kind) {
      case 'null':
        return 'null';
      case 'boolean':
        return current.value ? 'true' : 'false';
      case 'number':
        return current.literal;
      case 'string':
        return quoteJsonString(current.value);
      case 'array': {
        if (current.items.length === 0) {
          return '[]';
        }
        const parts = current.items.map(
          (item) => inner + render(item, depth + 1),
        );
        return '[' + newline + parts.join(',' + newline) + newline + here + ']';
      }
      case 'object': {
        if (current.entries.length === 0) {
          return '{}';
        }
        const parts = current.entries.map(
          (entry) =>
            inner +
            quoteJsonString(entry.key) +
            colon +
            render(entry.node, depth + 1),
        );
        return '{' + newline + parts.join(',' + newline) + newline + here + '}';
      }
    }
  };

  return render(node, 0);
}

/**
 * Convert a node to a plain JavaScript value.
 *
 * LOSSY BY DESIGN, and it says so: numbers beyond IEEE-754 range collapse to
 * their nearest double, and duplicate keys collapse to the last occurrence —
 * exactly what `JSON.parse` would have done. Use `stringifyJson` when the
 * document must survive intact; use this when a caller wants ordinary data.
 */
export function toPlainValue(node: JsonNode): unknown {
  switch (node.kind) {
    case 'null':
      return null;
    case 'boolean':
      return node.value;
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'array':
      return node.items.map(toPlainValue);
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const entry of node.entries) {
        out[entry.key] = toPlainValue(entry.node);
      }
      return out;
    }
  }
}

/** Build a node from a plain JavaScript value. Unsupported types become `null`. */
export function fromPlainValue(value: unknown): JsonNode {
  if (value === null || value === undefined) {
    return { kind: 'null' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { kind: 'null' };
    }
    return { kind: 'number', value, literal: String(value) };
  }
  if (typeof value === 'bigint') {
    return { kind: 'number', value: Number(value), literal: value.toString() };
  }
  if (typeof value === 'string') {
    return { kind: 'string', value };
  }
  if (Array.isArray(value)) {
    return { kind: 'array', items: value.map(fromPlainValue) };
  }
  if (typeof value === 'object') {
    const entries: JsonEntry[] = Object.keys(value as object).map((key) => ({
      key,
      node: fromPlainValue((value as Record<string, unknown>)[key]),
    }));
    return { kind: 'object', entries };
  }
  return { kind: 'null' };
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

/** Read the node at `path`, or `undefined` if the path does not resolve. */
export function nodeAt(root: JsonNode, path: JsonPath): JsonNode | undefined {
  let current: JsonNode | undefined = root;
  for (const step of path) {
    const here: JsonNode | undefined = current;
    if (here === undefined) {
      return undefined;
    }
    if (here.kind === 'array' && typeof step === 'number') {
      current = here.items[step];
    } else if (here.kind === 'object' && typeof step === 'string') {
      const hit: JsonEntry | undefined = here.entries.find(
        (entry: JsonEntry) => entry.key === step,
      );
      current = hit === undefined ? undefined : hit.node;
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Render a path as a JavaScript accessor expression — `$.users[0].name`.
 * This is the "copy path" payload.
 */
export function formatPath(path: JsonPath): string {
  let out = '$';
  for (const step of path) {
    if (typeof step === 'number') {
      out += '[' + String(step) + ']';
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(step)) {
      out += '.' + step;
    } else {
      out += '[' + quoteJsonString(step) + ']';
    }
  }
  return out;
}

/**
 * A stable, collision-free string id for a path. Used for DOM ids, `{{#each}}`
 * keys and the expansion set.
 *
 * The escaping is load-bearing: without it `['a', 'b']` and `['a.b']` both
 * render as `.a.b`, so two unrelated nodes would share one expansion state.
 */
export function pathKey(path: JsonPath): string {
  return path
    .map((step) =>
      typeof step === 'number'
        ? '#' + String(step)
        : '.' + step.replace(/[\\.#]/g, (char) => '\\' + char),
    )
    .join('');
}

/** The number of direct children a node has; `0` for scalars. */
export function childCount(node: JsonNode): number {
  if (node.kind === 'array') {
    return node.items.length;
  }
  if (node.kind === 'object') {
    return node.entries.length;
  }
  return 0;
}

/** TRUE for arrays and objects — the nodes that can be expanded. */
export function isContainer(node: JsonNode): boolean {
  return node.kind === 'array' || node.kind === 'object';
}

/* ------------------------------------------------------------------ *
 * Edit algebra — every operation is pure and returns a NEW root
 * ------------------------------------------------------------------ */

export interface EditResult {
  readonly root: JsonNode;
  /** Whether anything actually changed. A no-op must not push an undo frame. */
  readonly changed: boolean;
  /** Present when the operation was rejected or degraded. Never silent. */
  readonly diagnostics: ReadonlyArray<JsonDiagnostic>;
  /**
   * A short, past-tense sentence describing the change, for the polite live
   * region — "Added property colour" / "Removed item 3 of 5".
   */
  readonly announcement: string;
}

function ok(root: JsonNode, announcement: string): EditResult {
  return { root, changed: true, diagnostics: [], announcement };
}

function noop(root: JsonNode, announcement: string): EditResult {
  return { root, changed: false, diagnostics: [], announcement };
}

function rejected(
  root: JsonNode,
  code: DiagnosticCode,
  message: string,
  path: JsonPath,
): EditResult {
  return {
    root,
    changed: false,
    diagnostics: [
      { severity: 'error', code, message, offset: 0, line: 1, column: 1, path },
    ],
    announcement: message,
  };
}

/**
 * Rebuild the spine from `root` down to `path`, replacing the node there with
 * `make(existing)`. Structural sharing keeps untouched subtrees identical by
 * reference, which is what makes the undo stack cheap.
 */
function replaceAt(
  root: JsonNode,
  path: JsonPath,
  make: (existing: JsonNode) => JsonNode,
): JsonNode | undefined {
  if (path.length === 0) {
    return make(root);
  }
  const [step, ...rest] = path;

  if (root.kind === 'array' && typeof step === 'number') {
    const existing = root.items[step];
    if (existing === undefined) {
      return undefined;
    }
    const replacement = replaceAt(existing, rest, make);
    if (replacement === undefined) {
      return undefined;
    }
    const items = root.items.slice();
    items[step] = replacement;
    return { kind: 'array', items };
  }

  if (root.kind === 'object' && typeof step === 'string') {
    const index = root.entries.findIndex((entry) => entry.key === step);
    if (index < 0) {
      return undefined;
    }
    const replacement = replaceAt(root.entries[index]!.node, rest, make);
    if (replacement === undefined) {
      return undefined;
    }
    const entries = root.entries.slice();
    entries[index] = { key: step, node: replacement };
    return { kind: 'object', entries };
  }

  return undefined;
}

/** A neutral, non-destructive default value for each JSON type. */
export function emptyNodeOfKind(kind: JsonKind): JsonNode {
  switch (kind) {
    case 'null':
      return { kind: 'null' };
    case 'boolean':
      return { kind: 'boolean', value: false };
    case 'number':
      return { kind: 'number', value: 0, literal: '0' };
    case 'string':
      return { kind: 'string', value: '' };
    case 'array':
      return { kind: 'array', items: [] };
    case 'object':
      return { kind: 'object', entries: [] };
  }
}

/**
 * Interpret raw editor text as a value of `kind`.
 *
 * Returns `undefined` when the text cannot be read as that type — the caller
 * must then hold the edit as PENDING and show an error. It must never fall
 * back to a different type and must never discard the keystrokes, which is
 * exactly the failure mode of `Convert.stringToDataTypeValue` upstream.
 */
export function readScalar(kind: JsonKind, text: string): JsonNode | undefined {
  if (kind === 'string') {
    // Every possible text is a valid string, INCLUDING the empty one. An
    // empty string is a value, not a request to delete the property.
    return { kind: 'string', value: text };
  }
  if (kind === 'number') {
    const trimmed = text.trim();
    if (trimmed === '' || !NUMBER_PATTERN.test(trimmed)) {
      return undefined;
    }
    const match = NUMBER_PATTERN.exec(trimmed);
    if (!match || match[0] !== trimmed) {
      return undefined;
    }
    return { kind: 'number', value: Number(trimmed), literal: trimmed };
  }
  if (kind === 'boolean') {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === 'true') {
      return { kind: 'boolean', value: true };
    }
    if (trimmed === 'false') {
      return { kind: 'boolean', value: false };
    }
    return undefined;
  }
  if (kind === 'null') {
    return text.trim() === '' || text.trim().toLowerCase() === 'null'
      ? { kind: 'null' }
      : undefined;
  }
  return undefined;
}

/** Replace the value at `path` outright. */
export function setNode(
  root: JsonNode,
  path: JsonPath,
  next: JsonNode,
): EditResult {
  const updated = replaceAt(root, path, () => next);
  if (updated === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That value no longer exists.',
      path,
    );
  }
  return ok(updated, `Set ${formatPath(path)}.`);
}

/**
 * Change the TYPE of the value at `path`.
 *
 * Conversion preserves as much as it honestly can — `42` becomes `"42"`,
 * `"true"` becomes `true`, an object becomes an array of its values — and
 * where a conversion cannot preserve the content, the previous value stays on
 * the undo stack and the announcement says what was replaced. Nothing is
 * coerced behind the user's back.
 */
export function changeKind(
  root: JsonNode,
  path: JsonPath,
  kind: JsonKind,
): EditResult {
  const existing = nodeAt(root, path);
  if (existing === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That value no longer exists.',
      path,
    );
  }
  if (existing.kind === kind) {
    return noop(root, 'No change.');
  }

  const converted = convertNode(existing, kind);
  const updated = replaceAt(root, path, () => converted.node);
  if (updated === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That value no longer exists.',
      path,
    );
  }
  return {
    root: updated,
    changed: true,
    diagnostics: converted.lossy
      ? [
          {
            severity: 'warning',
            code: 'pending-value',
            message: `Changing ${formatPath(path)} from ${existing.kind} to ${kind} could not preserve the previous content. Undo restores it.`,
            offset: 0,
            line: 1,
            column: 1,
            path,
          },
        ]
      : [],
    announcement: `Changed ${formatPath(path)} to ${kind}.`,
  };
}

function convertNode(
  node: JsonNode,
  kind: JsonKind,
): { node: JsonNode; lossy: boolean } {
  if (kind === 'string') {
    switch (node.kind) {
      case 'string':
        return { node, lossy: false };
      case 'number':
        return { node: { kind: 'string', value: node.literal }, lossy: false };
      case 'boolean':
        return {
          node: { kind: 'string', value: String(node.value) },
          lossy: false,
        };
      case 'null':
        return { node: { kind: 'string', value: '' }, lossy: false };
      default:
        // Containers become their JSON text — reversible by hand, so not lost.
        return {
          node: { kind: 'string', value: stringifyJson(node, 0) },
          lossy: false,
        };
    }
  }

  if (kind === 'number') {
    if (node.kind === 'number') {
      return { node, lossy: false };
    }
    if (node.kind === 'string') {
      const read = readScalar('number', node.value);
      if (read) {
        return { node: read, lossy: false };
      }
    }
    if (node.kind === 'boolean') {
      return {
        node: {
          kind: 'number',
          value: node.value ? 1 : 0,
          literal: node.value ? '1' : '0',
        },
        lossy: false,
      };
    }
    return { node: emptyNodeOfKind('number'), lossy: true };
  }

  if (kind === 'boolean') {
    if (node.kind === 'boolean') {
      return { node, lossy: false };
    }
    if (node.kind === 'string') {
      const read = readScalar('boolean', node.value);
      if (read) {
        return { node: read, lossy: false };
      }
    }
    if (node.kind === 'number') {
      return {
        node: { kind: 'boolean', value: node.value !== 0 },
        lossy: false,
      };
    }
    return { node: emptyNodeOfKind('boolean'), lossy: true };
  }

  if (kind === 'null') {
    return { node: { kind: 'null' }, lossy: node.kind !== 'null' };
  }

  if (kind === 'array') {
    if (node.kind === 'array') {
      return { node, lossy: false };
    }
    if (node.kind === 'object') {
      // Keys are dropped, values kept — say so.
      return {
        node: { kind: 'array', items: node.entries.map((entry) => entry.node) },
        lossy: true,
      };
    }
    if (node.kind === 'null') {
      return { node: { kind: 'array', items: [] }, lossy: false };
    }
    return { node: { kind: 'array', items: [node] }, lossy: false };
  }

  // kind === 'object'
  if (node.kind === 'object') {
    return { node, lossy: false };
  }
  if (node.kind === 'array') {
    return {
      node: {
        kind: 'object',
        entries: node.items.map((item, index) => ({
          key: String(index),
          node: item,
        })),
      },
      lossy: false,
    };
  }
  if (node.kind === 'null') {
    return { node: { kind: 'object', entries: [] }, lossy: false };
  }
  return {
    node: { kind: 'object', entries: [{ key: 'value', node }] },
    lossy: false,
  };
}

/** Rename an object property, keeping its position in the key order. */
export function renameKey(
  root: JsonNode,
  parentPath: JsonPath,
  index: number,
  nextKey: string,
): EditResult {
  const parent = nodeAt(root, parentPath);
  if (parent === undefined || parent.kind !== 'object') {
    return rejected(
      root,
      'unexpected-token',
      'That object no longer exists.',
      parentPath,
    );
  }
  const entry = parent.entries[index];
  if (entry === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That property no longer exists.',
      parentPath,
    );
  }
  if (entry.key === nextKey) {
    return noop(root, 'No change.');
  }
  // An empty property name is legal JSON, so it is allowed here. What is NOT
  // allowed is silently overwriting a sibling.
  const clash = parent.entries.findIndex(
    (other, i) => i !== index && other.key === nextKey,
  );
  if (clash >= 0) {
    return rejected(
      root,
      'duplicate-key',
      `This object already has a property named "${nextKey}". Rename or remove that one first — renaming here would overwrite it.`,
      parentPath,
    );
  }

  const entries = parent.entries.slice();
  entries[index] = { key: nextKey, node: entry.node };
  const updated = replaceAt(root, parentPath, () => ({
    kind: 'object',
    entries,
  }));
  if (updated === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That object no longer exists.',
      parentPath,
    );
  }
  return ok(updated, `Renamed property ${entry.key} to ${nextKey}.`);
}

/** Append a new property to an object. The key must not already exist. */
export function addEntry(
  root: JsonNode,
  parentPath: JsonPath,
  key: string,
  node: JsonNode = { kind: 'null' },
): EditResult {
  const parent = nodeAt(root, parentPath);
  if (parent === undefined || parent.kind !== 'object') {
    return rejected(
      root,
      'unexpected-token',
      'That object no longer exists.',
      parentPath,
    );
  }
  if (parent.entries.some((entry) => entry.key === key)) {
    return rejected(
      root,
      'duplicate-key',
      `This object already has a property named "${key}".`,
      parentPath,
    );
  }
  const entries = [...parent.entries, { key, node }];
  const updated = replaceAt(root, parentPath, () => ({
    kind: 'object',
    entries,
  }));
  if (updated === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That object no longer exists.',
      parentPath,
    );
  }
  return ok(updated, `Added property ${key}.`);
}

/** Append a new item to an array. */
export function addItem(
  root: JsonNode,
  parentPath: JsonPath,
  node: JsonNode = { kind: 'null' },
): EditResult {
  const parent = nodeAt(root, parentPath);
  if (parent === undefined || parent.kind !== 'array') {
    return rejected(
      root,
      'unexpected-token',
      'That array no longer exists.',
      parentPath,
    );
  }
  const items = [...parent.items, node];
  const updated = replaceAt(root, parentPath, () => ({ kind: 'array', items }));
  if (updated === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That array no longer exists.',
      parentPath,
    );
  }
  return ok(updated, `Added item ${items.length} of ${items.length}.`);
}

/** Remove a property or item. This is the ONLY way anything gets deleted. */
export function removeAt(
  root: JsonNode,
  parentPath: JsonPath,
  index: number,
): EditResult {
  const parent = nodeAt(root, parentPath);
  if (parent === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That container no longer exists.',
      parentPath,
    );
  }

  if (parent.kind === 'array') {
    if (index < 0 || index >= parent.items.length) {
      return rejected(
        root,
        'unexpected-token',
        'That item no longer exists.',
        parentPath,
      );
    }
    const items = parent.items.slice();
    items.splice(index, 1);
    const updated = replaceAt(root, parentPath, () => ({
      kind: 'array',
      items,
    }));
    if (updated === undefined) {
      return rejected(
        root,
        'unexpected-token',
        'That array no longer exists.',
        parentPath,
      );
    }
    return ok(updated, `Removed item ${index + 1}. ${items.length} remaining.`);
  }

  if (parent.kind === 'object') {
    const entry = parent.entries[index];
    if (entry === undefined) {
      return rejected(
        root,
        'unexpected-token',
        'That property no longer exists.',
        parentPath,
      );
    }
    const entries = parent.entries.slice();
    entries.splice(index, 1);
    const updated = replaceAt(root, parentPath, () => ({
      kind: 'object',
      entries,
    }));
    if (updated === undefined) {
      return rejected(
        root,
        'unexpected-token',
        'That object no longer exists.',
        parentPath,
      );
    }
    return ok(
      updated,
      `Removed property ${entry.key}. ${entries.length} remaining.`,
    );
  }

  return rejected(
    root,
    'unexpected-token',
    'Only arrays and objects have children.',
    parentPath,
  );
}

/** Move an array item (or object property) from one position to another. */
export function moveChild(
  root: JsonNode,
  parentPath: JsonPath,
  from: number,
  to: number,
): EditResult {
  const parent = nodeAt(root, parentPath);
  if (parent === undefined) {
    return rejected(
      root,
      'unexpected-token',
      'That container no longer exists.',
      parentPath,
    );
  }

  const length = childCount(parent);
  if (from < 0 || from >= length) {
    return rejected(
      root,
      'unexpected-token',
      'That item no longer exists.',
      parentPath,
    );
  }
  const target = Math.max(0, Math.min(length - 1, to));
  if (target === from) {
    return noop(root, 'Already at the end of the list.');
  }

  if (parent.kind === 'array') {
    const items = parent.items.slice();
    const [moved] = items.splice(from, 1);
    items.splice(target, 0, moved!);
    const updated = replaceAt(root, parentPath, () => ({
      kind: 'array',
      items,
    }));
    if (updated === undefined) {
      return rejected(
        root,
        'unexpected-token',
        'That array no longer exists.',
        parentPath,
      );
    }
    return ok(
      updated,
      `Moved item from position ${from + 1} to ${target + 1} of ${length}.`,
    );
  }

  if (parent.kind === 'object') {
    const entries = parent.entries.slice();
    const [moved] = entries.splice(from, 1);
    entries.splice(target, 0, moved!);
    const updated = replaceAt(root, parentPath, () => ({
      kind: 'object',
      entries,
    }));
    if (updated === undefined) {
      return rejected(
        root,
        'unexpected-token',
        'That object no longer exists.',
        parentPath,
      );
    }
    return ok(
      updated,
      `Moved property ${moved!.key} from position ${from + 1} to ${target + 1} of ${length}.`,
    );
  }

  return rejected(
    root,
    'unexpected-token',
    'Only arrays and objects have children.',
    parentPath,
  );
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface JsonMatch {
  readonly path: JsonPath;
  /** Whether the hit was on the property name, the value, or both. */
  readonly where: 'key' | 'value' | 'both';
}

/** A short, single-line rendering of a node, for collapsed previews and search. */
export function previewOf(node: JsonNode, limit = 48): string {
  let text: string;
  switch (node.kind) {
    case 'null':
      text = 'null';
      break;
    case 'boolean':
      text = node.value ? 'true' : 'false';
      break;
    case 'number':
      text = node.literal;
      break;
    case 'string':
      text = node.value;
      break;
    case 'array':
      text =
        node.items.length === 1
          ? '1 item'
          : String(node.items.length) + ' items';
      break;
    case 'object':
      text =
        node.entries.length === 1
          ? '1 property'
          : String(node.entries.length) + ' properties';
      break;
  }
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/**
 * Find every node whose property name or scalar value contains `query`
 * (case-insensitive). Returns paths in document order.
 */
export function searchJson(
  root: JsonNode,
  query: string,
): ReadonlyArray<JsonMatch> {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const results: JsonMatch[] = [];

  const scalarText = (node: JsonNode): string | undefined => {
    switch (node.kind) {
      case 'null':
        return 'null';
      case 'boolean':
        return node.value ? 'true' : 'false';
      case 'number':
        return node.literal;
      case 'string':
        return node.value;
      default:
        return undefined;
    }
  };

  const walk = (
    node: JsonNode,
    path: JsonPath,
    key: string | undefined,
  ): void => {
    const keyHit = key !== undefined && key.toLowerCase().includes(needle);
    const text = scalarText(node);
    const valueHit = text !== undefined && text.toLowerCase().includes(needle);
    if (keyHit && valueHit) {
      results.push({ path, where: 'both' });
    } else if (keyHit) {
      results.push({ path, where: 'key' });
    } else if (valueHit) {
      results.push({ path, where: 'value' });
    }

    if (node.kind === 'array') {
      node.items.forEach((item, index) =>
        walk(item, [...path, index], undefined),
      );
    } else if (node.kind === 'object') {
      node.entries.forEach((entry) =>
        walk(entry.node, [...path, entry.key], entry.key),
      );
    }
  };

  walk(root, [], undefined);
  return results;
}

/** Every ancestor path of `path`, shortest first — what a search hit must expand. */
export function ancestorPaths(path: JsonPath): ReadonlyArray<JsonPath> {
  const out: JsonPath[] = [];
  for (let i = 0; i < path.length; i++) {
    out.push(path.slice(0, i));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Undo history
 * ------------------------------------------------------------------ */

/**
 * An immutable undo stack. Because every edit returns a new root with
 * structural sharing, a "snapshot" is just a root reference — so history
 * costs one pointer per step, not a deep clone.
 *
 * `limit` caps the stack so a long editing session cannot grow without bound.
 */
export class JsonHistory {
  readonly #limit: number;
  #past: JsonNode[] = [];
  #future: JsonNode[] = [];

  constructor(limit = 100) {
    this.#limit = Math.max(1, limit);
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get depth(): number {
    return this.#past.length;
  }

  /** Record the root as it was BEFORE an edit. Clears the redo branch. */
  push(previous: JsonNode): void {
    this.#past.push(previous);
    if (this.#past.length > this.#limit) {
      this.#past.shift();
    }
    this.#future = [];
  }

  /** Step back. `current` is the root being left, which becomes redoable. */
  undo(current: JsonNode): JsonNode | undefined {
    const previous = this.#past.pop();
    if (previous === undefined) {
      return undefined;
    }
    this.#future.push(current);
    return previous;
  }

  /** Step forward. `current` is the root being left, which becomes undoable. */
  redo(current: JsonNode): JsonNode | undefined {
    const next = this.#future.pop();
    if (next === undefined) {
      return undefined;
    }
    this.#past.push(current);
    return next;
  }

  clear(): void {
    this.#past = [];
    this.#future = [];
  }
}

/* ------------------------------------------------------------------ *
 * Flattening — the tree view's render list
 * ------------------------------------------------------------------ */

export interface FlatRow {
  readonly path: JsonPath;
  /** Stable id for DOM ids and `{{#each key=}}`. */
  readonly id: string;
  /** Property name, array index label, or `undefined` for the root. */
  readonly label: string | undefined;
  /** Index within the parent container; `-1` for the root. */
  readonly index: number;
  readonly parentPath: JsonPath;
  /** `pathKey` of the parent row, or `undefined` for the root. */
  readonly parentId: string | undefined;
  readonly node: JsonNode;
  /** ARIA level, 1-based. */
  readonly level: number;
  /** ARIA position among siblings, 1-based. */
  readonly posinset: number;
  /** ARIA sibling count, including any overflow notice row. */
  readonly setsize: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  /** TRUE when this row is a truncation notice rather than a value. */
  readonly overflow?: { shown: number; total: number };
}

export interface FlattenOptions {
  /** Paths (as `pathKey` strings) that are currently expanded. */
  readonly expanded: ReadonlySet<string>;
  /**
   * Maximum children rendered per container before truncating. Truncation,
   * not virtualization — virtualization needs measurement and this realm
   * forbids the timers that would drive it, and an honest "showing N of M"
   * beats a scroll position that lies.
   */
  readonly pageSize: number;
  /** Per-container overrides raising the window, keyed by `pathKey`. */
  readonly revealed?: ReadonlyMap<string, number>;
}

/**
 * Walk the document into the flat, ordered row list the treeview renders.
 * Only expanded containers contribute children, so the cost is proportional
 * to what is on screen.
 */
export function flattenJson(
  root: JsonNode,
  options: FlattenOptions,
): ReadonlyArray<FlatRow> {
  const rows: FlatRow[] = [];

  const visit = (
    node: JsonNode,
    path: JsonPath,
    parentPath: JsonPath,
    parentId: string | undefined,
    label: string | undefined,
    index: number,
    level: number,
    posinset: number,
    setsize: number,
  ): void => {
    const key = pathKey(path);
    const id = key === '' ? '$' : key;
    const expandable = isContainer(node) && childCount(node) > 0;
    const expanded = expandable && options.expanded.has(key);

    rows.push({
      path,
      id,
      label,
      index,
      parentPath,
      parentId,
      node,
      level,
      posinset,
      setsize,
      expandable,
      expanded,
    });

    if (!expanded) {
      return;
    }

    const total = childCount(node);
    const window = Math.max(options.pageSize, options.revealed?.get(key) ?? 0);
    const shown = Math.min(total, window);
    // The overflow notice is a focusable row, so it counts toward `setsize`.
    const siblings = shown < total ? shown + 1 : shown;

    if (node.kind === 'array') {
      for (let i = 0; i < shown; i++) {
        visit(
          node.items[i]!,
          [...path, i],
          path,
          id,
          String(i),
          i,
          level + 1,
          i + 1,
          siblings,
        );
      }
    } else if (node.kind === 'object') {
      for (let i = 0; i < shown; i++) {
        const entry = node.entries[i]!;
        visit(
          entry.node,
          [...path, entry.key],
          path,
          id,
          entry.key,
          i,
          level + 1,
          i + 1,
          siblings,
        );
      }
    }

    if (shown < total) {
      rows.push({
        path: [...path, '@@overflow'],
        id: id + '@@overflow',
        label: undefined,
        index: shown,
        parentPath: path,
        parentId: id,
        node: { kind: 'null' },
        level: level + 1,
        posinset: siblings,
        setsize: siblings,
        expandable: false,
        expanded: false,
        overflow: { shown, total },
      });
    }
  };

  visit(root, [], [], undefined, undefined, -1, 1, 1, 1);
  return rows;
}

/** Every container path in the document — what "expand all" needs. */
export function allContainerPaths(root: JsonNode): ReadonlyArray<string> {
  const out: string[] = [];
  const walk = (node: JsonNode, path: JsonPath): void => {
    if (isContainer(node) && childCount(node) > 0) {
      out.push(pathKey(path));
    }
    if (node.kind === 'array') {
      node.items.forEach((item, index) => walk(item, [...path, index]));
    } else if (node.kind === 'object') {
      node.entries.forEach((entry) => walk(entry.node, [...path, entry.key]));
    }
  };
  walk(root, []);
  return out;
}
