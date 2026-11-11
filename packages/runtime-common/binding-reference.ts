// How a query names a value it computed first, one rule for a `let` binding
// and for `$this` (the card a query-backed field belongs to). It follows
// XQuery's `let $x := …` / `$x/path` and MongoDB's `$$var` / `$literal`:
//
// - A binding is declared with its `$`: `let: { $sofa: { from, one: true } }`.
// - A string value is a reference exactly when it is `$name` or
//   `$name.path` and `$name` is declared (or is `$this` in a field query).
//   Every other string is literal text: `"$100"`, `"$25 gift"`, an
//   undeclared `"$x.y"`.
// - `{ $literal: "<text>" }` is that text, verbatim, wherever a value goes,
//   for the rare literal that would otherwise read a binding.
// - In an expression, `$sofa.priceMin` reads the binding.
//
// No imports from the query modules, so query.ts, query-syntax.ts,
// formula-sql.ts and query-field-utils.ts can all use it.
import { InvalidQueryError } from './invalid-query-error.ts';

const hasOwn = (o: unknown, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

// A binding's declared name: `$` and an identifier.
export const BINDING_NAME = /^\$[A-Za-z_]\w*$/;
// Names no `let` may declare: `$this` is the card of a query-backed field,
// and `$literal` the escape.
export const RESERVED_BINDING_NAMES: ReadonlySet<string> = new Set([
  '$this',
  '$literal',
]);
export const THIS_BINDING = '$this';

const REFERENCE = /^(\$[A-Za-z_]\w*)(?:\.(.*))?$/s;

// The binding a string names, given the names in scope, or undefined when
// the string is literal text. `path` is the dotted path after the name
// (undefined for `$name` alone).
export function bindingReference(
  value: unknown,
  declared: ReadonlySet<string> | readonly string[],
): { name: string; path?: string } | undefined {
  if (typeof value !== 'string' || value[0] !== '$') return undefined;
  let m = REFERENCE.exec(value);
  if (!m) return undefined;
  let names = declared instanceof Set ? declared : new Set(declared);
  if (!names.has(m[1])) return undefined;
  return m[2] === undefined ? { name: m[1] } : { name: m[1], path: m[2] };
}

// `{ $literal: "<text>" }`: the escape. A node with `$literal` and anything
// else, or a value that is not a string, is malformed (`literalProblem`).
export function isLiteralNode(value: unknown): value is { $literal: string } {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, '$literal')
  );
}
export function literalProblem(value: {
  $literal: unknown;
}): string | undefined {
  let keys = Object.keys(value);
  if (keys.length !== 1) {
    return `{ "$literal": … } takes exactly one member, the text; it also has ${keys
      .filter((k) => k !== '$literal')
      .map((k) => JSON.stringify(k))
      .join(', ')}`;
  }
  if (typeof value.$literal !== 'string') {
    return '{ "$literal": … } takes one string, the text to read as written';
  }
  return undefined;
}

// The identifier an expression reads a binding under: the score profile
// parses names, not `$` variables, so `$sofa.priceMin` compiles as
// `_let_sofa.priceMin`. Engine `_` keys are never fields, so it cannot
// shadow one.
export function expressionBindingKey(name: string): string {
  return `_let_${name.replace(/^\$/, '')}`;
}

