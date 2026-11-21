// Lowers the query grammar's newer spellings to the JSON the engine runs
// (spec: docs/search.md, "Compatibility: older and newer spellings").
// `lowerQuery` is synchronous and needs nothing but the query.
import { mapMeasure } from './query-labels.ts';
import { refuse, refusalText } from './query-refusals.ts';
import { internBindingReferences } from './binding-reference.ts';
import { grammarMembers, newerSpellingMarkers } from '../query-grammar.ts';
import { InvalidQueryError } from '../invalid-query-error.ts';
import { INTERNAL_SORT_KEYS } from '../internal-sort-keys.ts';
import { unknownBxlFunctions } from '@cardstack/bxl/compiler';
import {
  assertQueryExpressionProfile,
  checkExpressionSql,
} from './query-expression.ts';
import type { CodeRef } from '../code-ref.ts';
import {
  resolveTypeReferences,
  type TypeReferenceContext,
} from './type-reference.ts';

export interface LoweringNotes {
  // Quoted labels by lowered name, so an error can quote what was written.
  quotedLabels?: Record<string, string>;
}

export interface LoweredQuery {
  query: Record<string, any>;
  notes: LoweringNotes;
}

const FILTER_OPERATORS = new Set(
  grammarMembers('filter', (m) => m.role === 'operator'),
);
// Sort keys that are not card fields and need no type.
export const GENERAL_SORTS = new Set(['lastModified', 'createdAt', 'cardURL']);
export const PATH_OPS = [
  'eq',
  'in',
  'range',
  'contains',
  'near',
  'pattern',
  'regex',
] as const;
// An expression sort entry's `top`: its default window, and the most allowed.
export const DEFAULT_RERANK_TOP = 100;
export const MAX_RERANK_TOP = 500;
// The request grammar's text score; the engine calls it `_matchRelevance`.
export const TEXT_RELEVANCE = 'textRelevance';

export const isObject = (v: unknown): v is Record<string, any> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

// Sets an own data property: assigning `__proto__` would set the prototype,
// and the member would vanish instead of being read (and refused).
export function setOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

// Own members only, so inherited names (`constructor`, `__proto__`) miss.
export function hasOwn(record: unknown, key: string): boolean {
  return (
    record != null &&
    typeof record === 'object' &&
    Object.prototype.hasOwnProperty.call(record, key)
  );
}

// Max nesting of objects and lists, counting the query itself; a filter of
// `every`, `any` or `not` takes 1-2 levels each, so about 250 deep.
export const MAX_QUERY_DEPTH = 512;

// A `let` binding's `from` that names a log: its filter is a log filter,
// which the card grammar's spellings never rewrite.
function isLogBindingFrom(from: unknown): boolean {
  return (
    typeof from === 'object' &&
    from !== null &&
    !Array.isArray(from) &&
    ('log' in from || 'logs' in from)
  );
}
// A query in the older spelling is held only short of where a reader would
// overflow (a filter of `every` about 1,000 deep was read; 2,000 was not).
export const MAX_OLDER_QUERY_DEPTH = 2_048;

