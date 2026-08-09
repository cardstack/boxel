// A tokenizer for the import and export surface of an ES module.
//
// Why this exists: every claim the system makes — this deck is hermetic,
// these two consumers share one copy, this is the dependency graph, these
// are the scopes — rests on one question, "what does this module import?".
// That question was answered with regexes over comment-stripped text, and in
// a single afternoon of running against real packages it was wrong five
// times, each time producing a silently WRONG dependency graph:
//
//   leaflet                    `export var Marker = Layer.extend({…})` ran
//                              through ten lines of comments and matched
//                              `from "Interactive layer"` in prose
//   standardized-audio-context a block comment documenting import syntax
//   several                    `//` inside a regex literal eating a line
//   highlight.js               an ESM entry over a CommonJS core
//   dayjs                      the same subpath in two different builds
//
// Regexes cannot be patched into correctness here; the problem is that they
// do not know what a string, a comment, or a regex literal is. This does.
//
// It is hand-written and zero-dependency for two reasons. es-module-lexer,
// the standard answer, is published as a 17 KB bundle with a wasm payload —
// it cannot be source-vendored by this very tool, and taking a wasm
// dependency on the identity path is worse than owning 300 lines. And the
// house already made this call once, for the canonical zip writer.
//
// Scope: it finds module specifiers and tells ESM from CommonJS. It is NOT a
// parser and does not build a syntax tree, because nothing here needs one.

export type SpecifierKind =
  | 'static-import' // import x from 'y' / import 'y'
  | 'static-export' // export … from 'y'
  | 'dynamic-import' // import('y')
  | 'import-meta-resolve'; // import.meta.resolve('y')

export interface FoundSpecifier {
  value: string;
  kind: SpecifierKind;
  // Byte offsets of the specifier's contents, exclusive of the quotes, so a
  // caller can rewrite in place without re-finding it.
  start: number;
  end: number;
}

export interface ModuleFacts {
  specifiers: FoundSpecifier[];
  /**
   * Byte offsets of `import(` calls whose argument is not a string literal.
   *
   * An edge the graph cannot see. Deck's preload closure claims to name
   * every URL a page will request, and L6 says a sealed deck reaches
   * nothing at runtime; one computed specifier makes both false without
   * making either look false. Embroider reached the same place from the
   * other direction — its macros refuse a non-literal argument outright
   * rather than guessing, and modern Embroider dropped ember-auto-import's
   * dynamic-import plugin instead of keeping a best-effort path.
   */
  unanalyzableDynamicImports: number[];
  // Any `import`/`export` declaration at all, including `export const x`.
  hasEsmSyntax: boolean;
  // `require(…)`, `module.exports`, `exports.foo`.
  hasCommonJs: boolean;
}

const WHITESPACE = new Set([' ', '\t', '\r', '\n', '\f', '\v', ' ']);

function isIdentifierPart(char: string): boolean {
  return /[\p{ID_Continue}$‌‍]/u.test(char);
}

function isIdentifierStart(char: string): boolean {
  return /[\p{ID_Start}$_]/u.test(char);
}

// After these, a `/` opens a regex literal. After anything else — an
// identifier, a literal, `)`, `]` — it is division. This is the standard
// heuristic and it is why `IMPORT_STATEMENT_REGEX = /…\/\/…/` no longer
// looks like the start of a comment.
const REGEX_MAY_FOLLOW_PUNCTUATION = new Set([
  '=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*',
  '%', '~', '^', '<', '>', '\n',
]);
const REGEX_MAY_FOLLOW_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

interface Cursor {
  source: string;
  index: number;
  // The last token that mattered for the regex-vs-division decision.
  lastToken: string;
}

function skipLineComment(cursor: Cursor): void {
  while (
    cursor.index < cursor.source.length &&
    cursor.source[cursor.index] !== '\n'
  ) {
    cursor.index++;
  }
}

function skipBlockComment(cursor: Cursor): void {
  cursor.index += 2;
  while (cursor.index < cursor.source.length) {
    if (
      cursor.source[cursor.index] === '*' &&
      cursor.source[cursor.index + 1] === '/'
    ) {
      cursor.index += 2;
      return;
    }
    cursor.index++;
  }
}

