// The one filter compiler: `every`, `any` and `not` composition with its
// polarity, the `eq` / `in` / `contains` / `range` dispatch, and the
// missing-value rule, over a source that reads and tests its own fields.
// Cards (filter-compiler.ts) test fields through their definitions; log
// lines (log-query.ts) through the line's columns and entry paths.
// Owns: what each shared operator means, for every source.
// Must not: read a field, coerce a value, or know a table.
// Guarantees: docs/search.md ("Filters", "Edge cases and what is
// guaranteed", "Searching a log").

import { refuse } from '../query-v2/query-refusals.ts';
import {
  type CardExpression,
  addExplicitParens,
  any,
  every,
} from '../expression.ts';
import { escapeLikePattern } from './filter-sql.ts';
import { type FilterPolarity, flipPolarity } from './types.ts';
import type * as JSONTypes from 'json-typescript';

// How a source answers a field test, and what it adds of its own. `S` is
// what a test resolves in (cards: the type and the filter context; logs:
// the query's clock and how a `file` value names a log).
//
// A missing value is unknown (SQL NULL) to `eq`, `in`, `like` and `range`,
// so neither a filter nor its `not` keeps it. A test may lean on false for
// unknown at `positive` polarity only (a containment the index answers):
// there the two drop the same rows. At `negated` polarity (an odd number of
// enclosing `not`s) it must stay unknown.
export interface FilterSource<S> {
  // A node the source compiles itself (cards: type anchors, `near`,
  // `linkedFrom`, text, patterns, and its indexed rewrites of `every` and
  // `any`), or undefined for the shared operators below.
  node?(
    filter: object,
    scope: S,
    polarity: FilterPolarity,
  ): CardExpression | undefined;
  // The scope a node's fields resolve in, and the conjuncts its anchor adds
  // (cards: the type test of a node's `on` or `type`).
  anchor(filter: object, scope: S): { scope: S; conjuncts: CardExpression[] };
  // The scope inside an `any`.
  inAny?(scope: S): S;
  // The scope of a `not`'s operand: a test there is no conjunct of the
  // whole filter, whatever its polarity (a `not` of a conjunction is a
  // disjunction).
  inNot?(scope: S): S;
  eq(
    scope: S,
    path: string,
    value: JSONTypes.Value,
    polarity: FilterPolarity,
  ): CardExpression;
  // An `every` of eqs on one field at once: all of `values` (strings, at
  // least two, distinct) hold. Undefined where the source would compile them
  // differently one by one, and then each is compiled alone.
  eqAll?(
    scope: S,
    path: string,
    values: string[],
    polarity: FilterPolarity,
  ): CardExpression | undefined;
  // `values` are present (no null) and not empty.
  in(
    scope: S,
    path: string,
    values: JSONTypes.Value[],
    polarity: FilterPolarity,
  ): CardExpression;
  // An ILIKE against `pattern`, already escaped and wrapped in `%`.
  like(scope: S, path: string, pattern: string): CardExpression;
  range(
    scope: S,
    path: string,
    bounds: Record<string, unknown>,
    polarity?: FilterPolarity,
  ): CardExpression;
  missing(scope: S, path: string): CardExpression;
  // A node no operator here or in `node` compiles.
  refuse(filter: object): Error;
}

type Node = Record<string, any>;