// A lone surrogate or a null byte: text no database column can store, so
// a value or a name holding one can never match and is refused as written.
export const UNSTORABLE_TEXT =
  // eslint-disable-next-line no-control-regex
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A query is plain JSON data (finite numbers, at most maxDepth deep, no text
// a database cannot store), checked once before anything walks it: a
// function, getter, cycle or throwing proxy is refused with a code rather
// than crashing a reader or reading one way when checked, another when run.
// `undefined` reads as absent. Iterative, so too deep is refused, not fatal.
export function assertPlainQueryData(
  query: unknown,
  maxDepth = MAX_QUERY_DEPTH,
): void {
  try {
    checkPlainData(query, maxDepth);
  } catch (e) {
    if (e instanceof InvalidQueryError) throw e;
    throw refuse('query-not-plain-json', undefined, {
      e: String((e as Error)?.message ?? e).slice(0, 80),
    });
  }
}

function checkPlainData(root: unknown, maxDepth: number): void {
  type Item = { value: unknown; depth: number; at: string } | { exit: object };
  let stack: Item[] = [{ value: root, depth: 0, at: '' }];
  let ancestors = new Set<object>();
  let text = (s: string, at: string, what: string) => {
    if (UNSTORABLE_TEXT.test(s)) {
      throw refuse('holds-null-character-lone', at || '/', { what });
    }
  };
  while (stack.length) {
    let item = stack.pop()!;
    if ('exit' in item) {
      ancestors.delete(item.exit);
      continue;
    }
    let { value, depth, at } = item;
    switch (typeof value) {
      case 'undefined':
      case 'boolean':
        continue;
      case 'string':
        text(value, at, 'a value');
        continue;
      case 'number':
        if (!Number.isFinite(value)) {
          throw refuse('not-number-query-can', at || '/', {
            value: String(value),
          });
        }
        continue;
      case 'object':
        break;
      default:
        throw refuse('not-json-data-query', at || '/', {
          value: typeof value,
        });
    }
    if (value === null) continue;
    let node = value as object;
    if (depth >= maxDepth) {
      throw refuse('query-nests-more-than', at.slice(0, 60) || '/', {
        maxDepth,
      });
    }
    if (ancestors.has(node)) throw refuse('query-contains-itself', at || '/');
    let isList = Array.isArray(node);
    if (!isList) {
      // any realm's plain object: proto null, or one whose own proto is null
      let proto = Object.getPrototypeOf(node);
      if (proto !== null && Object.getPrototypeOf(proto) !== null) {
        throw refuse('not-json-data-query-2', at || '/', {
          object: proto?.constructor?.name ?? 'an object',
        });
      }
    }
    ancestors.add(node);
    stack.push({ exit: node });
    let keys = Reflect.ownKeys(node);
    let length = isList ? (node as unknown[]).length : 0;
    let seen = 0;
    for (let key of keys) {
      if (typeof key === 'symbol') {
        throw refuse('member-named-symbol-not', at || '/');
      }
      if (isList && key === 'length') continue;
      let descriptor = Object.getOwnPropertyDescriptor(node, key)!;
      if (isList) {
        let index = Number(key);
        if (!(Number.isInteger(index) && index >= 0 && String(index) === key)) {
          throw refuse('list-with-member-not', at || '/', {
            key: key.slice(0, 40),
          });
        }
        seen++;
      } else if (!descriptor.enumerable) {
        continue;
      }
      if (!('value' in descriptor)) {
        throw refuse('member-read-through-getter', at || '/', {
          key: key.slice(0, 40),
        });
      }
      if (!isList) text(key, at, 'a member name');
      stack.push({
        value: descriptor.value,
        depth: depth + 1,
        at: `${at}/${key.slice(0, 40)}`,
      });
    }
    if (isList && seen !== length) {
      throw refuse('list-with-holes-not', at || '/');
    }
  }
}

// Labels the lowering in progress quoted, so an error can quote them as
// written (lowerQuery is synchronous: set for one call, then cleared).
let quoted: Record<string, string> | undefined;

// A field path as the engine reads it: no `item.`, no surrounding quotes.
export function barePath(path: string): string {
  let p = path.startsWith('item.') ? path.slice(5) : path;
  if (p.length > 1 && p.startsWith('"') && p.endsWith('"')) {
    // a quoted label reads as a field name: "Units Sold 30d" → unitsSold30d;
    // a dot steps through a field: "Brand.Name" → brand.name
    let label = p.slice(1, -1);
    let nameOf = (part: string) =>
      part
        .trim()
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w, i) =>
          i === 0
            ? w.charAt(0).toLowerCase() + w.slice(1)
            : w.charAt(0).toUpperCase() + w.slice(1),
        )
        .join('');
    let segments = label.split('.').map(nameOf);
    let name = segments.every(Boolean) ? segments.join('.') : nameOf(label);
    if (quoted) setOwn(quoted, name, label);
    return name;
  }
  return p;
}

