// The query grammar's newer spellings, lowered to the JSON the engine runs.
//
// A query may name its card type once, at the top (`type`), and every clause
// inherits it; signal kinds have keys of their own (`blend`, `formula`,
// `boost`) instead of living inside `by`; a field may be written as its path,
// with or without `item.`, or as a label in any case or spacing; `exists` and
// `missing` test for a value; `matches` with `prefix` is type-ahead. Each of
// these lowers to exactly the JSON an author would write today, so a query in
// either spelling runs the same SQL.
//
// The anchor mistakes that used to return zero rows in silence are errors
// here, each with a code: a field sort with no type anywhere, a field the
// type does not have (with the nearest name). A bare `{ on }` filter node is
// not one of them: it is a newer-spelling marker, lowered to `{ type }`, so it
// matches every card of that type.
//
// `lowerQuery` is synchronous and needs nothing but the query.
// `resolveQueryLabels` reads the type's fields, so it runs where definitions
// are at hand (the engine, or a checker with a fixture).
import { internBindingReferences } from './binding-reference.ts';
import { grammarMembers, newerSpellingMarkers } from './query-grammar.ts';
import { InvalidQueryError } from './invalid-query-error.ts';
import { INTERNAL_SORT_KEYS } from './internal-sort-keys.ts';
import { unknownBxlFunctions } from '@cardstack/bxl/compiler';
import { assertQueryExpressionProfile, exprSortSql } from './formula-sql.ts';
import type { CodeRef } from './code-ref.ts';
import {
  resolveTypeReferences,
  type TypeReferenceContext,
} from './type-reference.ts';

export class QuerySyntaxError extends InvalidQueryError {
  constructor(code: string, message: string) {
    super(message, code);
  }
}

export interface LoweringNotes {
  // Each quoted label the lowering turned into a name, by that name, so a
  // later "not a field" error can quote what the author wrote.
  quotedLabels?: Record<string, string>;
}

export interface LoweredQuery {
  query: Record<string, any>;
  notes: LoweringNotes;
}

// The filter operators, `exists` and `missing` among them.
const FILTER_OPERATORS = new Set(
  grammarMembers('filter', (m) => m.role === 'operator'),
);
// Sort keys that are not card fields and need no type.
const GENERAL_SORTS = new Set(['lastModified', 'createdAt', 'cardURL']);
const PATH_OPS = [
  'eq',
  'in',
  'range',
  'contains',
  'near',
  'pattern',
  'regex',
] as const;
// An expression sort entry's window (`top`): the rows it re-orders when it
// compares (`compare`) without naming `top`, and the most it may name.
export const DEFAULT_RERANK_TOP = 100;
export const MAX_RERANK_TOP = 500;
// The request grammar's name for the text score; the engine's is
// `_matchRelevance`.
const TEXT_RELEVANCE = 'textRelevance';

const isObject = (v: unknown): v is Record<string, any> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

// Sets a member a query names as an own data property. A plain assignment
// of `__proto__` would set the object's prototype instead, and the member
// would vanish from the query rather than be read (and refused) as written.
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

// Whether `key` is one of `record`'s own members, so a name every object
// inherits (`constructor`, `toString`, `__proto__`) is never found on it.
export function hasOwn(record: unknown, key: string): boolean {
  return (
    record != null &&
    typeof record === 'object' &&
    Object.prototype.hasOwnProperty.call(record, key)
  );
}

// How deep a query may nest: objects and lists inside one another, counting
// the query itself. A filter of `every`, `any` or `not` takes one or two
// levels for each of its own, so it nests about 250 deep.
export const MAX_QUERY_DEPTH = 512;

// A `let` binding's `from` that names a log (`from: { log }` or `{ logs }`):
// its filter is a log filter, which the card grammar's spellings never
// rewrite.
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
const UNSTORABLE_TEXT =
  // eslint-disable-next-line no-control-regex
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// What JSON cannot carry is `invalid-json`, as `assertJSONValue` has it.
function plainDataError(message: string, code = 'invalid-json') {
  return new QuerySyntaxError(code, message);
}

