// `let` bindings: one-card bindings resolved before the query runs, list
// bindings (a card query or a log) read into values that stand in for each
// `$name` reference, and syncing a log a binding reads before the snapshot.
// Owns: binding resolution and its `meta.lets`.
// Must not: run the outer query (it hands rewritten filter and sort back to
// the pipeline).
// Guarantees: docs/search.md ("Bindings (`let`, `$this`, `$literal`)").

import {
  type CardReferenceRole,
  type Filter,
  InvalidQueryError,
  type LetBinding,
  MAX_LET_ROWS,
  MAX_LET_VALUES,
  type Query,
  type Sort,
  isCardTypeFilter,
  isExprSort,
  isLogBinding,
  logBindingSelect,
  mapCardReferences,
  mapLetReferences,
} from '../query.ts';
import { Facets } from './facets.ts';
import type * as JSONTypes from 'json-typescript';
import {
  type LogFilter,
  type LogSource,
  ensureLogsIndexed,
  logBindingValues,
  resolveLogURL,
} from '../log-query.ts';
import { NO_BINDING_VALUE, expressionBindings } from '../binding-reference.ts';
import type { QueryOptions, QueryResultsMeta } from './types.ts';
import { isRealmUnion, realmOfCard } from '../realm-union.ts';

function joinableLet(
  binding: LetBinding,
): { card: string; field: string } | undefined {
  if (
    isLogBinding(binding) ||
    binding.from.sort ||
    !binding.select?.endsWith('.id')
  ) {
    return undefined;
  }
  let node: any = binding.from.filter;
  if (node && Array.isArray(node.every)) {
    let rest = node.every.filter((n: any) => !isCardTypeFilter(n));
    node = rest.length === 1 ? rest[0] : undefined;
  }
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  let keys = Object.keys(node).filter((k) => k !== 'on' && k !== 'type');
  let id = keys.length === 1 && keys[0] === 'eq' ? node.eq?.id : undefined;
  if (typeof id !== 'string' || Object.keys(node.eq).length !== 1) {
    return undefined;
  }
  return { card: id, field: binding.select!.slice(0, -'.id'.length) };
}