// Whether a query uses any newer spelling. Never throws and never recurses:
// a query too deep or not plain data reads as the older spelling and is
// refused by the checks that read it next.
export function usesNewSyntax(query: unknown): boolean {
  try {
    return newSyntaxIn(query, 0);
  } catch {
    return false;
  }
}

// Members Query V2 added to main's grammar: any of them makes a query the
// newer spelling, read strictly as a whole (ADR 022 §1.7). Named, never
// "anything else": main ignored, and still ignores, unknown members of a
// filter node, sort entry or `page`. A top-level `type` is checked first.
const NEWER_TOP_MEMBERS = newerSpellingMarkers('query').filter(
  (k) => k !== 'type',
);
const NEWER_PAGE_MEMBERS = newerSpellingMarkers('page');
const NEWER_FILTER_MEMBERS = newerSpellingMarkers('filter');
// A sort entry's own (`near` and `missing` are not markers: see the table).
const NEWER_SORT_MEMBERS = newerSpellingMarkers('sortEntry');

function newSyntaxIn(query: unknown, bindingDepth: number): boolean {
  if (!isObject(query)) return false;
  if ('type' in query) return true;
  // The engine's own form (what lowering yields) carries a `rerank`, which
  // no author may write: it is read as it is, never lowered again.
  if ('rerank' in query) return false;
  if (NEWER_TOP_MEMBERS.some((k) => k in query)) return true;
  if (
    isObject(query.page) &&
    NEWER_PAGE_MEMBERS.some((k) => k in (query.page as object))
  ) {
    return true;
  }
  let filters: unknown[] = [query.filter];
  let steps = 0;
  while (filters.length) {
    let n = filters.pop();
    if (++steps > 1_000_000) return false;
    if (!isObject(n)) continue;
    if (NEWER_FILTER_MEMBERS.some((k) => k in (n as object))) return true;
    // main's `matches` took a string only
    if ('matches' in n && typeof n.matches !== 'string') return true;
    // a bare anchor: every card of the type
    if (Object.keys(n).length === 1 && 'on' in n) return true;
    for (let k of ['every', 'any'])
      if (Array.isArray(n[k])) filters.push(...n[k]);
    if (n.not) filters.push(n.not);
  }
  let signal = (s: any): boolean =>
    isObject(s) &&
    (NEWER_SORT_MEMBERS.some((k) => k in s) ||
      s.by === TEXT_RELEVANCE ||
      s.by === `item.${TEXT_RELEVANCE}` ||
      (Array.isArray(s.blend) && s.blend.some(signal)));
  for (let s of Array.isArray(query.sort) ? query.sort : []) {
    if (signal(s)) return true;
  }
  let spelled = (p: unknown) =>
    typeof p === 'string' && (p.startsWith('item.') || p.startsWith('"'));
  let values: unknown[] = [
    query.filter,
    query.sort,
    { collapse: query.collapse },
    query.facets,
  ];
  while (values.length) {
    let v = values.pop();
    if (++steps > 1_000_000) return false;
    if (v == null || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      values.push(...v);
      continue;
    }
    for (let [k, x] of Object.entries(v)) {
      if ((PATH_OPS as readonly string[]).includes(k) && isObject(x)) {
        if (Object.keys(x).some(spelled)) return true;
      } else if ((k === 'by' || k === 'collapse') && spelled(x)) {
        return true;
      } else if (k !== 'on' && k !== 'type') values.push(x);
    }
  }
  if (isObject(query.let) && bindingDepth < 2) {
    // A binding read from a log holds a log query, which no spelling lowers.
    return Object.values(query.let).some(
      (b) =>
        isObject(b) &&
        !isLogBindingFrom(b.from) &&
        newSyntaxIn(b.from, bindingDepth + 1),
    );
  }
  return false;
}