// Returns the contents of the string, or undefined if it is unterminated.
function readString(cursor: Cursor): { value: string; start: number; end: number } | undefined {
  let quote = cursor.source[cursor.index];
  let start = ++cursor.index;
  let value = '';
  while (cursor.index < cursor.source.length) {
    let char = cursor.source[cursor.index];
    if (char === '\\') {
      // Specifiers with escapes are vanishingly rare and always
      // pathological; keep the raw text so a rewrite stays faithful.
      value += char + (cursor.source[cursor.index + 1] ?? '');
      cursor.index += 2;
      continue;
    }
    if (char === quote) {
      let end = cursor.index;
      cursor.index++;
      return { value, start, end };
    }
    if (char === '\n' && quote !== '`') {
      return undefined; // an unterminated single-line string
    }
    value += char;
    cursor.index++;
  }
  return undefined;
}

function skipTemplate(cursor: Cursor): void {
  cursor.index++; // opening backtick
  while (cursor.index < cursor.source.length) {
    let char = cursor.source[cursor.index];
    if (char === '\\') {
      cursor.index += 2;
      continue;
    }
    if (char === '`') {
      cursor.index++;
      return;
    }
    if (char === '$' && cursor.source[cursor.index + 1] === '{') {
      // A substitution can contain anything, including nested templates and
      // strings. Track brace depth through the normal scanner rules.
      cursor.index += 2;
      let depth = 1;
      while (cursor.index < cursor.source.length && depth > 0) {
        let inner = cursor.source[cursor.index];
        if (inner === '{') {
          depth++;
          cursor.index++;
        } else if (inner === '}') {
          depth--;
          cursor.index++;
        } else if (inner === '`') {
          skipTemplate(cursor);
        } else if (inner === '"' || inner === "'") {
          if (!readString(cursor)) {
            cursor.index++;
          }
        } else if (inner === '/' && cursor.source[cursor.index + 1] === '/') {
          skipLineComment(cursor);
        } else if (inner === '/' && cursor.source[cursor.index + 1] === '*') {
          skipBlockComment(cursor);
        } else {
          cursor.index++;
        }
      }
      continue;
    }
    cursor.index++;
  }
}

function skipRegex(cursor: Cursor): void {
  cursor.index++; // opening slash
  let inClass = false;
  while (cursor.index < cursor.source.length) {
    let char = cursor.source[cursor.index];
    if (char === '\\') {
      cursor.index += 2;
      continue;
    }
    if (char === '[') {
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    } else if (char === '/' && !inClass) {
      cursor.index++;
      while (
        cursor.index < cursor.source.length &&
        isIdentifierPart(cursor.source[cursor.index])
      ) {
        cursor.index++; // flags
      }
      return;
    } else if (char === '\n') {
      return; // unterminated; do not run away
    }
    cursor.index++;
  }
}

function regexMayFollow(lastToken: string): boolean {
  if (lastToken === '') {
    return true; // start of input
  }
  return (
    REGEX_MAY_FOLLOW_PUNCTUATION.has(lastToken) ||
    REGEX_MAY_FOLLOW_KEYWORD.has(lastToken)
  );
}

function skipTrivia(cursor: Cursor): void {
  while (cursor.index < cursor.source.length) {
    let char = cursor.source[cursor.index];
    if (WHITESPACE.has(char)) {
      cursor.index++;
      continue;
    }
    if (char === '/' && cursor.source[cursor.index + 1] === '/') {
      skipLineComment(cursor);
      continue;
    }
    if (char === '/' && cursor.source[cursor.index + 1] === '*') {
      skipBlockComment(cursor);
      continue;
    }
    return;
  }
}