export abstract class Bindings extends Facets {
  protected async resolveCardLets(
    realmURL: URL,
    query: Pick<Query, 'filter' | 'sort' | 'rerank' | 'let'>,
    opts: QueryOptions,
  ): Promise<{
    filter: Filter | undefined;
    sort: Sort | undefined;
    rerank: Query['rerank'];
    lets: Record<string, LetBinding> | undefined;
    letMeta: NonNullable<QueryResultsMeta['lets']>;
  }> {
    let cards: Record<string, Record<string, unknown> | null> = {};
    let rest: Record<string, LetBinding> = {};
    let letMeta: NonNullable<QueryResultsMeta['lets']> = {};
    // Each bound card's own vectors, by field path, read from the vector
    // table: a vector is not in the card's JSON when it lives in a sidecar.
    let vectorsOf: Record<
      string,
      Map<string, { space: string; components: number[] }>
    > = {};
    for (let [name, binding] of Object.entries(query.let ?? {})) {
      if (isLogBinding(binding) && binding.one) {
        throw new InvalidQueryError(
          `let: "${name}" is read from a log, so it is a list: { from: { log, filter }, select }`,
          'invalid-value',
        );
      }
      if (!binding.one) {
        rest[name] = binding;
        continue;
      }
      let { results } = await this._search(
        realmURL,
        {
          filter: binding.from.filter,
          sort: binding.from.sort,
          page: { size: 1 },
          // a binding's own zone, else the query's (carried by opts)
          ...(binding.from.timeZone !== undefined
            ? { timeZone: binding.from.timeZone }
            : {}),
        },
        { ...opts, cardUrls: undefined },
        ['SELECT i.url AS url, ANY_VALUE(i.search_doc) AS search_doc'],
        'instance',
      );
      let first = results[0] as
        | { url?: string; search_doc?: unknown }
        | undefined;
      let doc = first?.search_doc;
      if (first?.url) {
        vectorsOf[name] = await this.vectors.oneCardVectors(
          // in a union, the realm the card is in
          isRealmUnion(realmURL)
            ? new URL(realmOfCard(realmURL, first.url) ?? realmURL.href)
            : realmURL,
          first.url,
          opts.reader,
        );
      }
      if (typeof doc === 'string') {
        try {
          doc = JSON.parse(doc);
        } catch {
          doc = undefined;
        }
      }
      let card =
        doc && typeof doc === 'object'
          ? (doc as Record<string, unknown>)
          : null;
      cards[name] = card;
      letMeta[name] = { strategy: 'card', found: card != null };
    }
    let names = new Set(Object.keys(cards));
    let read = (name: string, path: string, role?: CardReferenceRole) => {
      // A vector read as a near target comes from the table, and remembers
      // its space, so a near compares it only with vectors of that space.
      let stored = role === 'vector' ? vectorsOf[name]?.get(path) : undefined;
      if (stored) {
        return this.vectors.targetFromStored(stored);
      }
      if (cards[name] == null) {
        // the binding found no card
        return NO_BINDING_VALUE;
      }
      let v: unknown = cards[name];
      // own names only: `constructor` or `toString` is no field of a card
      for (let key of path.split('.')) {
        v =
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          Object.prototype.hasOwnProperty.call(v, key)
            ? (v as Record<string, unknown>)[key]
            : undefined;
      }
      // a link reads as its id
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        'id' in v &&
        !('data' in v)
      ) {
        return (v as { id: unknown }).id ?? null;
      }
      // A VectorField's search-doc value is "vec:[…]": as a near target it
      // reads as the numbers.
      if (role === 'vector' && typeof v === 'string' && v.startsWith('vec:[')) {
        try {
          let nums = JSON.parse(v.slice(4));
          return Array.isArray(nums) && nums.length > 0 ? nums : null;
        } catch {
          return null;
        }
      }
      // Anything else read as a near target that is not a vector (a spilled
      // value that could not be restored, an empty list) is a missing value,
      // which matches nothing, rather than a vector of no dimensions.
      if (
        role === 'vector' &&
        !(
          Array.isArray(v) &&
          v.length > 0 &&
          v.every((n) => typeof n === 'number')
        )
      ) {
        return null;
      }
      // A search doc leaves an empty field out, so a path the found card has
      // no value at reads null, as `$this` reads the card's empty field:
      // `eq` then finds the cards with no value there.
      return v === undefined ? null : v;
    };
    let { filter, sort } = mapCardReferences(
      { filter: query.filter, sort: query.sort },
      names,
      read,
    );
    // An expression sort reads a bound card under the binding's name, as a
    // rerank formula does.
    sort = sort?.map((s) => {
      if (!isExprSort(s)) return s;
      let entry = { ...s };
      this.sortBindings.set(entry, expressionBindings(cards));
      return entry;
    });
    let rerank = query.rerank;
    if (rerank) {
      rerank = {
        ...rerank,
        ...(rerank.compare?.filter
          ? {
              compare: {
                ...rerank.compare,
                filter: mapCardReferences(rerank.compare.filter, names, read),
              },
            }
          : {}),
      };
      this.rerankBindings.set(rerank, expressionBindings(cards));
    }
    return {
      filter,
      sort,
      rerank,
      lets: Object.keys(rest).length ? rest : undefined,
      letMeta,
    };
  }

  protected async resolveLets(
    realmURL: URL,
    lets: Record<string, LetBinding>,
    filter: Filter | undefined,
    sort: Sort | undefined,
    opts: QueryOptions,
  ): Promise<{
    filter: Filter | undefined;
    sort: Sort | undefined;
    letMeta: NonNullable<QueryResultsMeta['lets']>;
    warnings: NonNullable<QueryResultsMeta['warnings']>;
  }> {
    let letMeta: NonNullable<QueryResultsMeta['lets']> = {};
    let warnings: NonNullable<QueryResultsMeta['warnings']> = [];
    let readBy = new Map<string, Set<string>>();
    mapLetReferences({ filter, sort }, (field, name, node) => {
      let fields = readBy.get(name) ?? new Set<string>();
      fields.add(field);
      readBy.set(name, fields);
      return node;
    });
    let resolved = new Map<
      string,
      { join: { card: string; field: string } } | { values: JSONTypes.Value[] }
    >();
    for (let [name, binding] of Object.entries(lets)) {
      if (!readBy.has(name)) {
        continue;
      }
      let join = joinableLet(binding);
      if (join && [...readBy.get(name)!].every((field) => field === 'id')) {
        resolved.set(name, { join });
        letMeta[name] = { strategy: 'join' };
        continue;
      }
      let { values, truncated } = await this.#letValues(
        realmURL,
        binding,
        opts,
      );
      resolved.set(name, { values });
      letMeta[name] = {
        strategy: 'list',
        values: values.length,
      };
      if (truncated) {
        warnings.push({
          code: 'binding-truncated',
          message:
            truncated === 'values'
              ? `let: "${name}" found more than ${MAX_LET_VALUES.toLocaleString('en-US')} values, so the query ran with the first ${MAX_LET_VALUES.toLocaleString('en-US')}; narrow its query`
              : `let: "${name}" matched more than the ${MAX_LET_ROWS.toLocaleString('en-US')} rows a binding reads, so its list holds the values of the first ${MAX_LET_ROWS.toLocaleString('en-US')}; narrow its query`,
        });
      }
    }
    let out = mapLetReferences({ filter, sort }, (field, name, node) => {
      let r = resolved.get(name)!;
      let on = node.on ? { on: node.on } : {};
      return 'join' in r
        ? ({ ...on, linkedFrom: r.join } as Filter)
        : ({ ...on, in: { [field]: r.values } } as Filter);
    });
    return { filter: out.filter, sort: out.sort, letMeta, warnings };
  }

  // Syncs each log the query's bindings name that has no rows yet, so the
  // search's snapshot holds its lines (`ensureLogsIndexed`). A folder's logs
  // are listed when the binding runs, and any of them unsynced is refused
  // there (`log-not-indexed`) unless an index pass has reached it.
  protected async syncBindingLogs(
    realmURL: URL,
    lets: Record<string, LetBinding>,
    opts: QueryOptions,
  ) {
    if (!this.dialect.logs) {
      return;
    }
    let urls: string[] = [];
    for (let binding of Object.values(lets)) {
      if (!isLogBinding(binding)) continue;
      let { log, logs } = binding.from;
      let named =
        typeof log === 'string' ? [log] : Array.isArray(logs) ? logs : [];
      for (let name of named) {
        if (typeof name !== 'string') continue;
        try {
          urls.push(resolveLogURL(name, realmURL.href));
        } catch {
          // Refused when the binding runs, with the rest of its query.
        }
      }
    }
    if (urls.length) {
      await ensureLogsIndexed(
        this.dbAdapter,
        realmURL.href,
        [...new Set(urls)],
        opts.readLogFile,
      );
    }
  }

  // A binding's values: its query's rows over this realm, read at `select`
  // in each row's search doc. A list contributes each value and a link its
  // id; nulls are dropped and the values deduplicated. `truncated` says the
  // list was cut: at MAX_LET_VALUES values, or at the MAX_LET_ROWS rows a
  // binding reads when its query matched more and asked for no smaller page.
  async #letValues(
    realmURL: URL,
    binding: LetBinding,
    opts: QueryOptions,
  ): Promise<{
    values: JSONTypes.Value[];
    truncated?: 'values' | 'rows';
  }> {
    if (isLogBinding(binding)) {
      let select = logBindingSelect(binding);
      if (typeof select !== 'string') {
        throw new InvalidQueryError(
          'let: a binding read from a log names the path it reads in select, such as "what.postUri"',
          'missing-member',
        );
      }
      let { filter, select: _select, ...source } = binding.from;
      let read = await logBindingValues(
        this.dbAdapter,
        realmURL.href,
        { ...(source as LogSource), ...(filter ? { filter } : {}) } as {
          filter?: LogFilter;
        } & LogSource,
        select,
        MAX_LET_VALUES,
        {
          ...(opts.reader ? { reader: opts.reader } : {}),
          ...(opts.queryNow ? { now: opts.queryNow } : {}),
          ...(opts.logAccess ? { access: opts.logAccess } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
        },
      );
      return {
        values: read.values as JSONTypes.Value[],
        ...(read.truncated ? { truncated: 'values' as const } : {}),
      };
    }
    let { results, meta } = await this._search(
      realmURL,
      {
        filter: binding.from.filter,
        sort: binding.from.sort,
        // a binding's own zone, else the query's (carried by opts)
        ...(binding.from.timeZone !== undefined
          ? { timeZone: binding.from.timeZone }
          : {}),
        page: {
          size: Math.min(binding.from.page?.size ?? MAX_LET_ROWS, MAX_LET_ROWS),
          // Exact: a list cut at MAX_LET_ROWS says so by its total.
          total: 'exact',
        },
      },
      // A binding a policy composed with a linked card's own type's grants
      // reads that card under those, not the query's.
      binding.ownGrants
        ? { ...opts, cardUrls: undefined, grantFilter: undefined }
        : { ...opts, cardUrls: undefined },
      ['SELECT i.url AS url, ANY_VALUE(i.search_doc) AS search_doc'],
      'instance',
    );
    let seen = new Set<string>();
    let values: JSONTypes.Value[] = [];
    let cut = false;
    let collect = (value: unknown, path: string[]) => {
      if (value == null || cut) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => collect(v, path));
        return;
      }
      if (path.length > 0) {
        if (typeof value === 'object') {
          collect((value as Record<string, unknown>)[path[0]], path.slice(1));
        }
        return;
      }
      let leaf =
        typeof value === 'object'
          ? (value as Record<string, unknown>).id
          : value;
      if (leaf == null || typeof leaf === 'object') {
        return;
      }
      let key = JSON.stringify(leaf);
      if (!seen.has(key)) {
        if (values.length >= MAX_LET_VALUES) {
          cut = true;
          return;
        }
        seen.add(key);
        values.push(leaf as JSONTypes.Value);
      }
    };
    for (let row of results) {
      let doc = (row as { search_doc?: unknown }).search_doc;
      if (typeof doc === 'string') {
        try {
          doc = JSON.parse(doc);
        } catch {
          continue;
        }
      }
      collect(doc, binding.select!.split('.'));
    }
    let rowsCut =
      binding.from.page?.size === undefined &&
      Number(meta.page?.total ?? 0) > results.length;
    return {
      values,
      ...(cut
        ? { truncated: 'values' as const }
        : rowsCut
          ? { truncated: 'rows' as const }
          : {}),
    };
  }
}
