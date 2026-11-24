// What a query asks of the index that only Postgres runs, rewritten to the
// closest thing the browser's index (SQLite) can run.
//
// Owns: the rewrite of a query's filter, sort and rerank on SQLite, and the
// warning that names each approximation (`meta.warnings`, docs/search.md
// "On SQLite"). A SQLite search answers with less relevant results, never an
// error, for a feature only Postgres has.
// Must not: run on Postgres (dialect.ts calls it only for SQLite), or let an
// invalid query through: a regex that is no regular expression is refused on
// both indexes.
// Guarantees: a predicate SQLite cannot test is left out as if the query had
// not asked for it, under any polarity: it is dropped from its `every`, from
// its `any` (an `any` left with no branches is dropped too, never matched as
// nothing), and with its `not`. A regex with a glob form runs as that
// `pattern` instead, ignoring case as a glob does.

import type { CodeRef } from '../index.ts';
import type { Filter, Rerank, Sort } from '../query-v2/query.ts';
import { refuse } from '../query-v2/query-refusals.ts';
import { EXPR_SORT_KEY } from '../query-v2/query-values.ts';
import { setOwn } from '../query-v2/query-syntax.ts';
import { BLEND_SORT_KEY } from './types.ts';

export interface Approximation {
  code: string;
  message: string;
}

export interface ApproximatedQuery {
  filter?: Filter;
  sort?: Sort;
  rerank?: Rerank;
}

// A regex's path left out of the filter, with the type it is read on, so the
// field checks a regex gets (searched by pattern) still run.
export interface DroppedRegex {
  on?: CodeRef;
  path: string;
}

// The query with what the index lacks rewritten: regular expressions, and
// expressions in SQL (formula sorts, a rerank). SQLite lacks both.
export function approximateForSqlite(
  query: ApproximatedQuery,
  has: { regularExpressions: boolean; expressions: boolean } = {
    regularExpressions: false,
    expressions: false,
  },
): ApproximatedQuery & {
  warnings: Approximation[];
  dropped: DroppedRegex[];
} {
  let warnings: Approximation[] = [];
  let dropped: DroppedRegex[] = [];
  let filter =
    query.filter && !has.regularExpressions
      ? withoutRegex(query.filter, true, undefined, warnings, dropped)
      : query.filter;
  let sort =
    query.sort && !has.expressions
      ? withoutFormulas(query.sort, warnings)
      : query.sort;
  let rerank = query.rerank;
  if (rerank && !has.expressions) {
    warnings.push({
      code: 'sqlite-rerank-skipped',
      message:
        'the rerank by an expression (its top window, comparison set and look-alikes) runs on Postgres only, so the results keep the sort order',
    });
    rerank = undefined;
  }
  return { filter, sort, rerank, warnings, dropped };
}

// The filter with each regex as its glob, or left out. `conjunctive` is
// whether the node is ANDed into its parent (the root, or an `every`
// member), where a dropped regex keeps its node's type anchor.
function withoutRegex(
  node: Filter,
  conjunctive: boolean,
  inheritedOn: CodeRef | undefined,
  warnings: Approximation[],
  dropped: DroppedRegex[],
): Filter | undefined {
  if (!holdsRegex(node)) return node;
  let n = node as Record<string, any>;
  let on: CodeRef | undefined = n.on ?? n.type ?? inheritedOn;
  let anchorOnly = () =>
    conjunctive && (n.on || n.type) ? { type: n.on ?? n.type } : undefined;
  if (Array.isArray(n.every)) {
    let members = (n.every as Filter[])
      .map((m) => withoutRegex(m, true, on, warnings, dropped))
      .filter((m): m is Filter => m !== undefined);
    return members.length ? ({ ...n, every: members } as Filter) : anchorOnly();
  }
  if (Array.isArray(n.any)) {
    let branches = (n.any as Filter[])
      .map((m) => withoutRegex(m, false, on, warnings, dropped))
      .filter((m): m is Filter => m !== undefined);
    return branches.length ? ({ ...n, any: branches } as Filter) : anchorOnly();
  }
  if (n.not) {
    let inner = withoutRegex(n.not, false, on, warnings, dropped);
    return inner ? ({ ...n, not: inner } as Filter) : anchorOnly();
  }
  // a regex node
  let pattern: Record<string, string> = { ...(n.pattern ?? {}) };
  for (let [path, regex] of Object.entries(n.regex as Record<string, string>)) {
    assertRegex(path, regex);
    let glob = regexAsGlob(regex);
    if (glob !== undefined) {
      // own, so a path such as `__proto__` stays a key the engine reads
      setOwn(pattern, path, glob);
      warnings.push({
        code: 'sqlite-regex-as-pattern',
        message: `the regex on "${path}" ran as the pattern "${glob}", ignoring case: this index (SQLite) has no regular expressions`,
      });
    } else {
      dropped.push({ on, path });
      warnings.push({
        code: 'sqlite-regex-dropped',
        message: `the regex on "${path}" was left out of the filter: this index (SQLite) has no regular expressions, and it has no pattern form`,
      });
    }
  }
  let { regex: _regex, pattern: _pattern, ...rest } = n;
  if (Object.keys(pattern).length) {
    return { ...rest, pattern } as Filter;
  }
  return anchorOnly();
}