// Refuses with `mixed-spelling` (and the rewrite) an author's query in the
// newer spelling that names its type the older way: an `on` on its top
// filter node and no top-level `type`. Called where an author's query first
// arrives (host searches, the AI search tools, a query-backed field), not on
// the server: the engine form it receives has `on` everywhere (ADR 022 §1.4,
// §1.7). A bare `{ on }` or an `on` anchoring one node is newer spelling.
export const MIXED_SPELLING = 'mixed-spelling';
export function assertAuthoredQuerySpelling(
  query: unknown,
  where = 'query',
): void {
  if (!isObject(query) || !usesNewSyntax(query)) return;
  let check = (q: Record<string, any>, at: string, depth: number) => {
    let anchor = 'type' in q ? undefined : olderAnchorIn(q);
    if (anchor) {
      throw refuse('type-anchored-with-on', at, {
        path: anchor.path,
        newer: newerMemberIn(q),
        on: JSON.stringify(anchor.on),
      });
    }
    if (isObject(q.let) && depth < 2) {
      for (let [name, b] of Object.entries(q.let)) {
        if (isObject(b) && isObject(b.from) && !isLogBindingFrom(b.from)) {
          check(b.from, `${at}: let.${name}.from`, depth + 1);
        }
      }
    }
  };
  check(query, where, 0);
}

// The older way to name the type: an `on` on the top filter node, which
// anchors the whole query, as a top-level `type` does. An `on` elsewhere
// anchors only its own part and is newer spelling too.
function olderAnchorIn(
  q: Record<string, any>,
): { path: string; on: unknown } | undefined {
  let f = q.filter;
  if (isObject(f) && 'on' in f && Object.keys(f).length > 1) {
    return { path: 'filter.on', on: f.on };
  }
  return undefined;
}

// The first member that makes a query the newer spelling, for a message.
function newerMemberIn(q: Record<string, any>): string {
  let top = NEWER_TOP_MEMBERS.find((k) => k in q);
  if (top) return `"${top}"`;
  if (isObject(q.page)) {
    let p = NEWER_PAGE_MEMBERS.find((k) => k in (q.page as object));
    if (p) return `"page.${p}"`;
  }
  return 'a newer member';
}

// One facet per field (`meta.facets` answers by field), so facets on one
// `by` combine their options. An option given two values is refused, since
// which won would depend on write order. Returns the facets, each field's
// merged into its first place.
export function assertDistinctFacets(
  facets: unknown[],
  where = 'facets',
): unknown[] {
  let merged = new Map<string, Record<string, unknown>>();
  let out: unknown[] = [];
  facets.forEach((facet, i) => {
    if (!isObject(facet) || typeof facet.by !== 'string') {
      out.push(facet);
      return;
    }
    let by = facet.by.startsWith('item.') ? facet.by.slice(5) : facet.by;
    let before = merged.get(by);
    if (!before) {
      let first = { ...facet };
      merged.set(by, first);
      out.push(first);
      return;
    }
    for (let [key, value] of Object.entries(facet)) {
      if (key === 'by') continue;
      if (
        key in before &&
        JSON.stringify(sortedKeys(before[key])) !==
          JSON.stringify(sortedKeys(value))
      ) {
        throw refuse('another-facet-gives-another', where, { i, by, key });
      }
      setOwn(before, key, value);
    }
  });
  return out;
}

// Whether two type references name the same type, in any member order.
export function sameTypeRef(a: unknown, b: unknown): boolean {
  if (!isObject(a) || !isObject(b)) return a === b;
  if ('type' in a || 'type' in b) {
    return JSON.stringify(sortedKeys(a)) === JSON.stringify(sortedKeys(b));
  }
  return a.module === b.module && a.name === b.name;
}

function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (!isObject(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, sortedKeys(v[k])]),
  );
}