// A query is plain JSON data: objects, lists, text, finite numbers, booleans
// and null, nested at most MAX_QUERY_DEPTH deep, with no text a database
// cannot store. Checked once, before anything walks the query, so a value
// JSON cannot carry (a function, a getter, a cycle, a proxy that throws) is
// refused with a code rather than crashing a reader, and a member read
// through a getter cannot read one way when checked and another when run.
// `undefined` is left for the member checks to read as absent. Iterative, so
// a query nested past the limit is refused rather than overflowing the stack.
export function assertPlainQueryData(
  query: unknown,
  maxDepth = MAX_QUERY_DEPTH,
): void {
  try {
    checkPlainData(query, maxDepth);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw e;
    }
    throw plainDataError(
      `the query is not plain JSON data: reading it failed (${String((e as Error)?.message ?? e).slice(0, 80)})`,
    );
  }
}

function checkPlainData(root: unknown, maxDepth: number): void {
  // [value, depth, where]; `exit` pops a container off the ancestor set
  type Item = { value: unknown; depth: number; at: string } | { exit: object };
  let stack: Item[] = [{ value: root, depth: 0, at: '' }];
  let ancestors = new Set<object>();
  let text = (s: string, at: string, what: string) => {
    if (UNSTORABLE_TEXT.test(s)) {
      throw plainDataError(
        `${at || '/'}: ${what} holds a null character or a lone surrogate, which no index can store`,
        'invalid-value',
      );
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
          throw plainDataError(
            `${at || '/'}: ${String(value)} is not a number a query can hold; a number must be finite`,
            'invalid-value',
          );
        }
        continue;
      case 'object':
        break;
      default:
        throw plainDataError(
          `${at || '/'}: a ${typeof value} is not JSON data; a query holds objects, lists, text, numbers, booleans and null`,
        );
    }
    if (value === null) continue;
    let node = value as object;
    if (depth >= maxDepth) {
      throw plainDataError(
        `${at.slice(0, 60) || '/'}…: the query nests more than ${maxDepth} objects and lists deep`,
        'limit-exceeded',
      );
    }
    if (ancestors.has(node)) {
      throw plainDataError(`${at || '/'}: the query contains itself`);
    }
    let isList = Array.isArray(node);
    if (!isList) {
      // a plain object of any realm: its prototype is null or is an
      // `Object.prototype`, whose own prototype is null
      let proto = Object.getPrototypeOf(node);
      if (proto !== null && Object.getPrototypeOf(proto) !== null) {
        throw plainDataError(
          `${at || '/'}: ${proto?.constructor?.name ?? 'an object'} is not JSON data; a query holds plain objects and lists`,
        );
      }
    }
    ancestors.add(node);
    stack.push({ exit: node });
    let keys = Reflect.ownKeys(node);
    let length = isList ? (node as unknown[]).length : 0;
    let seen = 0;
    for (let key of keys) {
      if (typeof key === 'symbol') {
        throw plainDataError(
          `${at || '/'}: a member named by a symbol is not JSON data`,
        );
      }
      if (isList && key === 'length') continue;
      let descriptor = Object.getOwnPropertyDescriptor(node, key)!;
      if (isList) {
        let index = Number(key);
        if (!(Number.isInteger(index) && index >= 0 && String(index) === key)) {
          throw plainDataError(
            `${at || '/'}: a list with a member "${key.slice(0, 40)}" is not JSON data`,
          );
        }
        seen++;
      } else if (!descriptor.enumerable) {
        continue;
      }
      if (!('value' in descriptor)) {
        throw plainDataError(
          `${at || '/'}/${key.slice(0, 40)}: a member read through a getter is not JSON data`,
        );
      }
      if (!isList) text(key, at, 'a member name');
      stack.push({
        value: descriptor.value,
        depth: depth + 1,
        at: `${at}/${key.slice(0, 40)}`,
      });
    }
    if (isList && seen !== length) {
      throw plainDataError(
        `${at || '/'}: a list with holes in it is not JSON data`,
      );
    }
  }
}

// A field path as the engine reads it: no `item.`, no surrounding quotes.
// The quoted labels the lowering in progress has turned into names, so an
// error can quote a label as its author wrote it (lowerQuery is synchronous;
// set for one call, then cleared).
let quoted: Record<string, string> | undefined;

export function barePath(path: string): string {
  let p = path.startsWith('item.') ? path.slice(5) : path;
  if (p.length > 1 && p.startsWith('"') && p.endsWith('"')) {
    // a quoted label reads as a field name: "Units Sold 30d" → unitsSold30d
    let words = p
      .slice(1, -1)
      .trim()
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
    let name = words
      .map((w, i) =>
        i === 0
          ? w.charAt(0).toLowerCase() + w.slice(1)
          : w.charAt(0).toUpperCase() + w.slice(1),
      )
      .join('');
    if (quoted) setOwn(quoted, name, p.slice(1, -1));
    return name;
  }
  return p;
}

