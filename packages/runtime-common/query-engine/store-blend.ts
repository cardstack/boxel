// The narrow blend read: a paged search sorted by one `blend` computes the
// blend from the value store's narrow rows (`boxel_index_values`), plus the
// vector distances of any `near` signal joined by key, instead of reading
// every match's row out of `boxel_index`; only the page is then hydrated.
// Owns: when the narrow blend read applies, and its statements.
// Must not: change which rows match, their scores or their order.
// Guarantees: docs/search.md ("Blended ranking (`blend`)").
//
// The rule. It applies to a paged search of one realm's promoted index,
// sorted by a single blend, with no facets, `explain`, grants, card list,
// errors or staged rows, when the store can decide every part of it:
// - the filter is a conjunction of type tests (either way round) and, under
//   a `not`, an `eq` or `in` on a text or boolean field (one value, read as
//   text), which is what the general read compiles a negated test to;
// - each signal is a field of the type it names (a number field ranked as a
//   number, any other primitive field as its text in the database's
//   collation), a `near` vector, or a `when` filter of type tests, a
//   positive `in` and the negated tests above;
// - a `collapse` is by such a field.
// Each field is a primitive field reached through `contains` fields only (no
// list, no link), so a card holds at most one value at its path, the value
// `search_keys` holds there.
//
// Why it is exact. The store holds every live card instance, one row per
// value of its `search_keys` (value-store.ts), so the types it reads are the
// cards the search's base conditions admit. A field's text there is the text
// the general read extracts with `->>`: a string's or a boolean's own text,
// and for a number the text of its numeric value, which is what jsonb prints
// (`num::text`). Each signal's value and each test is then the general
// read's own expression over that text: a number field through the same
// numeric parse (`numericField`), a text field in the same collation, a
// test in the same comparison. A card with no value at a path has no row
// there, as `->>` reads NULL, and a negated test holds only for a card with
// a value. A filter or `when` the general read evaluates as TRUE is exactly
// one whose conjuncts the store finds TRUE, so the same cards match and the
// same cards score. The ranks are RANK() over the same values in the same
// order, the score the same sum of the same float terms in the same order,
// and the page the same ORDER BY (score, url in byte order, type). A card
// whose value the store holds only as a marker (the value is in the search
// doc) cannot be read here: when any card of the walked types has a marker
// at or above a path the search reads, the narrow read does not apply.