export function compileFilterTree<S>(
  filter: object,
  source: FilterSource<S>,
  scope: S,
  polarity: FilterPolarity,
): CardExpression {
  let own = source.node?.(filter, scope, polarity);
  if (own) {
    return own;
  }
  let node = filter as Node;
  let anchored = source.anchor(filter, scope);
  let inner = anchored.scope;
  let perField = <V>(
    fields: Record<string, V>,
    test: (path: string, value: V) => CardExpression,
  ): CardExpression =>
    every([
      ...anchored.conjuncts,
      ...Object.entries(fields).map(([path, value]) => test(path, value)),
    ]);

  if ('eq' in node) {
    return perField<JSONTypes.Value>(node.eq, (path, value) =>
      value === null
        ? source.missing(inner, path)
        : source.eq(inner, path, value, polarity),
    );
  }
  if ('in' in node) {
    return perField<JSONTypes.Value[]>(node.in, (path, values) => {
      if (values.length === 0) {
        return ['false'];
      }
      let present = values.filter((v) => v !== null);
      let conditions: CardExpression[] = [];
      if (present.length > 0) {
        conditions.push(source.in(inner, path, present, polarity));
      }
      if (present.length !== values.length) {
        conditions.push(source.missing(inner, path));
      }
      return conditions.length === 1 ? conditions[0] : any(conditions);
    });
  }
  if ('contains' in node) {
    return perField<JSONTypes.Value>(node.contains, (path, value) => {
      if (value !== null && typeof value === 'object') {
        throw refuse('contains-takes-text-find', undefined, {
          path,
          value1: Array.isArray(value) ? 'a list' : 'an object',
        });
      }
      return value === null
        ? source.missing(inner, path)
        : source.like(inner, path, `%${escapeLikePattern(String(value))}%`);
    });
  }
  if ('not' in node) {
    return every([
      ...anchored.conjuncts,
      [
        'NOT',
        ...addExplicitParens(
          compileFilterTree(
            node.not,
            source,
            source.inNot ? source.inNot(inner) : inner,
            flipPolarity(polarity),
          ),
        ),
      ],
    ]);
  }
  if ('range' in node) {
    return perField<Record<string, unknown>>(node.range, (path, bounds) => {
      if (Object.values(bounds).some((v) => v == null)) {
        throw new Error(`'null' is not a permitted value in a 'range' filter`);
      }
      return source.range(inner, path, bounds, polarity);
    });
  }
  if ('every' in node) {
    let parts = foldEveryEqs(
      node.every as object[],
      polarity,
      source.eqAll
        ? (path, values) => source.eqAll!(inner, path, values, polarity)
        : undefined,
      (child) => compileFilterTree(child, source, inner, polarity),
    );
    return every([...anchored.conjuncts, ...parts]);
  }
  if ('any' in node) {
    let branch = source.inAny ? source.inAny(inner) : inner;
    return every([
      ...anchored.conjuncts,
      any(
        (node.any as object[]).map((child) =>
          compileFilterTree(child, source, branch, polarity),
        ),
      ),
    ]);
  }
  // As the card grammar lowers them: `missing` is `eq` null, `exists` its
  // `not`.
  if ('missing' in node || 'exists' in node) {
    let test = { eq: { [node.missing ?? node.exists]: null } };
    return every([
      ...anchored.conjuncts,
      compileFilterTree(
        'missing' in node ? test : { not: test },
        source,
        inner,
        polarity,
      ),
    ]);
  }
  throw source.refuse(filter);
}

// A single-key string `eq` on a field (`{ eq: { path: value } }`): the
// members of an `every` that fold.
function plainEq(child: object): [string, string] | undefined {
  let keys = Object.keys(child);
  if (keys.length !== 1 || keys[0] !== 'eq') return undefined;
  let entries = Object.entries((child as Node).eq as object);
  if (entries.length !== 1) return undefined;
  let [path, value] = entries[0];
  return typeof value === 'string' ? [path, value] : undefined;
}

// The conditions of an `every`'s members, its eqs on one field folded into
// one condition (`eqAll`) where there are two or more distinct values and
// `eqAll` takes them; every other member, and any group `eqAll` declines,
// compiled alone by `compile`. Only at positive polarity, where "all of
// them hold" is what the AND means.
export function foldEveryEqs(
  children: object[],
  polarity: FilterPolarity,
  eqAll:
    | ((path: string, values: string[]) => CardExpression | undefined)
    | undefined,
  compile: (child: object) => CardExpression | undefined,
): CardExpression[] {
  let byPath = new Map<string, string[]>();
  if (eqAll && polarity === 'positive') {
    for (let child of children) {
      let eq = plainEq(child);
      if (eq) {
        let values = byPath.get(eq[0]) ?? [];
        if (!values.includes(eq[1])) values.push(eq[1]);
        byPath.set(eq[0], values);
      }
    }
  }
  let folded = new Map<string, CardExpression | undefined>();
  let parts: CardExpression[] = [];
  for (let child of children) {
    let eq = plainEq(child);
    let values = eq ? byPath.get(eq[0]) : undefined;
    if (eq && values && values.length > 1) {
      if (!folded.has(eq[0])) {
        let all = eqAll!(eq[0], values);
        folded.set(eq[0], all);
        if (all) {
          parts.push(all);
          continue;
        }
      } else if (folded.get(eq[0])) {
        continue;
      }
    }
    let compiled = compile(child);
    if (compiled) parts.push(compiled);
  }
  return parts;
}