function holdsRegex(node: unknown): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  let n = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(n, 'regex')) return true;
  return (
    (Array.isArray(n.every) && n.every.some(holdsRegex)) ||
    (Array.isArray(n.any) && n.any.some(holdsRegex)) ||
    holdsRegex(n.not)
  );
}

// A regex that is no regular expression is refused here as on Postgres
// (`regex-regular-expression-postgres-2`), by JavaScript's reading of it.
function assertRegex(path: string, regex: string) {
  try {
    new RegExp(regex);
  } catch (e) {
    throw refuse('regex-regular-expression-postgres-2', undefined, {
      path,
      value1: String((e as Error)?.message ?? 'invalid'),
    });
  }
}

// The regex as a `pattern` glob, when it has one: literal text, `^` and `$`
// at its ends, `.` (one character), `.*` and `.+`, and a backslash before a
// punctuation mark. Undefined for anything else (a class, a group, an
// alternation, a quantifier on a character, a literal `*` or `?`, which a
// glob cannot spell).
export function regexAsGlob(regex: string): string | undefined {
  let body = regex;
  let start = body.startsWith('^');
  if (start) body = body.slice(1);
  let end = body.endsWith('$') && !body.endsWith('\\$');
  if (end) body = body.slice(0, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    let c = body[i];
    if (c === '.') {
      let next = body[i + 1];
      if (next === '*') {
        out += '**';
        i++;
      } else if (next === '+') {
        out += '?**';
        i++;
      } else if (next === '?' || next === '{') {
        return undefined;
      } else {
        out += '?';
      }
    } else if (c === '\\') {
      let next = body[i + 1];
      if (next === undefined || /[A-Za-z0-9*?]/.test(next)) return undefined;
      out += next;
      i++;
    } else if (/[\^$|+?*()[\]{}]/.test(c)) {
      return undefined;
    } else if (/[+?*{]/.test(body[i + 1] ?? '')) {
      // a quantifier on this character
      return undefined;
    } else {
      out += c;
    }
  }
  return `${start ? '' : '**'}${out}${end ? '' : '**'}`;
}

// The sort without its formula (`_expr`) entries, which run through the
// score profile's Postgres functions; a blend keeps its other signals.
function withoutFormulas(
  sort: Sort,
  warnings: Approximation[],
): Sort | undefined {
  let isFormula = (s: unknown) =>
    (s as { by?: unknown } | undefined)?.by === EXPR_SORT_KEY;
  let isBlend = (s: unknown) =>
    (s as { by?: unknown } | undefined)?.by === BLEND_SORT_KEY;
  if (
    !sort.some(
      (s) =>
        isFormula(s) ||
        (isBlend(s) && (s as { of: unknown[] }).of.some(isFormula)),
    )
  ) {
    return sort;
  }
  let out: Sort = [];
  for (let entry of sort) {
    if (isFormula(entry)) {
      warnings.push(formulaDropped((entry as { expr: string }).expr));
    } else if (isBlend(entry)) {
      let of = (entry as { of: unknown[] }).of;
      for (let s of of.filter(isFormula)) {
        warnings.push(formulaDropped((s as { expr: string }).expr));
      }
      let kept = of.filter((s) => !isFormula(s));
      if (kept.length) {
        out.push({ ...entry, of: kept } as Sort[number]);
      }
    } else {
      out.push(entry);
    }
  }
  return out.length ? out : undefined;
}

function formulaDropped(expr: string): Approximation {
  return {
    code: 'sqlite-formula-sort-dropped',
    message: `the sort by the formula "${expr}" was left out: formulas run on Postgres only, so the rest of the order applies`,
  };
}

// The answer's `meta.warnings` with the search's approximations added, each
// once.
export function withApproximations(
  meta: { warnings?: { code: string; message: string; realms?: string[] }[] },
  approximations: Approximation[],
) {
  if (approximations.length === 0) return;
  let warnings = [...(meta.warnings ?? [])];
  for (let a of approximations) {
    if (!warnings.some((w) => w.code === a.code && w.message === a.message)) {
      warnings.push(a);
    }
  }
  meta.warnings = warnings;
}
