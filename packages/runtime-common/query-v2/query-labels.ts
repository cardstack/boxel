// Saved-query labels: a field written as its label (`PriceMin`, `"Units Sold
// 30d"`) resolved to its path against the type's fields (docs/search.md,
// "One type for the whole query").
import { refuse } from './query-refusals.ts';
import type { CodeRef } from '../code-ref.ts';
import {
  GENERAL_SORTS,
  PATH_OPS,
  TEXT_RELEVANCE,
  barePath,
  hasOwn,
  isObject,
  setOwn,
} from './query-syntax.ts';

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
    throw refuse('not-field', where, {
      asWritten,
      type: (type as any).name ?? 'this type',
      nearest: nearest
        ? `; did you mean "${[...out, nearest].join('.')}"?`
        : '',
    });
  }
  return out.join('.');
}

// A facet measure (`{ avg: 'priceMin' }`) with its field rewritten by `map`.
export function mapMeasure(
  measure: Record<string, unknown>,
  map: (path: string) => string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(measure).map(([op, p]) => [
      op,
      typeof p === 'string' ? map(p) : p,
    ]),
  );
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
        ? {
            ...f,
            by: map(f.by, f.on ?? top),
            ...(isObject(f.measure)
              ? { measure: mapMeasure(f.measure, (p) => map(p, f.on ?? top)) }
              : {}),
          }
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
        } else if (k === 'measure' && isObject(x)) {
          if (
            Object.values(x).some(
              (p) => typeof p === 'string' && looksLikeLabel(p),
            )
          )
            found = true;
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
          ? {
              ...f,
              by: await resolve(f.on ?? anchor, f.by),
              ...(isObject(f.measure)
                ? {
                    measure: Object.fromEntries(
                      await Promise.all(
                        Object.entries(f.measure).map(
                          async ([op, p]) =>
                            [
                              op,
                              typeof p === 'string'
                                ? await resolve(f.on ?? anchor, p)
                                : p,
                            ] as const,
                        ),
                      ),
                    ),
                  }
                : {}),
            }
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