import {
  type CardExpression,
  any,
  param,
  separatedByCommas,
  sortDirection,
  typesContains,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import {
  type BlendComponent,
  DEFAULT_RRF_K,
  type Filter,
  type Sort,
  isExprSort,
  isWhenSignal,
} from '../query.ts';
import { isNearSort, type NearContext } from '../vector-query.ts';
import {
  type QueryOptions,
  COLLAPSE_SIZE_KEY,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import { blendScoreAlias } from './sort-sql.ts';
import { tableFromOpts } from './index-sql.ts';
import { getField } from './filter-paths.ts';
import { isReferenceFilterField } from '../query-v2/query-values.ts';
import { formatQuery as booleanQuery } from '../serializers/boolean.ts';
import { isRealmUnion } from '../realm-union.ts';
import { UnionTotals } from './union-totals.ts';
import type { StoreKeep } from './store-narrow.ts';
import type { StoreFacetSet } from './store-facets.ts';

// A test the store decides for a card: a type test (the card's own type's
// chain holds one of `keys`), or a test of the text at `path`.
type Leaf =
  | { kind: 'type'; keys: string[]; negated: boolean }
  | {
      kind: 'value';
      path: string;
      op: 'not-eq' | 'not-in' | 'in' | 'eq';
      values: (string | boolean)[];
    };

type Signal =
  | { kind: 'field'; path: string; numeric: boolean }
  | { kind: 'when'; leaves: Leaf[] }
  | { kind: 'near'; component: BlendComponent; alias: string };

export interface StoreBlendPage {
  keys: Record<string, unknown>[];
  total: number;
}

export abstract class StoreBlend extends UnionTotals {
  // The page's keys (url, type, the blend's score and, collapsed, the
  // group's size) and the total, read from the value store, or undefined
  // when the narrow read does not apply and the search reads the general
  // way. Nothing that changes the search's answer runs before it decides
  // to apply: a `near` signal's plan is made only once it does.
  protected async storeBlendPage({
    realmURL,
    filter,
    sort,
    page,
    collapse,
    opts,
    entryType,
    nearCtx,
    everyCondition,
  }: {
    realmURL: URL;
    filter: Filter | undefined;
    sort: Sort | undefined;
    page: { size: number; number?: number };
    collapse: { by: string; on: CodeRef; keep: number } | undefined;
    opts: QueryOptions;
    entryType: 'instance' | 'file' | 'all';
    nearCtx: NearContext;
    everyCondition: CardExpression;
  }): Promise<StoreBlendPage | undefined> {
    let blend = sort?.[0];
    if (
      !this.dialect.valueStore ||
      isRealmUnion(realmURL) ||
      tableFromOpts(opts) !== 'boxel_index' ||
      entryType === 'file' ||
      opts.includeErrors ||
      opts.pendingStagingId !== undefined ||
      opts.grantFilter ||
      opts.cardUrls?.length ||
      !filter ||
      !sort ||
      sort.length !== 1 ||
      !blend ||
      !isBlendSort(blend)
    ) {
      return undefined;
    }
    let realm = realmURL.href;
    let compiled = await this.#storeFilter(filter, undefined, false, false);
    if (!compiled) {
      return undefined;
    }
    let baseTypes = compiled.filter(
      (l): l is Extract<Leaf, { kind: 'type' }> =>
        l.kind === 'type' && !l.negated,
    );
    let leaves = compiled.filter((l) => !(l.kind === 'type' && !l.negated));
    if (baseTypes.length === 0) {
      return undefined;
    }
    // A mixed search reads file rows too; a card type's chain is never a
    // file row's, so a search of a card type reads only its cards.
    let anchor = (filter as { type?: CodeRef; on?: CodeRef }).type;
    let anchorDefinition = await this.#definitionOf(
      anchor ?? (await this.#firstTypeRef(filter)),
    );
    if (anchorDefinition?.type !== 'card-def') {
      return undefined;
    }

    // The signals, in the blend's order.
    let signals: Signal[] = [];
    for (let [j, component] of blend.of.entries()) {
      if (isExprSort(component) || isMatchRelevanceSort(component)) {
        return undefined;
      }
      if (isWhenSignal(component)) {
        let when = await this.#storeFilter(
          component.when,
          undefined,
          false,
          true,
        );
        if (!when) {
          return undefined;
        }
        signals.push({ kind: 'when', leaves: when });
        continue;
      }
      if (isNearSort(component)) {
        signals.push({ kind: 'near', component, alias: `nb0_${j}` });
        continue;
      }
      let on = 'on' in component ? component.on : undefined;
      if (!on) {
        return undefined;
      }
      let kind = await this.#fieldKind(on, String(component.by));
      if (!kind || kind === 'title') {
        return undefined;
      }
      signals.push({
        kind: 'field',
        path: String(component.by),
        numeric: kind === 'number',
      });
    }
    let collapseRead: { path: string; numeric: boolean } | undefined;
    if (collapse) {
      let kind = await this.#fieldKind(collapse.on, collapse.by);
      if (!kind || kind === 'title') {
        return undefined;
      }
      collapseRead = { path: collapse.by, numeric: kind === 'number' };
    }

    // Every path the read touches, and the type tests it makes.
    let allLeaves = [
      ...leaves,
      ...signals.flatMap((s) => (s.kind === 'when' ? s.leaves : [])),
    ];
    let paths = [
      ...new Set([
        ...allLeaves.flatMap((l) => (l.kind === 'value' ? [l.path] : [])),
        ...signals.flatMap((s) => (s.kind === 'field' ? [s.path] : [])),
        ...(collapseRead ? [collapseRead.path] : []),
      ]),
    ];
    let prefixes = [
      ...new Set([
        '',
        ...paths.flatMap((p) => {
          let segments = p.split('.');
          return segments.map((_, i) => segments.slice(0, i + 1).join('.'));
        }),
      ]),
    ];
    let typeTests = allLeaves.filter(
      (l): l is Extract<Leaf, { kind: 'type' }> => l.kind === 'type',
    );
    let baseKeys: string[][] = [];
    for (let leaf of baseTypes) {
      baseKeys.push(leaf.keys);
    }
    let typeSet = (keySets: string[][]): CardExpression => [
      'SELECT t.id FROM boxel_index_value_types AS t WHERE t.realm_url =',
      param(realm),
      ...keySets.flatMap((keys) => [
        'AND',
        ...(any(
          keys.map((key) => [typesContains(key, 't.types')]),
        ) as CardExpression),
      ]),
    ];
    let idList = (select: CardExpression): CardExpression => [
      "(SELECT COALESCE(json_agg(q.id ORDER BY q.id), '[]'::json) FROM (",
      ...select,
      ') AS q)',
    ];
    let pathIds = (list: string[]): CardExpression => [
      'SELECT p.id FROM boxel_index_value_paths AS p WHERE p.path IN (',
      ...separatedByCommas(list.map((p) => [param(p)])),
      ')',
    ];
    // One statement for the ids the read names, and whether a marker
    // keeps it from reading the store.
    let [prep] = (await this.queryCards(
      [
        'SELECT (SELECT r.id FROM boxel_index_value_realms AS r WHERE r.realm_url =',
        param(realm),
        ') AS realm, ',
        ...idList(typeSet(baseKeys)),
        'AS base,',
        ...typeTests.flatMap((leaf, n) => [
          ...idList(typeSet([leaf.keys])),
          `AS t${n},`,
        ]),
        "(SELECT COALESCE(json_object_agg(p.path, p.id), '{}'::json) FROM boxel_index_value_paths AS p WHERE p.path IN (",
        ...separatedByCommas(prefixes.map((p) => [param(p)])),
        ')) AS paths,',
        'EXISTS (SELECT 1 FROM boxel_index_values AS m WHERE m.realm_id = (SELECT r.id FROM boxel_index_value_realms AS r WHERE r.realm_url =',
        param(realm),
        ') AND m.type_id IN (',
        ...typeSet(baseKeys),
        ") AND m.kind = 'm' AND m.path_id IN (",
        ...pathIds(prefixes),
        ')) AS blocked',
      ],
      opts.timings,
      opts,
    )) as Record<string, unknown>[];
    let realmId = prep?.realm == null ? undefined : Number(prep.realm);
    let base = ((prep?.base as number[]) ?? []).map(Number);
    if (realmId === undefined || base.length === 0 || prep.blocked) {
      return undefined;
    }
    let pathId = new Map(
      Object.entries((prep.paths as Record<string, number>) ?? {}).map(
        ([p, id]) => [p, Number(id)],
      ),
    );
    let idOf = (p: string) => pathId.get(p) ?? -1;
    let typeIds = new Map<Leaf, number[]>(
      typeTests.map((leaf, n) => [
        leaf,
        ((prep[`t${n}`] as number[]) ?? []).map(Number),
      ]),
    );
    // The general read compiles the same filter and refuses what it
    // refuses (a field that is not searchable, a malformed value); the
    // narrow read must not answer a search the general one refuses.
    try {
      await this.makeExpression(
        ['SELECT 1 FROM boxel_index AS i WHERE', ...everyCondition],
        opts,
      );
    } catch {
      return undefined;
    }

    // From here the narrow read applies.
    let ints = (ids: number[]) =>
      ids.length ? ids.map(Number).join(', ') : 'NULL';
    let types = ints(base);
    let readPaths = paths.map(idOf).filter((id) => id >= 0);
    let rootId = idOf('');
    if (rootId < 0) {
      return undefined;
    }
    // Each test as a boolean over a store row `x`, aggregated per card.
    let leafTest = (leaf: Leaf): CardExpression => {
      if (leaf.kind === 'type') {
        let ids = typeIds.get(leaf) ?? [];
        // no type of the realm passes the test: it holds for no card (or,
        // negated, for every card)
        if (ids.length === 0) {
          return [leaf.negated ? 'TRUE' : 'FALSE'];
        }
        return [
          `bool_or(x.type_id ${leaf.negated ? 'NOT IN' : 'IN'} (${ints(ids)}))`,
        ];
      }
      let values = separatedByCommas(leaf.values.map((v) => [param(v)]));
      let test: CardExpression =
        leaf.op === 'not-eq'
          ? ['x.t <>', ...values]
          : leaf.op === 'not-in'
            ? ['x.t NOT IN (', ...values, ')']
            : ['x.t IN (', ...values, ')'];
      return [`bool_or(x.path_id = ${idOf(leaf.path)} AND`, ...test, ')'];
    };
    let valueAt = (path: string) =>
      `MAX(CASE WHEN x.path_id = ${idOf(path)} THEN x.t END)`;

    let perColumns: CardExpression = [];
    leaves.forEach((leaf, n) => {
      perColumns.push(',', ...leafTest(leaf), `AS l${n}`);
    });
    signals.forEach((signal, j) => {
      if (signal.kind === 'field') {
        perColumns.push(`, ${valueAt(signal.path)} AS v${j}`);
      } else if (signal.kind === 'when') {
        signal.leaves.forEach((leaf, n) => {
          perColumns.push(',', ...leafTest(leaf), `AS w${j}_${n}`);
        });
      }
    });
    if (collapseRead) {
      perColumns.push(`, ${valueAt(collapseRead.path)} AS cv`);
    }
    let admitted =
      leaves.length === 0
        ? 'TRUE'
        : leaves.map((_, n) => `per.l${n}`).join(' AND ');

    // The cards' rows at the paths read: one index-only scan of the text
    // index and one of the number index, with literal ids, so the plan
    // reads the store the same way whatever the planner estimates.
    let scan = (column: 'txt' | 'num', ids: number[]): string =>
      `SELECT v.card_id, v.type_id, v.path_id, ${
        column === 'txt' ? 'v.txt COLLATE "default"' : 'v.num::text'
      } AS t FROM boxel_index_values AS v WHERE v.realm_id = ${realmId} AND v.type_id IN (${types}) AND v.path_id IN (${ints(
        ids,
      )}) AND v.${column} IS NOT NULL`;

    // The near signals' plans and joins, over each admitted card's key.
    let nearJoins: CardExpression = [];
    let nearColumns: CardExpression = [];
    for (let [j, signal] of signals.entries()) {
      if (signal.kind !== 'near') {
        continue;
      }
      let similarity = await this.vectors.nearSignalScore(
        signal.component as Parameters<typeof this.vectors.nearSignalScore>[0],
        signal.alias,
        nearJoins,
        realmURL,
        nearCtx,
      );
      nearColumns.push(',', ...similarity, `AS n${j}`);
    }
    let hasNear = nearColumns.length > 0;
    // A card's url, by its key in the cards' dictionary.
    let urlOf = (alias: string) =>
      `(SELECT (c.url COLLATE "default")::varchar FROM boxel_index_value_cards AS c WHERE c.id = ${alias}.card_id)`;
    // A near signal joins its vectors by the card's key (url, realm,
    // type), and a collapse breaks ties within a group by url, so those
    // read every admitted card's url; otherwise only the cards that can
    // reach the page do (below).
    let urlEverywhere = hasNear || Boolean(collapseRead);
    let keyed: CardExpression = [
      `SELECT a.*${urlEverywhere ? `, ${urlOf('a')} AS url` : ''},`,
      param(realm),
      "::varchar AS realm_url, 'instance'::varchar AS type FROM adm AS a",
    ];
    let kRelation: CardExpression = hasNear
      ? [
          'SELECT i.card_id, ANY_VALUE(i.url) AS url',
          ...signals.flatMap((s, j) =>
            s.kind === 'field'
              ? [`, ANY_VALUE(i.v${j}) AS v${j}`]
              : s.kind === 'when'
                ? s.leaves.map(
                    (_, n) => `, ANY_VALUE(i.w${j}_${n}) AS w${j}_${n}`,
                  )
                : [],
          ),
          ...(collapseRead ? [', ANY_VALUE(i.cv) AS cv'] : []),
          ...nearColumns,
          'FROM (',
          ...keyed,
          ') AS i',
          ...nearJoins,
          'GROUP BY i.card_id',
        ]
      : keyed;

    // The blend: the general read's terms over the same values.
    let k = blend.k ?? DEFAULT_RRF_K;
    let terms: CardExpression[] = [];
    for (let [j, signal] of signals.entries()) {
      let component = blend.of[j];
      let weight = component.weight ?? 1;
      let inverted = weight < 0;
      let value: CardExpression;
      if (signal.kind === 'field') {
        value = signal.numeric
          ? (this.dialect.numericField([`k.v${j}`]) as CardExpression)
          : [`k.v${j}`];
      } else if (signal.kind === 'when') {
        let holds = signal.leaves.map((_, n) => `k.w${j}_${n}`).join(' AND ');
        value = inverted
          ? [`(CASE WHEN ${holds} THEN NULL ELSE 1 END)`]
          : [`(CASE WHEN ${holds} THEN 1 END)`];
      } else {
        value = [`k.n${j}`];
      }
      let declared = isWhenSignal(component)
        ? 'desc'
        : ((component as { direction?: string }).direction ?? 'desc');
      let direction =
        inverted && !isWhenSignal(component)
          ? declared === 'desc'
            ? 'asc'
            : 'desc'
          : declared;
      terms.push([
        'CASE WHEN',
        ...value,
        'IS NULL THEN 0 ELSE',
        ...this.dialect.castFloat([param(Math.abs(weight))]),
        '/ (',
        param(k),
        '+ RANK() OVER (ORDER BY',
        ...value,
        sortDirection(direction),
        'NULLS LAST)) END',
      ]);
    }
    let sum: CardExpression = [];
    terms.forEach((t, i) => sum.push(...(i > 0 ? ['+'] : []), ...t));
    let score = `"${blendScoreAlias(sort, 0)}"`;
    let order: CardExpression = [
      score,
      sortDirection(blend.direction ?? 'desc'),
      'NULLS LAST, url COLLATE "POSIX", type',
    ];
    let collapseKey = collapseRead
      ? collapseRead.numeric
        ? ([
            'CAST(',
            ...this.dialect.numericField(['k.cv']),
            'AS TEXT)',
          ] as CardExpression)
        : ['CAST(k.cv AS TEXT)']
      : [];
    let size = Number(page.size);
    let offset = (page.number ?? 0) * size;

    let statement: CardExpression = [
      `WITH x AS MATERIALIZED (${scan('txt', [rootId, ...readPaths])} UNION ALL ${scan('num', readPaths)}),`,
      'per AS MATERIALIZED (SELECT x.card_id, bool_or(x.path_id = ',
      String(rootId),
      ') AS root',
      ...perColumns,
      'FROM x GROUP BY x.card_id),',
      `adm AS MATERIALIZED (SELECT per.* FROM per WHERE per.root AND ${admitted}),`,
      'k AS MATERIALIZED (',
      ...kRelation,
      '),',
      `s AS MATERIALIZED (SELECT k.card_id${urlEverywhere ? ', k.url' : ''}, 'instance'::varchar AS type, (`,
      ...sum,
      `) AS ${score}`,
      ...(collapseRead ? [', ', ...collapseKey, 'AS ck'] : []),
      'FROM k),',
      ...(collapseRead
        ? [
            'c AS MATERIALIZED (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(s.ck, s.url) ORDER BY',
            ...order,
            ') AS rk,',
            `COUNT(*) OVER (PARTITION BY COALESCE(s.ck, s.url)) AS "${COLLAPSE_SIZE_KEY}" FROM s),`,
            `kept AS MATERIALIZED (SELECT c.url, c.type, c.${score}, c."${COLLAPSE_SIZE_KEY}" FROM c WHERE c.rk <= ${Number(collapse!.keep)}),`,
            'cand AS (SELECT * FROM kept)',
          ]
        : urlEverywhere
          ? [
              `kept AS MATERIALIZED (SELECT s.url, s.type, s.${score} FROM s),`,
              'cand AS (SELECT * FROM kept)',
            ]
          : [
              // The page's rows all score at least the score at its last
              // position (`edge`, in the blend's direction), and every row
              // scoring past it comes after the page: only the rows from the
              // edge on need their url, to break ties by it.
              `kept AS MATERIALIZED (SELECT s.card_id, s.type, s.${score} FROM s),`,
              `edge AS (SELECT kept.${score} AS e FROM kept ORDER BY kept.${score}`,
              sortDirection(blend.direction ?? 'desc'),
              `LIMIT 1 OFFSET ${Math.max(offset + size - 1, 0)}),`,
              `cand AS (SELECT ${urlOf('kept')} AS url, kept.type, kept.${score} FROM kept WHERE ${
                size === 0
                  ? 'FALSE'
                  : `NOT EXISTS (SELECT 1 FROM edge) OR kept.${score} ${
                      (blend.direction ?? 'desc') === 'desc' ? '>=' : '<='
                    } (SELECT e FROM edge)`
              })`,
            ]),
      'SELECT p.*, h.n AS __total FROM (SELECT COUNT(*) AS n FROM kept) AS h LEFT JOIN LATERAL (SELECT * FROM cand',
      'ORDER BY',
      ...order,
      `LIMIT ${size} OFFSET ${offset}) AS p ON TRUE`,
    ];
    let rows = (await this.queryCards(statement, opts.timings, opts)) as Record<
      string,
      unknown
    >[];
    let total = Number(rows[0]?.__total ?? 0);
    let keys = rows
      .filter((row) => row.url != null)
      .map(({ __total: _total, ...row }) => row);
    return { keys, total };
  }

  // A facet match set the value store decides (store-facets.ts): the
  // filter's cards, of a card type, when every test it makes is one the
  // store decides and no card of its types holds a marker at or above a
  // path the tests or the facets (`facetPaths`, as the store keeps them)
  // read; undefined when the set reads the general way.
  protected async storeFacetSet({
    realmURL,
    filter,
    opts,
    entryType,
    condition,
    facetPaths,
  }: {
    realmURL: URL;
    filter: Filter | undefined;
    opts: QueryOptions;
    entryType: 'instance' | 'file' | 'all';
    condition: CardExpression;
    facetPaths: string[];
  }): Promise<StoreFacetSet | undefined> {
    if (
      !this.dialect.valueStore ||
      isRealmUnion(realmURL) ||
      tableFromOpts(opts) !== 'boxel_index' ||
      entryType === 'file' ||
      opts.includeErrors ||
      opts.pendingStagingId !== undefined ||
      opts.grantFilter ||
      opts.cardUrls?.length ||
      !filter
    ) {
      return undefined;
    }
    let realm = realmURL.href;
    let compiled = await this.#storeFilter(
      filter,
      undefined,
      false,
      false,
      true,
    );
    if (!compiled) {
      return undefined;
    }
    let baseKeys = compiled.flatMap((l) =>
      l.kind === 'type' && !l.negated ? [l.keys] : [],
    );
    let notKeys = compiled.flatMap((l) =>
      l.kind === 'type' && l.negated ? [l.keys] : [],
    );
    let values = compiled.filter(
      (l): l is Extract<Leaf, { kind: 'value' }> => l.kind === 'value',
    );
    if (baseKeys.length === 0) {
      return undefined;
    }
    // A card type's chain is never a file row's, so a search of a card
    // type reads only its cards, all of which the store holds.
    let anchor = (filter as { type?: CodeRef; on?: CodeRef }).type;
    let anchorDefinition = await this.#definitionOf(
      anchor ?? (await this.#firstTypeRef(filter)),
    );
    if (anchorDefinition?.type !== 'card-def') {
      return undefined;
    }
    let prefixes = [
      ...new Set([
        '',
        ...[...values.map((l) => l.path), ...facetPaths].flatMap((p) => {
          let segments = p.split('.');
          return segments.map((_, i) => segments.slice(0, i + 1).join('.'));
        }),
      ]),
    ];
    let typeSet = (keySets: string[][], every: boolean): CardExpression => [
      'SELECT t.id, t.type FROM boxel_index_value_types AS t WHERE t.realm_url =',
      param(realm),
      'AND (',
      ...keySets.flatMap((keys, n) => [
        ...(n > 0 ? [every ? 'AND' : 'OR'] : []),
        '(',
        ...(any(
          keys.map((key) => [typesContains(key, 't.types')]),
        ) as CardExpression),
        ')',
      ]),
      ')',
    ];
    let excluded: CardExpression = notKeys.length
      ? [
          'AND q.id NOT IN (SELECT n.id FROM (',
          ...typeSet(notKeys, false),
          ') AS n)',
        ]
      : [];
    let [prep] = (await this.queryCards(
      [
        'SELECT (SELECT r.id FROM boxel_index_value_realms AS r WHERE r.realm_url =',
        param(realm),
        ') AS realm,',
        "(SELECT COALESCE(json_object_agg(q.id, q.type), '{}'::json) FROM (",
        ...typeSet(baseKeys, true),
        ') AS q WHERE TRUE',
        ...excluded,
        ') AS types,',
        "(SELECT COALESCE(json_object_agg(p.path, p.id), '{}'::json) FROM boxel_index_value_paths AS p WHERE p.path IN (",
        ...separatedByCommas(prefixes.map((p) => [param(p)])),
        ')) AS paths,',
        'EXISTS (SELECT 1 FROM boxel_index_values AS m WHERE m.realm_id = (SELECT r.id FROM boxel_index_value_realms AS r WHERE r.realm_url =',
        param(realm),
        ') AND m.type_id IN (SELECT q.id FROM (',
        ...typeSet(baseKeys, true),
        ") AS q) AND m.kind = 'm' AND m.path_id IN (SELECT p.id FROM boxel_index_value_paths AS p WHERE p.path IN (",
        ...separatedByCommas(prefixes.map((p) => [param(p)])),
        '))) AS blocked',
      ],
      opts.timings,
      opts,
    )) as Record<string, unknown>[];
    if (prep?.realm == null || prep.blocked) {
      return undefined;
    }
    let pathId = new Map(
      Object.entries((prep.paths as Record<string, number>) ?? {}).map(
        ([p, id]) => [p, Number(id)],
      ),
    );
    let rootId = pathId.get('');
    if (rootId === undefined) {
      return undefined;
    }
    // The general read refuses what it refuses (a field that is not
    // searchable, a malformed value); the store must not answer a set the
    // general read refuses.
    try {
      await this.makeExpression(
        ['SELECT 1 FROM boxel_index AS i WHERE', ...condition],
        opts,
      );
    } catch {
      return undefined;
    }
    let typeKeys = new Map(
      Object.entries((prep.types as Record<string, string>) ?? {}).map(
        ([id, key]) => [Number(id), String(key)],
      ),
    );
    return {
      realmId: Number(prep.realm),
      typeIds: [...typeKeys.keys()].sort((a, b) => a - b),
      typeKeys,
      rootId,
      // A path the dictionary does not hold holds no card's value.
      tests: values.map((l) => ({
        pathId: pathId.get(l.path) ?? -1,
        op: l.op,
        values: l.values,
      })),
    };
  }

  // The filter with each `matches` term that is one of its conjuncts
  // marked with the other conjuncts the store decides (`storeKeep`,
  // store-narrow.ts), so the term's candidates are narrowed by the store
  // before their rows are read; the filter as it is when nothing narrows.
  protected async storeNarrowFilter({
    filter,
    realmURL,
    opts,
    entryType,
  }: {
    filter: Filter | undefined;
    realmURL: URL;
    opts: QueryOptions;
    entryType: 'instance' | 'file' | 'all';
  }): Promise<Filter | undefined> {
    if (
      !filter ||
      !this.dialect.valueStore ||
      isRealmUnion(realmURL) ||
      tableFromOpts(opts) !== 'boxel_index' ||
      entryType === 'file' ||
      opts.includeErrors ||
      opts.pendingStagingId !== undefined
    ) {
      return filter;
    }
    let f = filter as unknown as Record<string, unknown>;
    let ref = (f.on ?? f.type) as CodeRef | undefined;
    let operators = Object.keys(f).filter((k) => k !== 'on' && k !== 'type');
    if (operators.length !== 1 || operators[0] !== 'every') {
      return filter;
    }
    let children = f.every as unknown[];
    if (!Array.isArray(children)) {
      return filter;
    }
    let isTerm = (child: unknown) =>
      Boolean(child) &&
      typeof child === 'object' &&
      typeof (child as { matches?: unknown }).matches === 'string';
    if (!children.some(isTerm)) {
      return filter;
    }
    let leaves: Leaf[] = ref
      ? [{ kind: 'type', keys: await this.typeKeysFor(ref), negated: false }]
      : [];
    let firstType: CodeRef | undefined = ref;
    for (let child of children) {
      if (isTerm(child)) {
        continue;
      }
      let decided = await this.#storeFilter(child, ref, false, false);
      if (decided) {
        leaves.push(...decided);
        let c = child as { type?: CodeRef; on?: CodeRef };
        if (!firstType && Object.keys(child as object).length === 1) {
          firstType = c.type ?? c.on;
        }
      }
    }
    let types = leaves.filter(
      (l): l is Extract<Leaf, { kind: 'type' }> =>
        l.kind === 'type' && !l.negated,
    );
    // Only a search of a card type reads only card instances, all of which
    // the store holds.
    if (
      types.length === 0 ||
      (await this.#definitionOf(firstType))?.type !== 'card-def'
    ) {
      return filter;
    }
    let keep: StoreKeep = {
      realm: realmURL.href,
      types: types.map((l) => l.keys),
      notTypes: leaves.flatMap((l) =>
        l.kind === 'type' && l.negated ? [l.keys] : [],
      ),
      values: leaves.flatMap((l) =>
        l.kind === 'value' && (l.op === 'not-eq' || l.op === 'not-in')
          ? [{ path: l.path, op: l.op, values: l.values }]
          : [],
      ),
    };
    return {
      ...f,
      every: children.map((child) =>
        isTerm(child) ? { ...(child as object), storeKeep: keep } : child,
      ),
    } as unknown as Filter;
  }

  // The filter as tests the store decides, all of which must hold, or
  // undefined when it holds anything else. `negated` is under a `not`;
  // `perRow` is a `when` signal's filter, whose positive `in` the general
  // read compiles to the same text comparison; with `positive`, a positive
  // `eq` or `in` is decided too (a facet's match set, store-facets.ts).
  async #storeFilter(
    node: unknown,
    on: CodeRef | undefined,
    negated: boolean,
    perRow: boolean,
    positive = false,
  ): Promise<Leaf[] | undefined> {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return undefined;
    }
    let f = node as Record<string, unknown>;
    let keys = Object.keys(f);
    let ref = (f.on ?? f.type) as CodeRef | undefined;
    let typeLeaf = async (r: CodeRef, neg: boolean): Promise<Leaf> => ({
      kind: 'type',
      keys: await this.typeKeysFor(r),
      negated: neg,
    });
    if (keys.length === 1 && ref) {
      return [await typeLeaf(ref, negated)];
    }
    let operators = keys.filter((k) => k !== 'on' && k !== 'type');
    if (operators.length !== 1) {
      return undefined;
    }
    let scope = ref ?? on;
    let anchored: Leaf[] = [];
    if (ref) {
      if (negated) {
        return undefined;
      }
      anchored.push(await typeLeaf(ref, false));
    }
    let [op] = operators;
    if (op === 'every') {
      if (negated || !Array.isArray(f.every)) {
        return undefined;
      }
      let out = [...anchored];
      for (let child of f.every) {
        let leaves = await this.#storeFilter(
          child,
          scope,
          false,
          perRow,
          positive,
        );
        if (!leaves) {
          return undefined;
        }
        out.push(...leaves);
      }
      return out;
    }
    if (op === 'not') {
      if (negated) {
        return undefined;
      }
      let inner = await this.#storeFilter(f.not, scope, true, perRow);
      return inner ? [...anchored, ...inner] : undefined;
    }
    if (op === 'eq' || op === 'in') {
      let fields = f[op] as Record<string, unknown> | undefined;
      if (!fields || typeof fields !== 'object' || !scope) {
        return undefined;
      }
      let entries = Object.entries(fields);
      if (entries.length !== 1) {
        return undefined;
      }
      let [path, raw] = entries[0];
      let positiveTest = !negated && (positive || (op === 'in' && perRow));
      if (!negated && !positiveTest) {
        return undefined;
      }
      let values = op === 'eq' ? [raw] : raw;
      if (!Array.isArray(values) || values.length === 0) {
        return undefined;
      }
      if (isReferenceFilterField(path)) {
        return undefined;
      }
      let kind = await this.#fieldKind(scope, path);
      let tested: (string | boolean)[] = [];
      for (let v of values) {
        if (
          kind === 'boolean' &&
          (typeof v === 'boolean' || typeof v === 'string')
        ) {
          tested.push(booleanQuery(v));
        } else if (kind === 'text' && typeof v === 'string') {
          tested.push(v);
        } else {
          return undefined;
        }
      }
      return [
        ...anchored,
        {
          kind: 'value',
          path,
          op: negated
            ? op === 'eq'
              ? 'not-eq'
              : 'not-in'
            : op === 'eq'
              ? 'eq'
              : 'in',
          values: tested,
        },
      ];
    }
    return undefined;
  }

  // How the general read reads a field of `on` at `path`, when the store
  // holds it as that read sees it: a primitive field reached through
  // `contains` fields only. `number` (a number or big integer, compared as a
  // number), `boolean`, `text` (a string, no serializer), `date` (a date or
  // date-time: a sort reads its text, a filter rewrites its value, so only
  // a signal reads one here) or `title` (`cardTitle`, which sorts by its own
  // column).
  // Whether `path` is a text field the store reads (a primitive reached
  // through `contains` fields only), so a positive `in` on it holds exactly
  // for the cards whose text there is one of its values.
  protected async isStoredTextField(on: CodeRef, path: string) {
    return (await this.#fieldKind(on, path)) === 'text';
  }

  async #fieldKind(
    on: CodeRef,
    path: string,
  ): Promise<'number' | 'boolean' | 'text' | 'date' | 'title' | undefined> {
    if (!path || /[[\]]/.test(path)) {
      return undefined;
    }
    if (path === 'cardTitle') {
      return 'title';
    }
    try {
      let definition = await this.getDefinition(on);
      let names = path.split('.');
      for (let i = 0; i < names.length; i++) {
        let field = await getField(
          definition,
          names.slice(0, i + 1).join('.'),
          this.definitionLookup,
        );
        if (field.type !== 'contains') {
          return undefined;
        }
        if (i === names.length - 1) {
          if (!field.isPrimitive) {
            return undefined;
          }
          let name = field.serializerName;
          if (name === 'number' || name === 'big-integer') {
            return 'number';
          }
          if (name === 'boolean') {
            return 'boolean';
          }
          if (name === 'date' || name === 'datetime') {
            return 'date';
          }
          // Other serializers rewrite a query's value: not read here.
          return name === undefined ? 'text' : undefined;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  async #definitionOf(ref: CodeRef | undefined) {
    if (!ref) {
      return undefined;
    }
    return await this.getDefinition(ref).catch(() => undefined);
  }

  async #firstTypeRef(filter: Filter): Promise<CodeRef | undefined> {
    let f = filter as unknown as Record<string, unknown>;
    let own = (f.on ?? f.type) as CodeRef | undefined;
    if (own) {
      return own;
    }
    for (let child of (f.every as Filter[] | undefined) ?? []) {
      let c = child as unknown as Record<string, unknown>;
      if (Object.keys(c).length === 1 && (c.type || c.on)) {
        return (c.type ?? c.on) as CodeRef;
      }
    }
    return undefined;
  }
}