function lowerFilter(node: any, type: CodeRef | undefined): any {
  if (!isObject(node)) return node;
  let keys = Object.keys(node);
  // a bare anchor is every card of the type, as everywhere else
  if (keys.length === 1 && keys[0] === 'on') return { type: node.on };
  let out: Record<string, any> = {};
  for (let [k, v] of Object.entries(node)) {
    if (k === 'every' || k === 'any') {
      out[k] = Array.isArray(v) ? v.map((n) => lowerFilter(n, type)) : v;
    } else if (k === 'not') {
      out[k] = lowerFilter(v, type);
    } else if ((PATH_OPS as readonly string[]).includes(k) && isObject(v)) {
      out[k] = Object.fromEntries(
        Object.entries(v).map(([p, x]) => [barePath(p), x]),
      );
    } else if (k === 'exists' || k === 'missing') {
      if (typeof v !== 'string') {
        throw refuse('filter-takes-field-path', undefined, { k });
      }
      // one operator per filter node, as everywhere in the grammar
      let others = Object.keys(node).filter(
        (key) => key !== k && key !== 'on' && key !== 'type',
      );
      let operators = others.filter((key) => FILTER_OPERATORS.has(key));
      if (operators.length) {
        throw refuse('filter-operator-own-combine', undefined, {
          k,
          operators: operators[0],
        });
      }
      let test = { eq: { [barePath(v)]: null } };
      let lowered = k === 'missing' ? test : { not: test };
      // Non-operator members stay beside the test, so the filter's own check
      // refuses them as anywhere (unknown-key, or conflicting-members).
      let rest = Object.fromEntries(
        others.map((key) => [key, (node as Record<string, any>)[key]]),
      );
      return node.on
        ? { on: node.on, ...lowered, ...rest }
        : { ...lowered, ...rest };
    } else if (k === 'fields' && Array.isArray(v)) {
      out[k] = v.map((p) => (typeof p === 'string' ? barePath(p) : p));
    } else if (k === 'within' && typeof v === 'string') {
      out[k] = barePath(v);
    } else {
      setOwn(out, k, v);
    }
  }
  return out;
}

// A `_when` (or boost) filter carries the type at its top, as today.
function anchored(filter: any, type: CodeRef | undefined): any {
  let f = lowerFilter(filter, type);
  return type && isObject(f) && !('on' in f) && !('type' in f)
    ? { on: type, ...f }
    : f;
}

function lowerSignal(
  entry: any,
  type: CodeRef | undefined,
  knownFunctions?: ReadonlySet<string>,
): any {
  if (!isObject(entry)) return entry;
  if ('boost' in entry) {
    let { boost, ...rest } = entry;
    let when = isObject(boost) && 'when' in boost ? boost.when : boost;
    return { by: '_when', ...rest, when: anchored(when, type) };
  }
  if ('formula' in entry) throw misnamedFormula('sort', 'formula');
  if ('expression' in entry) {
    let { expression: formula, ...rest } = entry;
    assertExpressionText('expression', formula);
    assertQueryExpressionProfile('expression', formula);
    // a blend ranks every match by each signal: only the first entry windows
    for (let key of ['top', 'compare', 'placement']) {
      if (key in rest) {
        throw key === 'placement'
          ? refuse('placement-not-a-key')
          : refuse('blend-signal-takes-no-window', undefined, { key });
      }
    }
    assertExpressionInSql(formula, knownFunctions);
    return { by: '_expr', expr: formula, ...rest };
  }
  return lowerFieldSort(entry, type, knownFunctions);
}

