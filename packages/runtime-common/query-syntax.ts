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
// here, each with a code: an `on` with no predicate, a field sort with no
// type anywhere, a field the type does not have (with the nearest name).
//
// `lowerQuery` is synchronous and needs nothing but the query.
// `resolveQueryLabels` reads the type's fields, so it runs where definitions
// are at hand (the engine, or a checker with a fixture).
import { InvalidQueryError } from './invalid-query-error.ts';
import { exprSortSql, registerQueryLowering } from './query.ts';
import type { CodeRef } from './code-ref.ts';

export class QuerySyntaxError extends InvalidQueryError {
  constructor(code: string, message: string) {
    super(message, code);
  }
}

export interface LoweringNotes {
  // Where each `formula` sort runs: in SQL over every match, or over the
  // top window when the score profile cannot express it.
  formula?: { placement: 'sql' | 'top'; reason?: string };
}

export interface LoweredQuery {
  query: Record<string, any>;
  notes: LoweringNotes;
}

// Sort keys that are not card fields and need no type.
const GENERAL_SORTS = new Set(['lastModified', 'createdAt', 'cardURL']);
const ENGINE_SORTS = new Set([
  '_blend',
  '_relevance',
  '_matchRelevance',
  '_when',
  '_expr',
]);
const PATH_OPS = [
  'eq',
  'in',
  'range',
  'contains',
  'near',
  'pattern',
  'regex',
] as const;
const DEFAULT_FORMULA_TOP = 500;

const isObject = (v: unknown): v is Record<string, any> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

// A field path as the engine reads it: no `item.`, no surrounding quotes.
// The quoted labels lowering has turned into names, so an error can quote
// the label as the author wrote it.
const QUOTED = new Map<string, string>();

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
    if (QUOTED.size > 1000) QUOTED.clear();
    QUOTED.set(name, p.slice(1, -1));
    return name;
  }
  return p;
}