// From just past `import` or `export`, walk the clause and return the
// string that follows `from` — or, for a bare `import 'x'`, the string that
// follows directly. Returns undefined when the statement has no specifier,
// which is the case for `export const x = 1` and for `import.meta`.
function readDeclarationSpecifier(
  cursor: Cursor,
  isExport: boolean,
): { value: string; start: number; end: number } | undefined {
  let depth = 0;
  while (cursor.index < cursor.source.length) {
    skipTrivia(cursor);
    let char = cursor.source[cursor.index];
    if (char === undefined) {
      return undefined;
    }
    if (char === '{') {
      depth++;
      cursor.index++;
      continue;
    }
    if (char === '}') {
      depth--;
      cursor.index++;
      continue;
    }
    if (char === '"' || char === "'") {
      // `import 'side-effect.js'` and the string after `from` both land here.
      // Inside braces a string can only be an arbitrary module-export name
      // (`export { "a-b" as c } from 'y'`), which is not a specifier.
      if (depth > 0) {
        readString(cursor);
        continue;
      }
      // An EXPORT only has a specifier after `from`, and that case is
      // handled where `from` is read. A bare string here is therefore a
      // value, not a module — `export default 'ffffffff-…'` in uuid was
      // being reported as a dependency on a package named after a UUID,
      // which then failed the hermeticity check for a reason that did not
      // exist. `import` is different: `import 'side-effect.js'` is real.
      if (isExport) {
        return undefined;
      }
      return readString(cursor);
    }
    if (char === ';') {
      return undefined; // `export {}` / `import x` with no source
    }
    if (char === '=' || char === '(') {
      // `export default foo(…)`, `export const x = …`: not a re-export.
      return undefined;
    }
    if (isIdentifierStart(char)) {
      let start = cursor.index;
      while (
        cursor.index < cursor.source.length &&
        isIdentifierPart(cursor.source[cursor.index])
      ) {
        cursor.index++;
      }
      let word = cursor.source.slice(start, cursor.index);
      if (depth === 0 && word === 'from') {
        skipTrivia(cursor);
        let quote = cursor.source[cursor.index];
        return quote === '"' || quote === "'" ? readString(cursor) : undefined;
      }
      // A declaration keyword means this export declares something rather
      // than re-exporting: stop before running into unrelated code.
      if (
        depth === 0 &&
        isExport &&
        // `default` belongs here for the same reason as the rest: whatever
        // follows it is a value. `export { default } from 'x'` is inside
        // braces, so it never reaches this branch.
        ['const', 'let', 'var', 'function', 'class', 'async', 'default'].includes(
          word,
        )
      ) {
        return undefined;
      }
      continue;
    }
    if (char === '\n' && depth === 0) {
      // A newline outside braces ends the search unless a `from` could still
      // follow on the next line; keep going but do not cross a statement.
      cursor.index++;
      continue;
    }
    cursor.index++;
  }
  return undefined;
}