function lowerFieldSort(
  entry: any,
  type: CodeRef | undefined,
  knownFunctions?: ReadonlySet<string>,
): any {
  if (isObject(entry) && 'relevance' in entry) {
    // search intent's relevance: named weights for its signals
    let { relevance, ...rest } = entry;
    return {
      by: '_relevance',
      ...rest,
      ...(isObject(relevance) ? { weights: relevance } : {}),
      ...(type && !rest.on ? { on: type } : {}),
    };
  }
  if (!isObject(entry) || typeof entry.by !== 'string') return entry;
  let by = barePath(entry.by);
  if (by === TEXT_RELEVANCE) return { ...entry, by: '_matchRelevance' };
  let out: Record<string, any> = { ...entry, by };
  if (by === '_when' && entry.when) out.when = anchored(entry.when, type);
  if (Array.isArray(entry.of))
    out.of = entry.of.map((s: any) => lowerSignal(s, type, knownFunctions));
  if (!INTERNAL_SORT_KEYS.has(by) && !GENERAL_SORTS.has(by) && !entry.on) {
    if (!type) throw refuse('sort-card-field-query', undefined, { by });
    out.on = type;
  }
  return out;
}

// Every expression runs as SQL (BXL's score profile), refused as
// `unknown-function`, `invalid-expression` or, where the server compiles it
// (query-expression.ts), `expression-unsupported` with the reason.
export function assertExpressionInSql(
  expr: string,
  knownFunctions: ReadonlySet<string> | undefined,
): void {
  assertExpressionLength('expression', expr);
  if (knownFunctions) {
    // read from BXL's own tokens: text inside a string literal or a comment
    // is not a call, and BXL's helpers and jq's builtins are known
    let unknown = unknownBxlFunctions(expr, knownFunctions);
    if (unknown.length) {
      throw refuse('expression-bxl-knows', undefined, {
        unknown: unknown.join(', '),
        function:
          unknown.length > 1 ? 'are not functions' : 'is not a function',
      });
    }
  }
  try {
    checkExpressionSql(expr);
  } catch (e) {
    let reason = (e as Error).message;
    // a formula that does not parse is malformed, and one past the
    // profile's size is too large: neither is a matter of what SQL supports
    let code = /does not parse|cannot be empty/.test(reason)
      ? 'invalid-expression'
      : /at most \d+ parts|too deeply nested/.test(reason)
        ? 'limit-exceeded'
        : 'expression-unsupported';
    throw new InvalidQueryError(
      `expression ${JSON.stringify(expr.length > 120 ? `${expr.slice(0, 120)}…` : expr)} cannot run in a query: ${(e as Error).message.replace(/^(formula|expression): /, '')}`,
      code,
    );
  }
}

export const RERANK_REFUSAL = refusalText('rerank-not-a-member');

// The rules of an expression sort window, one check each, for both the
// newer spelling's sort entry (here) and the engine form's `rerank`
// (query-check.ts). `at` is where the caller reports the member.
const WINDOW_MEMBERS = grammarMembers('window');

export function assertExpressionText(
  at: string,
  expr: unknown,
): asserts expr is string {
  if (typeof expr !== 'string' || expr.trim() === '') {
    throw refuse('expression-must-non-empty', at);
  }
}

export function assertExpressionLength(at: string, expr: string): void {
  if (expr.length > 2000) {
    throw refuse('expression-at-most-2', at, { length: expr.length });
  }
}

export function assertWindowTop(at: string, top: unknown): void {
  if (
    top !== undefined &&
    (!Number.isInteger(top) ||
      (top as number) < 1 ||
      (top as number) > MAX_RERANK_TOP)
  ) {
    throw refuse('expression-top-whole-number', at, { MAX_RERANK_TOP });
  }
}

export function assertWindowCompareObject(at: string, compare: unknown): void {
  if (compare !== undefined && !isObject(compare)) {
    throw refuse('compare-filter-near-k', at);
  }
}

export function assertWindowMembers(at: string, keys: string[]): void {
  let unknown = keys.filter((k) => !WINDOW_MEMBERS.includes(k));
  if (unknown.length) {
    throw refuse('expression-sort-entry-with', at, {
      k: unknown.map((k) => JSON.stringify(k.slice(0, 80))).join(', '),
      key: unknown.length > 1 ? 'are not keys' : 'is not a key',
    });
  }
}