// An expression with each declared binding's `$name.` read as its
// expression key (`expressionBindingKey`), outside quoted text. An
// undeclared `$x` is left as written (the query profile refuses it as a
// free variable).
export function expressionWithBindings(
  expr: string,
  declared: ReadonlySet<string> | readonly string[],
): string {
  let names = declared instanceof Set ? declared : new Set(declared);
  if (names.size === 0 || !expr.includes('$')) return expr;
  let out = '';
  let i = 0;
  while (i < expr.length) {
    let c = expr[i];
    if (c === '"') {
      let j = i + 1;
      while (j < expr.length) {
        if (expr[j] === '\\') {
          j += 2;
          continue;
        }
        if (expr[j] === '"') {
          if (expr[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '$' && !/[\w$]/.test(expr[i - 1] ?? '')) {
      let m = /^\$[A-Za-z_]\w*/.exec(expr.slice(i));
      if (m && names.has(m[0]) && expr[i + m[0].length] === '.') {
        out += expressionBindingKey(m[0]);
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

// Each binding's card keyed as an expression reads it.
export function expressionBindings<T>(
  cards: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(cards).map(([name, card]) => [
      name.startsWith('$') ? expressionBindingKey(name) : name,
      card,
    ]),
  );
}

// What a one-card reference reads when there is nothing there: the binding
// found no card, or the card has no value at the path. As with `$this`, a
// query holding such a reference answers no rows.
export const NO_BINDING_VALUE: unique symbol = Symbol('no binding value');

// These members hold names, paths and types, never a value a binding could
// stand in for.
const NOT_VALUE_KEYS = new Set([
  'on',
  'type',
  'by',
  'direction',
  'missing',
  'select',
  'log',
  'logs',
  'within',
  'fields',
  'scope',
  'timeZone',
  'method',
]);
const EXPRESSION_KEYS = new Set(['expression', 'expr']);
// The operators whose members are field paths.
const FIELD_MAP_KEYS = new Set([
  'eq',
  'in',
  'contains',
  'range',
  'pattern',
  'regex',
  'near',
]);

// The grammar's boundary for bindings: a string that names a declared
// binding becomes the engine's reference (`LetReference`), `{ $literal }`
// becomes its text, and each one-card binding's `$name.` in an expression
// reads as its expression key (binding-reference.ts). A `{ "$let" }` object
// a caller wrote is refused with the string to write instead. Idempotent:
// the references it made are left as they are.
export function internBindingReferences<T>(query: T): T {
  let q = query as any;
  if (!q || typeof q !== 'object' || Array.isArray(q)) return query;
  let lets =
    q.let && typeof q.let === 'object' && !Array.isArray(q.let) ? q.let : {};
  let declared = new Set(
    Object.keys(lets).filter(
      (n) => BINDING_NAME.test(n) && !RESERVED_BINDING_NAMES.has(n),
    ),
  );
  let cards = new Set(
    [...declared].filter(
      (n) => lets[n] && typeof lets[n] === 'object' && lets[n].one === true,
    ),
  );
  let walk = (v: unknown, key?: string, fieldMap = false): unknown => {
    if (typeof v === 'string') {
      if (key !== undefined && EXPRESSION_KEYS.has(key)) {
        return expressionWithBindings(v, cards);
      }
      let ref = bindingReference(v, declared);
      return ref
        ? {
            $let: ref.name,
            ...(ref.path !== undefined ? { path: ref.path } : {}),
          }
        : v;
    }
    if (Array.isArray(v)) return v.map((e) => walk(e));
    if (!v || typeof v !== 'object') return v;
    if (isLiteralNode(v)) {
      let problem = literalProblem(v);
      if (problem) throw new InvalidQueryError(problem, 'invalid-value');
      // Text that would read as a binding stays escaped until the engine
      // has resolved the bindings (`unwrapLiterals`), so a second pass
      // never reads it as one.
      return bindingReference(v.$literal, declared) ? v : v.$literal;
    }
    if (hasOwn(v, '$let')) {
      let name = (v as { $let: unknown }).$let;
      if (typeof name === 'string' && name.startsWith('$')) return v;
      let path = (v as { path?: unknown }).path;
      let bare = typeof name === 'string' ? name : 'name';
      let written = `$${bare}${typeof path === 'string' ? `.${path.replace(/^item\./, '')}` : ''}`;
      throw new InvalidQueryError(
        `{ "$let": ${JSON.stringify(name)} } is not how a query reads a binding: declare it with its $ (let: { "$${bare}": … }) and write the string "${written}"`,
        'unknown-key',
      );
    }
    let out: Record<string, unknown> = {};
    for (let [k, e] of Object.entries(v)) {
      // a field-keyed map's keys are field names (a field may be called
      // `select` or `on`), and each value is a value
      // an own key, even one named `__proto__` (it is then refused as a
      // field the type lacks, not lost)
      Object.defineProperty(out, k, {
        value: fieldMap
          ? walk(e)
          : NOT_VALUE_KEYS.has(k) && typeof e === 'string'
            ? e
            : walk(e, k, FIELD_MAP_KEYS.has(k)),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  };
  let out: any = { ...q };
  for (let member of ['filter', 'sort', 'rerank']) {
    if (hasOwn(q, member)) out[member] = walk(q[member]);
  }
  if (q.let && typeof q.let === 'object' && !Array.isArray(q.let)) {
    out.let = Object.fromEntries(
      Object.entries(q.let).map(([name, b]: [string, any]) => [
        name,
        b &&
        typeof b === 'object' &&
        !Array.isArray(b) &&
        b.from &&
        typeof b.from === 'object' &&
        !Array.isArray(b.from)
          ? {
              ...b,
              from: {
                ...b.from,
                ...(hasOwn(b.from, 'filter')
                  ? { filter: walk(b.from.filter) }
                  : {}),
                ...(hasOwn(b.from, 'sort') ? { sort: walk(b.from.sort) } : {}),
              },
            }
          : b,
      ]),
    );
  }
  return out;
}

// Each `{ $literal }` left in a filter or sort as its text: the last step of
// reading a query's bindings, once every reference has been resolved.
// A node holding no literal is returned as it is (the same object), so what
// the engine keeps per sort entry by identity (an expression sort's clock
// reading and bindings) survives the step.
export function unwrapLiterals<T>(node: T): T {
  let walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let mapped = v.map(walk);
      return mapped.every((e, i) => e === v[i]) ? v : mapped;
    }
    if (!v || typeof v !== 'object') return v;
    if (isLiteralNode(v) && typeof v.$literal === 'string') return v.$literal;
    let out: Record<string, unknown> = {};
    let changed = false;
    for (let [k, e] of Object.entries(v)) {
      let w = walk(e);
      if (w !== e) changed = true;
      // an own key, even one named `__proto__`
      Object.defineProperty(out, k, {
        value: w,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return changed ? out : v;
  };
  return walk(node) as T;
}