export function lexModule(source: string): ModuleFacts {
  let cursor: Cursor = { source, index: 0, lastToken: '' };
  let specifiers: FoundSpecifier[] = [];
  let unanalyzable: number[] = [];
  let hasEsmSyntax = false;
  let hasCommonJs = false;

  while (cursor.index < source.length) {
    let char = source[cursor.index];

    if (WHITESPACE.has(char)) {
      if (char === '\n') {
        cursor.lastToken = '\n';
      }
      cursor.index++;
      continue;
    }
    if (char === '/' && source[cursor.index + 1] === '/') {
      skipLineComment(cursor);
      continue;
    }
    if (char === '/' && source[cursor.index + 1] === '*') {
      skipBlockComment(cursor);
      continue;
    }
    if (char === '"' || char === "'") {
      if (!readString(cursor)) {
        cursor.index++;
      }
      cursor.lastToken = 'string';
      continue;
    }
    if (char === '`') {
      skipTemplate(cursor);
      cursor.lastToken = 'string';
      continue;
    }
    if (char === '/') {
      if (regexMayFollow(cursor.lastToken)) {
        skipRegex(cursor);
        cursor.lastToken = 'regex';
      } else {
        cursor.index++;
        cursor.lastToken = '/';
      }
      continue;
    }
    if (isIdentifierStart(char)) {
      let start = cursor.index;
      while (
        cursor.index < source.length &&
        isIdentifierPart(source[cursor.index])
      ) {
        cursor.index++;
      }
      let word = source.slice(start, cursor.index);

      // A keyword only starts a declaration at the head of a statement.
      // `foo.import` and `obj.export` are property accesses.
      let precededByDot = cursor.lastToken === '.';

      if (!precededByDot && (word === 'import' || word === 'export')) {
        let after = { ...cursor };
        skipTrivia(after);
        let next = source[after.index];

        if (word === 'import' && next === '(') {
          after.index++;
          skipTrivia(after);
          let quote = source[after.index];
          let literal =
            quote === '"' || quote === "'" ? readString(after) : undefined;
          // A string is only the WHOLE argument if the call ends there.
          //
          // `import('./locales/' + lang)` opens with a quote and is not a
          // literal import at all. Recording `./locales/` would be worse
          // than recording nothing: the graph gains an edge to a module
          // that does not exist, the preload closure fetches it, and the
          // import the code actually performs still goes somewhere the
          // graph never saw. A phantom edge and a missing edge out of one
          // mistake.
          //
          // A comma is fine — those are import attributes, as in
          // `import('./x.json', { with: { type: 'json' } })`.
          let whole = false;
          if (literal) {
            let tail = { ...after };
            skipTrivia(tail);
            let punctuation = source[tail.index];
            whole = punctuation === ')' || punctuation === ',';
          }
          if (literal && whole) {
            specifiers.push({ ...literal, kind: 'dynamic-import' });
          } else {
            // `import(expr)` — an edge the graph cannot see.
            //
            // Recording it matters more than it looks. Everything Deck
            // promises about a sealed tree assumes the graph is knowable
            // from the bytes: the preload closure claims to name every URL
            // the page will ask for, and L6 says a sealed deck reaches
            // nothing at runtime. One computed specifier makes both claims
            // false, and quietly — the closure is still advertised, merely
            // short, and the module fetches from wherever the expression
            // happens to evaluate.
            //
            // So it is not skipped. It is counted, and something upstream
            // is given the chance to refuse.
            unanalyzable.push(start);
          }
          cursor.lastToken = word;
          continue;
        }
        if (word === 'import' && next === '.') {
          // import.meta — and possibly import.meta.resolve('x').
          let probe = { ...after };
          probe.index++;
          skipTrivia(probe);
          let metaStart = probe.index;
          while (probe.index < source.length && isIdentifierPart(source[probe.index])) {
            probe.index++;
          }
          if (source.slice(metaStart, probe.index) === 'meta') {
            hasEsmSyntax = true;
            skipTrivia(probe);
            if (source[probe.index] === '.') {
              probe.index++;
              skipTrivia(probe);
              let callStart = probe.index;
              while (
                probe.index < source.length &&
                isIdentifierPart(source[probe.index])
              ) {
                probe.index++;
              }
              if (source.slice(callStart, probe.index) === 'resolve') {
                skipTrivia(probe);
                if (source[probe.index] === '(') {
                  probe.index++;
                  skipTrivia(probe);
                  let quote = source[probe.index];
                  if (quote === '"' || quote === "'") {
                    let found = readString(probe);
                    if (found) {
                      specifiers.push({
                        ...found,
                        kind: 'import-meta-resolve',
                      });
                    }
                  }
                }
              }
            }
          }
          cursor.lastToken = word;
          continue;
        }

        hasEsmSyntax = true;
        let declaration = { ...cursor };
        let found = readDeclarationSpecifier(declaration, word === 'export');
        if (found) {
          specifiers.push({
            ...found,
            kind: word === 'import' ? 'static-import' : 'static-export',
          });
          cursor.index = declaration.index;
        }
        cursor.lastToken = word;
        continue;
      }

      if (!precededByDot && word === 'require') {
        let after = { ...cursor };
        skipTrivia(after);
        if (source[after.index] === '(') {
          hasCommonJs = true;
        }
      }
      if (word === 'exports' && !precededByDot) {
        hasCommonJs = true;
      }
      // `!precededByDot` for the same reason as `require` and `exports`
      // above: `foo.module.exports` is a property chain on somebody's object,
      // not the CommonJS one. And the tail has to end on an identifier
      // boundary, or `module.exportsFoo` reads as `module.exports`.
      if (!precededByDot && word === 'module') {
        let after = { ...cursor };
        skipTrivia(after);
        if (source[after.index] === '.') {
          after.index++;
          skipTrivia(after);
          let start = after.index;
          while (
            after.index < source.length &&
            isIdentifierPart(source[after.index])
          ) {
            after.index++;
          }
          if (source.slice(start, after.index) === 'exports') {
            hasCommonJs = true;
          }
        }
      }
      cursor.lastToken = word;
      continue;
    }

    cursor.lastToken = char;
    cursor.index++;
  }

  return { specifiers, unanalyzableDynamicImports: unanalyzable, hasEsmSyntax, hasCommonJs };
}

// The two questions the rest of the system actually asks.

export function moduleSpecifiers(source: string): string[] {
  return [...new Set(lexModule(source).specifiers.map((s) => s.value))];
}

export function isCommonJsModule(source: string): boolean {
  let facts = lexModule(source);
  return facts.hasCommonJs && !facts.hasEsmSyntax;
}

/**
 * Offsets of `import()` calls this module cannot resolve statically.
 *
 * Empty means the module's edges are all knowable, which is the
 * precondition for every graph claim Deck makes about it.
 */
export function unanalyzableDynamicImports(source: string): number[] {
  return lexModule(source).unanalyzableDynamicImports;
}