// Whether a query uses any of the newer spellings.
export function usesNewSyntax(query: unknown): boolean {
  if (!isObject(query)) return false;
  if ('type' in query) return true;
  let found = false;
  let visitFilter = (n: unknown): void => {
    if (found || !isObject(n)) return;
    if ('exists' in n || 'missing' in n) {
      found = true;
      return;
    }
    // a bare anchor: every card of the type
    if (Object.keys(n).length === 1 && 'on' in n) {
      found = true;
      return;
    }
    for (let k of ['every', 'any'])
      if (Array.isArray(n[k])) n[k].forEach(visitFilter);
    if (n.not) visitFilter(n.not);
  };
  visitFilter(query.filter);
  for (let s of Array.isArray(query.sort) ? query.sort : []) {
    if (isObject(s) && ('blend' in s || 'formula' in s || 'boost' in s)) {
      found = true;
    }
  }
  // a path written with `item.` or as a quoted label
  let spelled = (p: unknown) =>
    typeof p === 'string' && (p.startsWith('item.') || p.startsWith('"'));
  let walk = (v: any) => {
    if (found || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (let [k, x] of Object.entries(v)) {
      if ((PATH_OPS as readonly string[]).includes(k) && isObject(x)) {
        if (Object.keys(x).some(spelled)) found = true;
      } else if ((k === 'by' || k === 'collapse') && spelled(x)) {
        found = true;
      } else if (k !== 'on' && k !== 'type') walk(x);
    }
  };
  walk({
    filter: query.filter,
    sort: query.sort,
    collapse: query.collapse,
    facets: query.facets,
  });
  return found;
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
      let test = { eq: { [barePath(v)]: null } };
      let lowered = k === 'missing' ? test : { not: test };
      return node.on ? { on: node.on, ...lowered } : lowered;
    } else if (k === 'fields' && Array.isArray(v)) {
      out[k] = v.map((p) => (typeof p === 'string' ? barePath(p) : p));
    } else {
      out[k] = v;
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

function lowerSignal(entry: any, type: CodeRef | undefined): any {
  if (!isObject(entry)) return entry;
  if ('boost' in entry) {
    let { boost, ...rest } = entry;
    let when = isObject(boost) && 'when' in boost ? boost.when : boost;
    return { by: '_when', ...rest, when: anchored(when, type) };
  }
  if ('formula' in entry) {
    let { formula, ...rest } = entry;
    return { by: '_expr', expr: formula, ...rest };
  }
  return lowerFieldSort(entry, type);
}

function lowerFieldSort(entry: any, type: CodeRef | undefined): any {
  if (!isObject(entry) || typeof entry.by !== 'string') return entry;
  let by = barePath(entry.by);
  let out: Record<string, any> = { ...entry, by };
  if (by === '_when' && entry.when) out.when = anchored(entry.when, type);
  if (Array.isArray(entry.of))
    out.of = entry.of.map((s: any) => lowerSignal(s, type));
  if (!ENGINE_SORTS.has(by) && !GENERAL_SORTS.has(by) && !entry.on) {
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

const FUNCTION_CALL = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g;

// Where a `formula` sort runs, and the functions it calls that BXL does not
// know (an error rather than a blank value per row).
export function placeFormula(
  expr: string,
  knownFunctions: ReadonlySet<string> | undefined,
): { placement: 'sql' | 'top'; reason?: string } {
  if (knownFunctions) {
    let unknown = [...expr.matchAll(FUNCTION_CALL)]
      .map((m) => m[1].toUpperCase())
      .filter((name) => !knownFunctions.has(name));
    if (unknown.length) {
      throw new QuerySyntaxError(
        'unknown-function',
        `formula: ${[...new Set(unknown)].join(', ')} ${unknown.length > 1 ? 'are not functions' : 'is not a function'} BXL knows`,
      );
    }
  }
  try {
    exprSortSql(expr);
    return { placement: 'sql' };
  } catch (e) {
    return {
      placement: 'top',
      reason: (e as Error).message.replace(/^formula: /, ''),
    };
  }
}

export interface LowerOptions {
  // BXL's function names (upper case), to refuse an unknown function.
  knownFunctions?: ReadonlySet<string>;
}

export function lowerQuery(
  input: Record<string, any>,
  opts: LowerOptions = {},
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
      'type must name a card type ({ module, name })',
    );
  }
  let query: Record<string, any> = { ...rest };

  // filter: every clause inherits the type
  if (query.filter !== undefined) {
    let f = lowerFilter(query.filter, type);
    if (declared && isObject(f) && !('on' in f) && !('type' in f)) {
      f = {
        on: type,
        every:
          Array.isArray(f.every) && Object.keys(f).length === 1 ? f.every : [f],
      };
    }
    query.filter = f;
  } else if (declared) {
    query.filter = { type: declared };
  }

  // sort: signal kinds by key, field entries anchored
  if (Array.isArray(query.sort)) {
    let sort: any[] = [];
    for (let entry of query.sort) {
      if (isObject(entry) && 'blend' in entry) {
        let { blend, ...more } = entry;
        sort.push({
          by: '_blend',
          ...more,
          of: (Array.isArray(blend) ? blend : []).map((s) =>
            lowerSignal(s, type),
          ),
        });
      } else if (isObject(entry) && 'formula' in entry) {
        let { formula, placement, direction, ...more } = entry;
        let placed =
          placement === 'top'
            ? { placement: 'top' as const, reason: 'asked for' }
            : placeFormula(formula, opts.knownFunctions);
        if (placement === 'top') placeFormula(formula, opts.knownFunctions);
        notes.formula = placed;
        if (placed.placement === 'sql') {
          sort.push({
            by: '_expr',
            expr: formula,
            ...(direction ? { direction } : {}),
            ...more,
          });
        } else {
          // over the top window, in BXL's full library
          query.rerank = {
            expr: formula,
            top: DEFAULT_FORMULA_TOP,
            ...(direction ? { direction } : {}),
            ...(query.rerank ?? {}),
          };
        }
      } else {
        sort.push(lowerSignal(entry, type));
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
    let written = QUOTED.get(barePath(label)) ?? label;
    throw new QuerySyntaxError(
      'unknown-field',
      `"${written}" is not a field${where} on ${(type as any).name ?? 'this type'}${nearest ? `; did you mean "${[...out, nearest].join('.')}"?` : ''}`,
    );
  }
  return out.join('.');
}

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
  // every path, not only those written as labels (a checker with a fixture)
  opts: { all?: boolean } = {},
): Promise<Record<string, any>> {
  let resolve = (type: CodeRef | undefined, path: string) =>
    type && typeof path === 'string' && (opts.all || looksLikeLabel(path))
      ? resolveLabel(type, path, fieldsAt)
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
      } else {
        out[k] = v;
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

// assertQuery checks a query in the newer spellings by its lowered form.
registerQueryLowering((query) =>
  usesNewSyntax(query) ? lowerQuery(query).query : query,
);