// Whether a query uses any of the newer spellings. A predicate: it never
// throws, and it walks without recursing, so a query nested too deep or not
// plain data at all reads as the older spelling and is refused by the checks
// that read it next.
export function usesNewSyntax(query: unknown): boolean {
  try {
    return newSyntaxIn(query, 0);
  } catch {
    return false;
  }
}

// The members Query V2 added to main's grammar (the older spelling): a
// query holding any of them is in the newer spelling and read strictly as
// a whole (ADR 022 §1.7). Named, never "anything else": main ignored an
// unknown member of a filter node, a sort entry or `page`, and still does.
// From the grammar table (query-grammar.ts); a top-level `type` is checked
// first, by name, below.
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
  // a path written with `item.` or as a quoted label
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

// An author's query (not the engine's form) that is in the newer spelling
// but names its type the older way, with an `on` on its top filter node and
// no top-level `type`:
// refused with `mixed-spelling` and the rewrite to write instead. Called
// where an author's query first arrives, before it is lowered: the host's
// searches, the AI assistant's search tools and a query-backed field's
// definition. The server cannot run it, since the engine's own form (what
// lowering yields, main's grammar plus V2 members) has `on` everywhere and
// reaches it over the wire; there the strictness of the newer spelling is
// the rule (ADR 022 §1.4, §1.7). Only the top filter node's `on` is the
// older form (see `olderAnchorIn`); a bare `{ on }` (every card of the type)
// and an `on` anchoring one node are the newer spelling's own.
export const MIXED_SPELLING = 'mixed-spelling';
export function assertAuthoredQuerySpelling(
  query: unknown,
  where = 'query',
): void {
  if (!isObject(query) || !usesNewSyntax(query)) return;
  let check = (q: Record<string, any>, at: string, depth: number) => {
    let anchor = 'type' in q ? undefined : olderAnchorIn(q);
    if (anchor) {
      throw new QuerySyntaxError(
        MIXED_SPELLING,
        `${at}: ${anchor.path} anchors the query's type with "on", the older spelling, but the query is in the newer spelling (it uses ${newerMemberIn(q)}). Put the type at the top and drop "on": { "type": ${JSON.stringify(anchor.on)}, … }`,
      );
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

// The older way of naming the query's type: an `on` on the query's top
// filter node, which anchors (and gates) the whole query. Rewritten as a
// top-level `type` it means the same. An `on` deeper in the filter, or on a
// sort entry, a facet or a collapse, anchors only its own part and is the
// newer spelling's too, so it is left alone.
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

// One facet per field: `meta.facets` and `meta.facetStats` answer by the
// field, so two facets on one `by` are one facet. Their options combine
// (`{ by, stats: true }` beside `{ by, ranges }` counts the ranges and the
// statistics); an option the two give different values cannot be honored
// both ways, and which won would depend on the order they were written in,
// so it is refused. Returns the facets with each field's combined into the
// first place it appears.
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
        throw new QuerySyntaxError(
          'conflicting-members',
          `${where}[${i}]: another facet on "${by}" gives ${key} another value; a field takes one facet, since meta.facets answers by field, so write its options once`,
        );
      }
      setOwn(before, key, value);
    }
  });
  return out;
}