// `formula` (or the engine's `expr`) written for `expression`
export const misnamedFormula = (at: string, key: string) =>
  refuse('sort-formula-not-key', at, { key });

const READS_COMPARISON_SET = /\b(?:peers|stats)\./;

export interface LowerOptions {
  // BXL's function names (upper case), to refuse an unknown function.
  knownFunctions?: ReadonlySet<string>;
  // Where `$REALM/` modules resolve (type-reference.ts); absent, a
  // realm-relative module is left for the boundary that knows the realm.
  typeReferences?: TypeReferenceContext;
}

// A newer-spelling page counts its total to the cap unless it says
// otherwise; the engine's default stays exact (the older spelling's), so a
// saved query keeps its total. A counts-only page (`size: 0`) is exact.
function withNewerTotalDefault(query: Record<string, any>) {
  let page = query.page;
  if (
    !isObject(page) ||
    'total' in page ||
    'exactTotal' in page ||
    // only a number (or its text) is a size; anything else is refused later
    ((typeof page.size === 'number' || typeof page.size === 'string') &&
      Number(page.size) === 0)
  ) {
    return query;
  }
  return { ...query, page: { ...page, total: 'capped' } };
}

export function lowerQuery(
  input: Record<string, any>,
  opts: LowerOptions = {},
): LoweredQuery {
  assertPlainQueryData(input);
  input = resolveTypeReferences(input, opts.typeReferences);
  // "$name" and "$name.path" strings that name a declared binding, as the
  // engine reads them, and each { $literal } as its text
  input = internBindingReferences(input);
  quoted = {};
  try {
    let lowered = lowerQueryInto(input, opts);
    if (Object.keys(quoted).length) lowered.notes.quotedLabels = quoted;
    lowered.query = withNewerTotalDefault(lowered.query);
    return lowered;
  } finally {
    quoted = undefined;
  }
}

function lowerQueryInto(
  input: Record<string, any>,
  opts: LowerOptions,
): LoweredQuery {
  let notes: LoweringNotes = {};
  let { type: declared, ...rest } = input;
  // With no top-level type, the filter's own anchor is the query's type.
  let type: any =
    declared ??
    (isObject(input.filter)
      ? (input.filter.on ?? input.filter.type)
      : undefined);
  if (
    declared !== undefined &&
    (typeof declared !== 'object' || declared == null)
  ) {
    throw refuse('type-must-name-card');
  }
  let query: Record<string, any> = { ...rest };

  // A filter answers to the query's type: every clause inherits it.
  let typed = (filter: unknown) => {
    let f = lowerFilter(filter, type);
    if (declared && isObject(f) && !('on' in f) && !('type' in f)) {
      f = {
        on: type,
        every:
          Array.isArray(f.every) && Object.keys(f).length === 1 ? f.every : [f],
      };
    } else if (
      declared &&
      isObject(f) &&
      !sameTypeRef(f.on ?? f.type, declared)
    ) {
      // a filter anchored on another type still answers to the query's type
      f = { on: declared, every: [f] };
    }
    return f;
  };
  if (query.filter !== undefined) {
    query.filter = typed(query.filter);
  } else if (declared) {
    query.filter = { type: declared };
  }
  if (hasOwn(input, 'rerank')) throw refuse('rerank-not-a-member');
  // (no caller writes `rerank`: a sort entry with `top` lowers to it below)
  if (
    isObject(query.rerank) &&
    isObject(query.rerank.compare) &&
    query.rerank.compare.filter !== undefined
  ) {
    query.rerank = {
      ...query.rerank,
      compare: {
        ...query.rerank.compare,
        filter: typed(query.rerank.compare.filter),
      },
    };
  }

  // sort: signal kinds by key, field entries anchored
  if (Array.isArray(query.sort)) {
    let sort: any[] = [];
    for (let entry of query.sort) {
      if (isObject(entry) && 'blend' in entry) {
        let { blend, ...more } = entry;
        if (!Array.isArray(blend)) throw refuse('sort-blend-list-signals');
        sort.push({
          by: '_blend',
          ...more,
          of: blend.map((s) => lowerSignal(s, type, opts.knownFunctions)),
        });
      } else if (isObject(entry) && 'formula' in entry) {
        throw misnamedFormula('sort', 'formula');
      } else if (isObject(entry) && 'expression' in entry) {
        let { expression: formula, direction, top, compare, ...more } = entry;
        assertExpressionText('expression', formula);
        if ('placement' in more) throw refuse('placement-not-a-key');
        assertQueryExpressionProfile('expression', formula);
        assertExpressionInSql(formula, opts.knownFunctions);
        let windowed = top !== undefined || compare !== undefined;
        if (!windowed) {
          // (an unknown member is refused first, below, with the nearest name)
          if (
            READS_COMPARISON_SET.test(formula) &&
            Object.keys(more).every((k) => k === 'on' || k === 'weight')
          ) {
            throw refuse('expression-peers-stats-read');
          }
          sort.push({
            by: '_expr',
            expr: formula,
            ...(direction !== undefined ? { direction } : {}),
            ...more,
          });
          continue;
        }
        // An expression with `top` re-orders the first `top` rows of the rest
        // of the sort, so it must lead the sort, and a query has one.
        if (query.sort.indexOf(entry) > 0) {
          throw refuse('expression-with-top-re');
        }
        assertWindowMembers(
          'expression',
          Object.keys(more).filter((k) => k !== 'on'),
        );
        assertWindowTop('expression', top);
        assertWindowCompareObject('expression', compare);
        query.rerank = {
          expression: formula,
          ...(top !== undefined ? { top } : {}),
          // engine-form check: `invalid-value` unless asc/desc, null included
          ...(direction !== undefined ? { direction } : {}),
          ...(compare !== undefined
            ? {
                compare: {
                  ...compare,
                  ...(compare.filter !== undefined
                    ? { filter: typed(compare.filter) }
                    : {}),
                },
              }
            : {}),
        };
      } else {
        sort.push(lowerSignal(entry, type, opts.knownFunctions));
      }
    }
    if (sort.length) query.sort = sort;
    else delete query.sort;
  }

  if (typeof query.collapse === 'string') {
    let by = barePath(query.collapse);
    query.collapse = type ? { by, on: type } : by;
  } else if (
    isObject(query.collapse) &&
    typeof query.collapse.by === 'string'
  ) {
    query.collapse = {
      ...query.collapse,
      by: barePath(query.collapse.by),
      ...(type && !query.collapse.on ? { on: type } : {}),
    };
  }
  if (Array.isArray(query.facets)) {
    query.facets = query.facets.map((f: any) =>
      isObject(f) && typeof f.by === 'string'
        ? {
            ...f,
            by: barePath(f.by),
            ...(isObject(f.measure)
              ? { measure: mapMeasure(f.measure, barePath) }
              : {}),
          }
        : f,
    );
    query.facets = assertDistinctFacets(query.facets);
  }
  for (let key of ['by', 'near']) {
    let c = query.rerank?.compare;
    if (isObject(c) && typeof c[key] === 'string') {
      query.rerank = {
        ...query.rerank,
        compare: { ...c, [key]: barePath(c[key]) },
      };
    }
  }
  // let: each binding's own query is in the same grammar, with its own type
  if (isObject(query.let)) {
    let bindings: Record<string, any> = {};
    for (let [name, binding] of Object.entries(query.let)) {
      bindings[name] =
        isObject(binding) &&
        isObject(binding.from) &&
        !isLogBindingFrom(binding.from) &&
        usesNewSyntax(binding.from)
          ? { ...binding, from: lowerQueryInto(binding.from, opts).query }
          : binding;
    }
    query.let = bindings;
  }
  return { query, notes };
}

export * from './query-labels.ts';