// Whether two type references name the same type, however their members
// are ordered.
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
        throw new QuerySyntaxError(
          'invalid-filter',
          `filter: ${k} takes a field path`,
        );
      }
      // one operator per filter node, as everywhere in the grammar
      let others = Object.keys(node).filter(
        (key) => key !== k && key !== 'on' && key !== 'type',
      );
      let operators = others.filter((key) => FILTER_OPERATORS.has(key));
      if (operators.length) {
        throw new QuerySyntaxError(
          'invalid-filter',
          `filter: ${k} is an operator of its own; combine it with "${operators[0]}" under "every"`,
        );
      }
      let test = { eq: { [barePath(v)]: null } };
      let lowered = k === 'missing' ? test : { not: test };
      // A member that is not an operator stays beside the lowered test, so
      // the filter's own check refuses it as it would beside any operator
      // (unknown-key with the nearest name, or conflicting-members).
      let rest = Object.fromEntries(
        others.map((key) => [key, (node as Record<string, any>)[key]]),
      );
      return node.on
        ? { on: node.on, ...lowered, ...rest }
        : { ...lowered, ...rest };
    } else if (k === 'fields' && Array.isArray(v)) {
      out[k] = v.map((p) => (typeof p === 'string' ? barePath(p) : p));
    } else if (k === 'within' && typeof v === 'string') {
      // a passage list, named like any field path
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
  if ('formula' in entry) {
    throw new QuerySyntaxError(
      'unknown-key',
      'sort: "formula" is not a key; did you mean "expression"?',
    );
  }
  if ('expression' in entry) {
    let { expression: formula, ...rest } = entry;
    if (typeof formula !== 'string' || formula.trim() === '') {
      throw new QuerySyntaxError(
        'invalid-expression',
        'expression: an expression is a non-empty string of BXL',
      );
    }
    assertQueryExpressionProfile('expression', formula);
    // a blend ranks every match by each signal: a window is the first sort
    // entry's alone
    for (let key of ['top', 'compare', 'placement']) {
      if (key in rest) {
        throw new QuerySyntaxError(
          key === 'placement' ? 'unknown-key' : 'invalid-nesting',
          key === 'placement'
            ? PLACEMENT_REFUSAL
            : `expression: a blend signal ranks every match, so it takes no ${key}; put an expression with ${key} first in the sort instead`,
        );
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
  if (by === TEXT_RELEVANCE) {
    return { ...entry, by: '_matchRelevance' };
  }
  let out: Record<string, any> = { ...entry, by };
  if (by === '_when' && entry.when) out.when = anchored(entry.when, type);
  if (Array.isArray(entry.of))
    out.of = entry.of.map((s: any) => lowerSignal(s, type, knownFunctions));
  if (!INTERNAL_SORT_KEYS.has(by) && !GENERAL_SORTS.has(by) && !entry.on) {
    if (!type) {
      throw new QuerySyntaxError(
        'sort-needs-type',
        `sort: "${by}" is a card field, so the query must say which card type it belongs to: put "type" at the top of the query (or "on" on this sort entry)`,
      );
    }
    out.on = type;
  }
  return out;
}

// Every expression in a query runs as SQL (BXL's score profile): one that
// calls a function BXL does not know is refused with `unknown-function`, and
// one the profile cannot express with `expression-unsupported`, naming why.
export function assertExpressionInSql(
  expr: string,
  knownFunctions: ReadonlySet<string> | undefined,
): void {
  if (expr.length > 2000) {
    throw new QuerySyntaxError(
      'limit-exceeded',
      `expression: an expression is at most 2,000 characters, and this one has ${expr.length}`,
    );
  }
  if (knownFunctions) {
    // read from BXL's own tokens: text inside a string literal or a comment
    // is not a call, and BXL's helpers and jq's builtins are known
    let unknown = unknownBxlFunctions(expr, knownFunctions);
    if (unknown.length) {
      throw new QuerySyntaxError(
        'unknown-function',
        `expression: ${unknown.join(', ')} ${unknown.length > 1 ? 'are not functions' : 'is not a function'} BXL knows`,
      );
    }
  }
  try {
    exprSortSql(expr);
  } catch (e) {
    let reason = (e as Error).message;
    // a formula that does not parse is malformed, and one past the
    // profile's size is too large: neither is a matter of what SQL supports
    let code = /does not parse|cannot be empty/.test(reason)
      ? 'invalid-expression'
      : /at most \d+ parts|too deeply nested/.test(reason)
        ? 'limit-exceeded'
        : 'expression-unsupported';
    throw new QuerySyntaxError(
      code,
      `expression ${JSON.stringify(expr.length > 120 ? `${expr.slice(0, 120)}…` : expr)} cannot run in a query: ${(e as Error).message.replace(/^(formula|expression): /, '')}`,
    );
  }
}

const PLACEMENT_REFUSAL =
  'expression: "placement" is not a key; every expression runs in SQL. To re-order only the first rows, give the sort entry "top": { expression, top: 100 }';
export const RERANK_REFUSAL =
  'rerank is not a query member; re-ranking is a sort entry: sort: [{ expression: "…", top: 100, compare: { by: "…" } }, …the base order]';
const READS_COMPARISON_SET = /\b(?:peers|stats)\./;

export interface LowerOptions {
  // BXL's function names (upper case), to refuse an unknown function.
  knownFunctions?: ReadonlySet<string>;
  // Where the query's `$REALM/` modules resolve (type-reference.ts). Absent,
  // shorthands are still parsed and a realm-relative module is left for the
  // boundary that knows the realm.
  typeReferences?: TypeReferenceContext;
}

// A page's total in the newer spelling counts to the cap unless it says
// otherwise. The engine's own default is an exact count, what the older
// spelling always had, so a saved query keeps its total; the lowered query
// carries `total: 'capped'` to say which it is. A counts-only page
// (`size: 0`) asks for nothing but the count, so it is counted exactly in
// both.
function withNewerTotalDefault(query: Record<string, any>) {
  let page = query.page;
  if (
    !isObject(page) ||
    'total' in page ||
    'exactTotal' in page ||
    // only a number (or its text) is a size; anything else, such as an
    // object with no prototype, is refused when the page is checked
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
  // every type reference as the absolute { module, name }, once, here
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
    throw new QuerySyntaxError(
      'invalid-type',
      'type must name a card type: "<module>#<Name>" or { module, name }',
    );
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
  if (Object.prototype.hasOwnProperty.call(input, 'rerank')) {
    throw new QuerySyntaxError('unknown-key', RERANK_REFUSAL);
  }
  // (no caller writes `rerank`: an expression sort entry with `top` lowers
  // to it below)
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
        if (!Array.isArray(blend)) {
          throw new QuerySyntaxError(
            'invalid-value',
            'sort: blend is a list of the signals to fuse, such as [{ by: "rating" }, { boost: { eq: { brand: "Acme" } } }]',
          );
        }
        sort.push({
          by: '_blend',
          ...more,
          of: blend.map((s) => lowerSignal(s, type, opts.knownFunctions)),
        });
      } else if (isObject(entry) && 'formula' in entry) {
        throw new QuerySyntaxError(
          'unknown-key',
          'sort: "formula" is not a key; did you mean "expression"?',
        );
      } else if (isObject(entry) && 'expression' in entry) {
        let { expression: formula, direction, top, compare, ...more } = entry;
        if (typeof formula !== 'string' || formula.trim() === '') {
          throw new QuerySyntaxError(
            'invalid-expression',
            'expression: an expression is a non-empty string of BXL',
          );
        }
        if ('placement' in more) {
          throw new QuerySyntaxError('unknown-key', PLACEMENT_REFUSAL);
        }
        assertQueryExpressionProfile('expression', formula);
        assertExpressionInSql(formula, opts.knownFunctions);
        let windowed = top !== undefined || compare !== undefined;
        if (!windowed) {
          // (a member the entry does not have is refused below, with the
          // nearest name, before this)
          if (
            READS_COMPARISON_SET.test(formula) &&
            Object.keys(more).every((k) => k === 'on' || k === 'weight')
          ) {
            throw new QuerySyntaxError(
              'expression-placement',
              'expression: peers. and stats. read a comparison set, which only a sort entry with top compares with: { expression, top: 100, compare: { by: "…" } }',
            );
          }
          sort.push({
            by: '_expr',
            expr: formula,
            ...(direction !== undefined ? { direction } : {}),
            ...more,
          });
          continue;
        }
        // An expression with `top` re-orders the first `top` rows of the
        // order the rest of the sort gives: it must lead the sort, and a
        // query has one.
        if (query.sort.indexOf(entry) > 0) {
          throw new QuerySyntaxError(
            'expression-placement',
            'expression: an expression with top re-orders the first rows of the order the entries after it give, so it is the first sort entry',
          );
        }
        let unknown = Object.keys(more).filter((k) => k !== 'on');
        if (unknown.length) {
          throw new QuerySyntaxError(
            'unknown-key',
            `expression: ${unknown.map((k) => JSON.stringify(k)).join(', ')} ${unknown.length > 1 ? 'are not keys' : 'is not a key'} of an expression sort entry with top; it takes expression, direction, top and compare`,
          );
        }
        if (
          top !== undefined &&
          (!Number.isInteger(top) || top < 1 || top > MAX_RERANK_TOP)
        ) {
          throw new QuerySyntaxError(
            'invalid-value',
            `expression: top is a whole number from 1 to ${MAX_RERANK_TOP}`,
          );
        }
        if (compare !== undefined && !isObject(compare)) {
          throw new QuerySyntaxError(
            'invalid-value',
            'expression: compare is an object: { by }, { filter }, or { near, k?, minSimilarity? }',
          );
        }
        query.rerank = {
          expression: formula,
          ...(top !== undefined ? { top } : {}),
          // checked as the engine form is (`invalid-value` for a direction
          // that is neither asc nor desc, null included)
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

  // collapse: a bare path inherits the type
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
        ? { ...f, by: barePath(f.by) }
        : f,
    );
    query.facets = assertDistinctFacets(query.facets);
  }
  if (
    isObject(query.rerank?.compare) &&
    typeof query.rerank.compare.by === 'string'
  ) {
    query.rerank = {
      ...query.rerank,
      compare: {
        ...query.rerank.compare,
        by: barePath(query.rerank.compare.by),
      },
    };
  }
  if (
    isObject(query.rerank?.compare) &&
    typeof query.rerank.compare.near === 'string'
  ) {
    query.rerank = {
      ...query.rerank,
      compare: {
        ...query.rerank.compare,
        near: barePath(query.rerank.compare.near),
      },
    };
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

// ── labels ──────────────────────────────────────────────────────────────

// The field names at one level of a type: the type's own fields for an empty
// prefix, or the fields of the compound field or linked card at `prefix`.
// Undefined when the level cannot be read (the path is then left alone).
export type FieldsAt = (
  type: CodeRef,
  prefix: string[],
) => Promise<string[] | undefined>;

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function distance(a: string, b: string): number {
  let d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}

// A path written as a label rather than as the field's own name: a capital,
// quotes, a space, or `item.`. Only these are resolved, so a query in
// today's spelling never pays for a lookup.
export function looksLikeLabel(path: string): boolean {
  return /^item\.|^"|\s|(^|\.)[A-Z]/.test(path);
}

function isSynthetic(path: string) {
  return path.startsWith('_') || path === 'id' || path.startsWith('$');
}

// Resolves a field written as a label (`PriceMin`, `"Units Sold 30d"`,
// `Brand.Name`) to its path, segment by segment, ignoring case and anything
// but letters and digits. A segment that matches no field is an error naming
// the nearest one.
export async function resolveLabel(
  type: CodeRef,
  label: string,
  fieldsAt: FieldsAt,
  written?: Record<string, string>,
): Promise<string> {
  let raw = barePath(label);
  if (isSynthetic(raw)) return raw;
  let segments = raw.includes('.') ? raw.split('.') : [raw];
  // a quoted label with spaces is one segment
  let out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];
    let base = seg.replace(/\[\]$/, '');
    let keys = await fieldsAt(
      type,
      out.map((s) => s.replace(/\[\]$/, '')),
    );
    if (!keys) {
      out.push(...segments.slice(i));
      break;
    }
    if (keys.includes(base)) {
      out.push(seg);
      continue;
    }
    let matches = keys.filter((k) => fold(k) === fold(base));
    if (matches.length === 1) {
      out.push(seg.replace(base, matches[0]));
      continue;
    }
    let nearest = [...keys].sort(
      (a, b) => distance(fold(a), fold(base)) - distance(fold(b), fold(base)),
    )[0];
    let where = out.length ? ` in ${out.join('.')}` : '';
    let asWritten =
      (hasOwn(written, barePath(label))
        ? written![barePath(label)]
        : undefined) ?? label;
    throw new QuerySyntaxError(
      'unknown-field',
      `"${asWritten}" is not a field${where} on ${(type as any).name ?? 'this type'}${nearest ? `; did you mean "${[...out, nearest].join('.')}"?` : ''}`,
    );
  }
  return out.join('.');
}

// Every field path a query names, in either grammar, rewritten by `map`:
// filter operators' paths and `fields`, sort and signal `by`s, boost filters,
// collapse, facets and a rerank's comparison `by`. `map` gets the path as
// written and the type that anchors it (the nearest `on`, the query's
// `type`, or `anchor`), and returns the path to store. Values, `on`/`type`
// refs and the engine's own sort keys are left alone. A saved query (a
// query-backed field, a declared query operation) runs its labels through
// here once, so it is stored with bare paths that a later schema change
// cannot make ambiguous.
export function mapQueryPaths<Q>(
  query: Q,
  map: (path: string, anchor: unknown) => string,
  anchor?: unknown,
): Q {
  if (!isObject(query)) return query;
  let q = query as Record<string, any>;
  let top = q.type ?? anchor;
  let filter = (n: any, type: unknown): any => {
    if (Array.isArray(n)) return n.map((x) => filter(x, type));
    if (!isObject(n)) return n;
    let t = n.on ?? type;
    let out: Record<string, any> = {};
    for (let [k, v] of Object.entries(n)) {
      if ((k === 'every' || k === 'any') && Array.isArray(v)) {
        out[k] = v.map((x) => filter(x, t));
      } else if (k === 'not') {
        out[k] = filter(v, t);
      } else if ((PATH_OPS as readonly string[]).includes(k) && isObject(v)) {
        out[k] = Object.fromEntries(
          Object.entries(v).map(([path, x]) => [map(path, t), x]),
        );
      } else if ((k === 'exists' || k === 'missing') && typeof v === 'string') {
        out[k] = map(v, t);
      } else if (k === 'fields' && Array.isArray(v)) {
        out[k] = v.map((path) =>
          typeof path === 'string' ? map(path, t) : path,
        );
      } else if (k === 'within' && typeof v === 'string') {
        out[k] = map(v, t);
      } else {
        setOwn(out, k, v);
      }
    }
    return out;
  };
  let isFieldSort = (by: unknown) =>
    typeof by === 'string' &&
    !barePath(by).startsWith('_') &&
    !GENERAL_SORTS.has(barePath(by)) &&
    barePath(by) !== TEXT_RELEVANCE;
  let sortEntry = (e: any, type: unknown): any => {
    if (!isObject(e)) return e;
    let t = e.on ?? type;
    let out: Record<string, any> = { ...e };
    if (isFieldSort(e.by)) out.by = map(e.by, t);
    for (let key of ['of', 'blend']) {
      if (Array.isArray(e[key]))
        out[key] = e[key].map((x: any) => sortEntry(x, t));
    }
    if (isObject(e.when)) out.when = filter(e.when, t);
    if (isObject(e.boost)) out.boost = filter(e.boost, t);
    return out;
  };
  let out: Record<string, any> = { ...q };
  if (q.filter !== undefined) out.filter = filter(q.filter, top);
  if (Array.isArray(q.sort))
    out.sort = q.sort.map((e: any) => sortEntry(e, top));
  if (typeof q.collapse === 'string') out.collapse = map(q.collapse, top);
  else if (isObject(q.collapse) && typeof q.collapse.by === 'string') {
    out.collapse = {
      ...q.collapse,
      by: map(q.collapse.by, q.collapse.on ?? top),
    };
  }
  if (Array.isArray(q.facets)) {
    out.facets = q.facets.map((f: any) =>
      isObject(f) && typeof f.by === 'string'
        ? { ...f, by: map(f.by, f.on ?? top) }
        : f,
    );
  }
  if (isObject(q.rerank?.compare) && typeof q.rerank.compare.by === 'string') {
    out.rerank = {
      ...q.rerank,
      compare: { ...q.rerank.compare, by: map(q.rerank.compare.by, top) },
    };
  }
  return out as Q;
}

// A saved query with its labels resolved and every path bare: what a declared
// query operation stores. `fieldsAt` reads the anchoring type's fields, as the
// engine's own resolution does; a path whose anchor is unknown is stored as
// written (bare), and resolves when the query runs.
export async function resolveSavedQueryLabels<Q>(
  query: Q,
  fieldsAt: FieldsAt,
  // the code ref an anchor stands for: an anchor in a declaration can be the
  // card class itself, or a thunk returning it
  refOf: (anchor: unknown) => CodeRef | undefined = (a) =>
    isCodeRefLike(a) ? a : undefined,
  anchor?: unknown,
): Promise<Q> {
  let wanted: [string, CodeRef][] = [];
  mapQueryPaths(
    query,
    (path, type) => {
      let ref = looksLikeLabel(path) ? refOf(type) : undefined;
      if (ref) wanted.push([path, ref]);
      return path;
    },
    anchor,
  );
  let resolved = new Map<string, string>();
  let keyOf = (path: string, ref: CodeRef) => `${JSON.stringify(ref)} ${path}`;
  for (let [path, ref] of wanted) {
    let key = keyOf(path, ref);
    if (!resolved.has(key)) {
      resolved.set(key, await resolveLabel(ref, path, fieldsAt));
    }
  }
  return mapQueryPaths(
    query,
    (path, type) => {
      let ref = looksLikeLabel(path) ? refOf(type) : undefined;
      return (ref && resolved.get(keyOf(path, ref))) ?? barePath(path);
    },
    anchor,
  );
}

const isCodeRefLike = (v: unknown): v is CodeRef =>
  isObject(v) && typeof v.module === 'string' && typeof v.name === 'string';

// Resolves every field path in a query (filters, sorts, collapse, facets, a
// rerank's comparison set) against the type that anchors it.
export function queryHasLabels(query: Record<string, any>): boolean {
  let found = false;
  let walk = (v: any) => {
    if (found) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      for (let [k, x] of Object.entries(v)) {
        if ((PATH_OPS as readonly string[]).includes(k) && isObject(x)) {
          if (Object.keys(x).some(looksLikeLabel)) found = true;
        } else if ((k === 'by' || k === 'collapse') && typeof x === 'string') {
          if (looksLikeLabel(x)) found = true;
        } else if (k !== 'on' && k !== 'type') walk(x);
      }
    }
  };
  walk(query);
  return found;
}

export async function resolveQueryLabels(
  query: Record<string, any>,
  fieldsAt: FieldsAt,
  // every path, not only those written as labels (a checker with a fixture);
  // `written`: the lowering's quoted labels, for error messages
  opts: { all?: boolean; written?: Record<string, string> } = {},
): Promise<Record<string, any>> {
  let resolve = (type: CodeRef | undefined, path: string) =>
    type && typeof path === 'string' && (opts.all || looksLikeLabel(path))
      ? resolveLabel(type, path, fieldsAt, opts.written)
      : Promise.resolve(path);
  let filter = async (n: any, type: CodeRef | undefined): Promise<any> => {
    if (!isObject(n)) return n;
    let t = (n.on as CodeRef) ?? type;
    let out: Record<string, any> = {};
    for (let [k, v] of Object.entries(n)) {
      if ((k === 'every' || k === 'any') && Array.isArray(v)) {
        out[k] = await Promise.all(v.map((x) => filter(x, t)));
      } else if (k === 'not') {
        out[k] = await filter(v, t);
      } else if ((PATH_OPS as readonly string[]).includes(k) && isObject(v)) {
        let entries = await Promise.all(
          Object.entries(v).map(
            async ([p, x]) => [await resolve(t, p), x] as const,
          ),
        );
        out[k] = Object.fromEntries(entries);
      } else if (k === 'fields' && Array.isArray(v)) {
        out[k] = await Promise.all(v.map((p) => resolve(t, p)));
      } else if (k === 'within' && typeof v === 'string') {
        out[k] = await resolve(t, v);
      } else {
        setOwn(out, k, v);
      }
    }
    return out;
  };
  let anchor: CodeRef | undefined =
    (isObject(query.filter) && (query.filter.on ?? query.filter.type)) ||
    undefined;
  let sortEntry = async (s: any): Promise<any> => {
    if (!isObject(s)) return s;
    let out: Record<string, any> = { ...s };
    let t = (s.on as CodeRef) ?? undefined;
    if (
      typeof s.by === 'string' &&
      t &&
      !s.by.startsWith('_') &&
      !GENERAL_SORTS.has(s.by)
    ) {
      out.by = await resolve(t, s.by);
    }
    if (Array.isArray(s.of)) out.of = await Promise.all(s.of.map(sortEntry));
    if (s.when) out.when = await filter(s.when, t ?? anchor);
    return out;
  };
  let out: Record<string, any> = { ...query };
  if (query.filter) out.filter = await filter(query.filter, undefined);
  if (Array.isArray(query.sort))
    out.sort = await Promise.all(query.sort.map(sortEntry));
  if (isObject(query.collapse) && typeof query.collapse.by === 'string') {
    out.collapse = {
      ...query.collapse,
      by: await resolve(query.collapse.on ?? anchor, query.collapse.by),
    };
  }
  if (Array.isArray(query.facets)) {
    out.facets = await Promise.all(
      query.facets.map(async (f: any) =>
        isObject(f) && typeof f.by === 'string'
          ? { ...f, by: await resolve(f.on ?? anchor, f.by) }
          : f,
      ),
    );
  }
  if (
    isObject(query.rerank?.compare) &&
    typeof query.rerank.compare.by === 'string'
  ) {
    out.rerank = {
      ...query.rerank,
      compare: {
        ...query.rerank.compare,
        by: await resolve(anchor, query.rerank.compare.by),
      },
    };
  }
  return out;
}
