// Facets: planning each requested facet (declared or built-in, its shape,
// the types that hold it) and counting it over the page's match set:
// values, link labels, statistics, ranges and date intervals. A declared
// field's values are read from the value store (value-store.ts), and from the
// search doc for a card the store does not cover there.
// Owns: the facet statements and the declaration checks
// (`needs-declaration`, `needs-type`).
// Must not: change the page's rows or total (a facet ignoring its own
// selection drops predicates only from its own count).
// Guarantees: docs/search.md ("Facets").

import { refuse } from '../query-v2/query-refusals.ts';
import {
  BASE_INDEX_FIELDS,
  type DeclaredFacet,
  INDEX_FIELD_COLUMNS,
  declaredFacetFields,
  declaredFacetShape,
  declaresIndexFacet,
  isIndexField,
  missingFacetDeclaration,
} from '../facet-declarations.ts';
import {
  type CardExpression,
  addExplicitParens,
  any,
  isDbExpression,
  typesContains,
  param,
  separatedByCommas,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import {
  type CodeRef,
  baseCardRef,
  baseFileRef,
  baseRef,
  codeRefFromInternalKey,
  isResolvedCodeRef,
} from '../index.ts';
import {
  DATE_SERIALIZERS,
  type FacetPlan,
  type FacetShape,
  autoFacetRanges,
  facetCountsOf,
  facetMeasureOf,
  facetRangeBound,
  filterWithout,
} from './facet-sql.ts';
import {
  type FacetRow,
  type SqliteFacetWork,
  countFacet,
  readFacetValues,
  sqliteFacetIntervalUtc,
  sqliteFacetLimits,
  sqliteFacetNotCounted,
  sqliteFacetSampled,
} from './sqlite-facets.ts';
import stringify from 'safe-stable-stringify';
import {
  DEFAULT_FACET_SIZE,
  FACET_INTERVALS,
  type Facet,
  type FacetCount,
  type FacetInterval,
  type FacetRange,
  type FacetStats,
  type Filter,
  type Query,
  InvalidQueryError,
  assertRelativeDateWellFormed,
  facetRangeLabel,
} from '../query-v2/query.ts';
import type { Definition } from '../definitions.ts';
import type { QueryOptions } from './types.ts';
import { SortWindow } from './sort-window.ts';
import { arrayElement } from '../sql-literal.ts';
import { escapeLikePattern, filterAnchor } from './filter-sql.ts';
import { getField, removeBrackets } from './filter-paths.ts';
import {
  isUtcZone,
  pgBucketLabel,
  pgLocalTimestamp,
  zoneOfClock,
} from '../query-v2/time-zone.ts';
import {
  prerenderedJoin,
  prerenderedTableFromOpts,
  tableFromOpts,
} from './index-sql.ts';
import { realmIs } from '../realm-union.ts';
import {
  type StoreFacetSet,
  storeFacetKeysCte,
  storeFacetValueArms,
} from './store-facets.ts';

export abstract class Facets extends SortWindow {
  // The linked ids among `ids` that the caller may read: those `linkTarget`'s
  // own grants admit. Null when no grant on that type admits the caller.
  protected async admittedLinkIds(
    ids: string[],
    opts: QueryOptions,
    realmURL: URL,
    linkTarget: CodeRef,
  ): Promise<Set<string> | null> {
    let own = await opts.grantsForType!(linkTarget);
    if (own === null) return null;
    if (ids.length === 0) return new Set();
    let rows = await this.queryCards(
      [
        'SELECT i.file_alias AS card_id',
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
        `WHERE i.type = 'instance' AND`,
        ...realmIs('i.realm_url', realmURL),
        'AND (i.is_deleted = FALSE OR i.is_deleted IS NULL) AND i.file_alias IN',
        ...addExplicitParens(separatedByCommas(ids.map((id) => [param(id)]))),
        'AND (',
        ...this.filterCondition({ any: own }, baseCardRef, 'positive', {
          inAny: false,
          prerenderedTable: prerenderedTableFromOpts(opts),
          now: opts.queryNow,
          indexTable: tableFromOpts(opts),
        }),
        ')',
        'GROUP BY i.file_alias',
      ],
      opts.timings,
      opts,
    );
    return new Set(rows.map((r) => String(r.card_id)));
  }

  // How each requested facet is counted (docs/search.md, Facets). A facet's
  // `by`, and a `measure`'s field, must be a facet the queried type declares
  // (`search: { facet: true }`, facet-declarations.ts) or a built-in one;
  // anything else is refused with `needs-declaration` and the declaration to
  // add. Its shape is the query's (`stats`, `ranges`, `interval`) or else the
  // declared field's type's. Facets are counted from the value store, which
  // only the Postgres index keeps.
  protected async facetPlans(
    facets: Facet[],
    filter: Filter | undefined,
    realmURL?: URL,
    opts: QueryOptions = {},
    entryType: 'instance' | 'file' | 'all' = 'instance',
  ): Promise<FacetPlan[]> {
    if (facets.length === 0) {
      return [];
    }
    let anchor = filterAnchor(filter);
    let definition: Definition | undefined;
    if (anchor) {
      try {
        definition = await this.getDefinition(anchor);
      } catch {
        definition = undefined;
      }
    }
    // A query anchored on the base card type (or on no type) counts what
    // the matched cards' own types declare.
    let typed =
      Boolean(definition) &&
      !(anchor && 'name' in anchor && anchor.name === 'CardDef');
    let lookup = async (ref: CodeRef): Promise<Definition | undefined> => {
      if (!isResolvedCodeRef(ref)) {
        return undefined;
      }
      try {
        return await this.definitionLookup.lookupDefinition(ref);
      } catch {
        return undefined;
      }
    };
    let declared =
      typed && definition
        ? await declaredFacetFields(definition, lookup)
        : undefined;
    // The holder types a facet through subclasses counts, by path.
    let holdersOf = new Map<string, string[]>();
    // The declared facet `path` names, or 'empty' when no card the query
    // could match holds it (nothing to count).
    let resolve = async (
      path: string,
      member: string,
      // Set by a facet whose query names its shape: holders that declare the
      // field as different kinds of value are then counted as plain values.
      shaped = false,
    ): Promise<DeclaredFacet | 'empty' | 'rows' | 'uncounted'> => {
      let own = declared?.get(path);
      if (own) {
        return own;
      }
      if (typed && definition) {
        let missing = await missingFacetDeclaration(
          definition,
          path,
          lookup,
          member,
        );
        if (missing) {
          throw new InvalidQueryError(missing, 'needs-declaration');
        }
      }
      // Not a field of the queried type: a subclass's, or, with no type, any
      // card's. Its cards' own types must declare it; only those types'
      // cards are counted. Only the value store says which hold it (or that
      // none does, for a name no card holds), so SQLite answers it without
      // counts (sqlite-facets.ts).
      if (!this.dialect.valueStore) {
        return 'uncounted';
      }
      let { stored: holders, doc } = realmURL
        ? await this.#facetHolderTypes(realmURL, anchor, path, opts)
        : { stored: [], doc: undefined };
      if (doc === null) {
        throw refuse('cards-no-recorded-type', undefined, {
          member,
          path,
          path2: path,
        });
      }
      if (doc) {
        let ref = codeRefFromInternalKey(doc);
        let def = ref ? await lookup(ref) : undefined;
        let missing = def
          ? await missingFacetDeclaration(def, path, lookup, member)
          : undefined;
        throw missing != null
          ? new InvalidQueryError(missing, 'needs-declaration')
          : refuse('facet-holders-undeclared', undefined, {
              member,
              path,
              holder: ref?.name ?? doc,
              definer: ref?.name ?? 'the type',
            });
      }
      // Every holder's declaration, so the facet's shape never depends on
      // which type's cards the database happens to list first.
      let declarations: { key: string; type: string; facet: DeclaredFacet }[] =
        [];
      let unresolved: string[] = [];
      let undeclared: { key: string; def: Definition } | undefined;
      let untyped = false;
      for (let key of holders) {
        if (key === '') {
          untyped = true;
          continue;
        }
        let ref = codeRefFromInternalKey(key);
        let def = ref ? await lookup(ref) : undefined;
        if (!def) {
          unresolved.push(key);
          continue;
        }
        let found = (await declaredFacetFields(def, lookup)).get(path);
        if (found) {
          declarations.push({ key, type: ref?.name ?? key, facet: found });
        } else {
          undeclared ??= { key, def };
        }
      }
      let kindOf = (f: DeclaredFacet) =>
        f.link ? 'a link' : (f.field.serializerName ?? 'text');
      let kinds = new Set(declarations.map((d) => kindOf(d.facet)));
      if (kinds.size > 1) {
        if (shaped) {
          // The query says how to count it; each stored value counts as
          // the text it is (the number 10 and the text "10" alike).
          holdersOf.set(
            path,
            declarations.map((d) => d.key),
          );
          return 'rows';
        }
        throw refuse('types-whose-cards-hold', undefined, {
          member,
          path,
          value2: declarations
            .map((d) => `${d.type}: ${kindOf(d.facet)}`)
            .join(', '),
        });
      }
      if (declarations.length > 0) {
        holdersOf.set(
          path,
          declarations.map((d) => d.key),
        );
        return declarations[0].facet;
      }
      if (unresolved.length > 0) {
        // Cards hold it, but no holder's type resolves now (a module that
        // no longer loads): their values, and those of cards with no recorded
        // type, count as plain values, whose shape no declaration can say.
        holdersOf.set(path, untyped ? [...unresolved, ''] : unresolved);
        return 'rows';
      }
      if (undeclared) {
        let missing = await missingFacetDeclaration(
          undeclared.def,
          path,
          lookup,
          member,
        );
        let ref = codeRefFromInternalKey(undeclared.key);
        throw missing != null
          ? new InvalidQueryError(missing, 'needs-declaration')
          : refuse('facet-holders-undeclared', undefined, {
              member,
              path,
              holder: ref?.name ?? undeclared.key,
              definer: ref?.name ?? 'the type',
            });
      }
      if (untyped) {
        throw refuse('cards-no-recorded-type', undefined, {
          member,
          path,
          path2: path,
        });
      }
      if (typed && definition) {
        // As in a filter, a name no card of the type can hold is refused.
        try {
          await getField(definition, path, this.definitionLookup);
        } catch (e) {
          if (e instanceof InvalidQueryError && e.code === 'unknown-field') {
            throw refuse('refusal', undefined, {
              member,
              path,
              value2: e.message.replace(/^Your filter refers to/, 'refers to'),
            });
          }
          throw e;
        }
      }
      return 'empty';
    };
    let plans: FacetPlan[] = [];
    for (let facet of facets) {
      let measured = facetMeasureOf(facet);
      let measure: Pick<
        FacetPlan,
        'measurePath' | 'measureScalar' | 'measureRead'
      > = {};
      if (measured) {
        if (isIndexField(measured.path)) {
          throw refuse('facet-measure-measure-aggregates', undefined, {
            op: measured.op,
            path: measured.path,
          });
        }
        let m = await resolve(measured.path, `facet measure ${measured.op}`);
        measure = {
          measurePath: measured.path,
          measureRead: typeof m === 'object' ? m.read : measured.path,
          // A list holds no one number to aggregate.
          measureScalar:
            typeof m === 'object' &&
            !m.link &&
            !m.list &&
            m.field.type === 'contains',
        };
      }
      let queryShape: FacetShape | undefined = facet.ranges
        ? 'range'
        : facet.interval
          ? 'date'
          : facet.stats
            ? 'values'
            : undefined;
      if (isIndexField(facet.by)) {
        await this.#assertIndexFacetDeclared(
          facet.by,
          typed ? definition : undefined,
          lookup,
          entryType,
        );
        let indexField = INDEX_FIELD_COLUMNS[facet.by];
        plans.push({
          facet,
          shape: queryShape ?? (indexField.date ? 'date' : 'values'),
          column: indexField.column,
          ...(indexField.label ? { labelColumn: indexField.label } : {}),
          ...(indexField.date ? { dateField: true, builtInDate: true } : {}),
          ...measure,
        });
        continue;
      }
      let found = await resolve(facet.by, 'facet by', queryShape !== undefined);
      let holderTypes = holdersOf.get(facet.by);
      if (found === 'rows') {
        plans.push({
          facet,
          shape: queryShape ?? 'values',
          read: facet.by,
          list: true,
          ...(holderTypes ? { holderTypes } : {}),
          ...measure,
        });
        continue;
      }
      if (found === 'empty' || found === 'uncounted') {
        plans.push({
          facet,
          shape: queryShape ?? 'values',
          ...(found === 'empty' ? { empty: true } : { uncounted: true }),
          ...measure,
        });
        continue;
      }
      let serializer = found.field.serializerName ?? '';
      plans.push({
        facet,
        shape: found.link
          ? 'values'
          : (queryShape ?? declaredFacetShape(found)),
        read: found.read,
        list: found.list,
        ...(holderTypes ? { holderTypes } : {}),
        ...(found.link ? { link: true } : {}),
        ...(found.link ? { linkTarget: found.linkTarget } : {}),
        ...(serializer === 'big-integer' ? { bigInteger: true } : {}),
        ...(DATE_SERIALIZERS.has(serializer) ? { dateField: true } : {}),
        ...(serializer === 'date' ? { dateOnly: true } : {}),
        ...measure,
      });
    }
    // SQLite counts no `measure` (sqlite-facets.ts).
    if (!this.dialect.valueStore) {
      for (let plan of plans) {
        if (plan.measurePath) plan.uncounted = true;
      }
    }
    return plans;
  }

  // An index field (`_type`, `_realm`, …) is a facet where the queried type
  // declares it in its `static indexFields`, as base does for every card and
  // file (BaseDef, CardDef). A query with no type (or over the base card
  // type) reads base's declarations for the rows it searches: CardDef's for
  // cards, FileDef's for files, BaseDef's (which both share) for a mixed
  // search.
  // A definition cached before `indexFields` was recorded reads its family's
  // base type's.
  async #assertIndexFacetDeclared(
    name: string,
    definition: Definition | undefined,
    lookup: (ref: CodeRef) => Promise<Definition | undefined>,
    entryType: 'instance' | 'file' | 'all',
  ): Promise<void> {
    let family =
      definition?.type ??
      (entryType === 'instance'
        ? 'card-def'
        : entryType === 'file'
          ? 'file-def'
          : undefined);
    let baseName: 'BaseDef' | 'CardDef' | 'FileDef' =
      family === 'file-def'
        ? 'FileDef'
        : family === 'card-def'
          ? 'CardDef'
          : 'BaseDef';
    let declaring =
      definition?.indexFields !== undefined
        ? definition
        : await lookup(
            baseName === 'FileDef'
              ? baseFileRef
              : baseName === 'CardDef'
                ? baseCardRef
                : baseRef,
          );
    if (declaring?.indexFields === undefined) {
      // Base's definition did not resolve (or predates `indexFields`):
      // read base's declarations as runtime-common mirrors them.
      declaring = { indexFields: BASE_INDEX_FIELDS[baseName] } as Definition;
    }
    if (declaresIndexFacet(declaring, name)) {
      return;
    }
    let typeName =
      (definition?.codeRef && 'name' in definition.codeRef
        ? definition.codeRef.name
        : undefined) ?? 'the queried type';
    throw refuse('facet-does-declare-index', undefined, {
      name,
      typeName,
      name2: name,
      name3: name,
      value4:
        name === '_cardType'
          ? '; a file has no `_cardType`: facet a mixed search by `_type`'
          : '',
    });
  }

  // The types of the live cards (of `type`, when the query names one) in the
  // realm that hold a value at `path` (or, for a link, at `path.id`), in type
  // order, from the value store: '' for cards with no recorded type. When the
  // store holds none, one type whose cards hold it in their search docs (for
  // the refusal to name; `null` when those rows record no type).
  async #facetHolderTypes(
    realmURL: URL,
    type: CodeRef | undefined,
    path: string,
    opts: QueryOptions,
  ): Promise<{ stored: string[]; doc: string | null | undefined }> {
    let rows = await this.queryCards(
      [
        'SELECT t.type AS type_key FROM boxel_index_value_types AS t WHERE',
        ...realmIs('t.realm_url', realmURL),
        ...(type
          ? [
              'AND',
              ...(any(
                (await this.typeKeysFor(type)).map((key) => [
                  typesContains(key, 't.types'),
                ]),
              ) as CardExpression),
            ]
          : []),
        'AND EXISTS (SELECT 1 FROM boxel_index_values AS v WHERE v.realm_id = (SELECT r.id FROM boxel_index_value_realms AS r WHERE r.realm_url = t.realm_url) AND v.type_id = t.id AND v.path_id IN (SELECT p.id FROM boxel_index_value_paths AS p WHERE p.path IN (',
        param(path),
        ',',
        param(`${path}.id`),
        ")) AND v.kind IN ('s', 'n', 'b'))",
        'ORDER BY type_key',
        'LIMIT 20',
      ],
      opts.timings,
      opts,
    );
    if (rows.length > 0) {
      return {
        stored: rows.map((row) => String(row.type_key)),
        doc: undefined,
      };
    }
    let typeCondition: CardExpression = type
      ? ['AND', ...this.typeCondition(type)]
      : [];
    let [held] = await this.queryCards(
      [
        `SELECT i.types ->> 0 AS type_key FROM ${tableFromOpts(opts)} AS i WHERE`,
        ...realmIs('i.realm_url', realmURL),
        `AND i.type = 'instance' AND (i.is_deleted = FALSE OR i.is_deleted IS NULL)`,
        ...typeCondition,
        'AND i.search_doc #>',
        param(
          `{${removeBrackets(path).split('.').map(arrayElement).join(',')}}`,
        ),
        '::text[] IS NOT NULL',
        'ORDER BY type_key',
        'LIMIT 1',
      ],
      opts.timings,
      opts,
    );
    return {
      stored: [],
      // `null`: cards hold it whose rows record no type.
      doc: !held
        ? undefined
        : typeof held.type_key === 'string'
          ? held.type_key
          : null,
    };
  }

  // The facets' counting, decided before any statement runs: each facet's
  // work over its match set, and the columns of the first statement.
  protected facetQuery(
    plans: FacetPlan[],
    opts: QueryOptions,
    conditionOf: (plan: FacetPlan) => CardExpression,
    storeSetOf?: (plan: FacetPlan) => StoreFacetSet | undefined,
  ): FacetQuery {
    let bases = new Map<CardExpression, string>();
    let works = plans.map((plan, f) => {
      let condition = conditionOf(plan);
      let base = bases.get(condition);
      if (!base) {
        base = `facet_keys_${bases.size}`;
        bases.set(condition, base);
      }
      return {
        ...this.#facetWork(plan, f, base, condition, opts),
        storeSet: storeSetOf?.(plan),
      };
    });
    let parts: CardExpression[] = [];
    let part = (expression: CardExpression) => {
      parts.push(expression);
      return `p${parts.length - 1}`;
    };
    let names = works.map((work) => ({
      stats: work.wantStats ? part(this.#statsPart(work)) : undefined,
      missing: work.plan.facet.missing
        ? part(['(SELECT COUNT(*) FROM', work.base, ')'])
        : undefined,
      counts: work.autoRanges ? undefined : part(this.#countsPart(work, opts)),
    }));
    return { works, parts, names };
  }

  // The first statement's CTEs and columns (`<prefix>0`, `<prefix>1`, …),
  // for a statement of its own or for one that also reads the page: a match
  // set whose condition is `shared.condition` is then read from that
  // statement's CTE `shared.from` (its key, `__realm_url` and `__type_key`)
  // instead of the condition again.
  protected facetSql(
    query: FacetQuery,
    opts: QueryOptions,
    prefix: string,
    shared?: FacetSource,
  ): { ctes: CardExpression[]; columns: CardExpression } {
    return this.#facetSql(query.works, query.parts, opts, prefix, shared);
  }

  // Counts every requested facet over its match set, in one statement: each
  // distinct condition (the search's, or a facet's that ignores its own
  // selection) is read once into a materialized set of card keys; every
  // facet's values over that set are read in one pass (`#facetRowCtes`) and
  // its value counts in one grouped pass, and each facet's counts,
  // statistics and missing count read those. A number facet that asks for
  // ranges but names none takes its ranges from its statistics, so its
  // counts are a second statement over the same keys. Link values are
  // labeled afterwards, from the linked cards. With `first`, the first
  // statement already ran inside the page's (`facetSql`), and its row is
  // given.
  protected async countFacets(
    plans: FacetPlan[],
    opts: QueryOptions,
    conditionOf: (plan: FacetPlan) => CardExpression,
    realmURL: URL,
    first?: { query: FacetQuery; row: Record<string, unknown> },
    storeSetOf?: (plan: FacetPlan) => StoreFacetSet | undefined,
  ): Promise<Map<FacetPlan, { counts: FacetCount[]; stats?: FacetStats }>> {
    let out = new Map<
      FacetPlan,
      { counts: FacetCount[]; stats?: FacetStats }
    >();
    if (plans.length === 0) {
      return out;
    }
    let { works, parts, names } =
      first?.query ?? this.facetQuery(plans, opts, conditionOf, storeSetOf);
    let row: Record<string, unknown> | undefined;
    if (first) {
      row = Object.fromEntries(
        parts.map((_, index) => [
          `p${index}`,
          first.row[`${SHARED_FACET_PREFIX}${index}`],
        ]),
      );
    } else {
      [row] = await this.#facetStatement(works, parts, opts);
    }
    // A facet whose ranges come from its statistics.
    let later = new Map<FacetWork, string>();
    let laterParts: CardExpression[] = [];
    let laterWorks: FacetWork[] = [];
    works.forEach((work, index) => {
      if (!work.autoRanges) {
        return;
      }
      work.ranges = autoFacetRanges(
        this.#statsOf(row?.[names[index].stats!], work.plan),
      );
      if (work.ranges.length === 0) {
        work.ranges = undefined;
      }
      laterWorks.push(work);
      laterParts.push(this.#countsPart(work, opts));
      later.set(work, `p${laterParts.length - 1}`);
    });
    let [laterRow] =
      laterParts.length > 0
        ? await this.#facetStatement(laterWorks, laterParts, opts)
        : [];
    for (let [index, work] of works.entries()) {
      let { plan } = work;
      let { facet } = plan;
      let counted = later.has(work)
        ? laterRow?.[later.get(work)!]
        : row?.[names[index].counts!];
      let counts = work.ranges
        ? work.ranges.map((range, r) => ({
            value: facetRangeLabel(range),
            count: Number(
              (counted as Record<string, unknown> | null)?.[`r${r}`] ?? 0,
            ),
          }))
        : this.#valueCountsOf(
            work,
            (counted as Record<string, unknown>[]) ?? [],
          );
      if (plan.link && !work.interval && plan.shape !== 'range') {
        counts = await this.#labelLinkCounts(
          counts,
          opts,
          realmURL,
          plan.linkTarget,
        );
      }
      if (!work.wantStats) {
        out.set(plan, { counts });
        continue;
      }
      let stats = this.#statsOf(row?.[names[index].stats!], plan);
      let reported: FacetStats = {
        count: stats.count,
        distinct: stats.distinct,
      };
      if (facet.stats || plan.shape !== 'values') {
        Object.assign(reported, stats);
      }
      if (facet.missing) {
        reported.missing = Math.max(
          0,
          Number(row?.[names[index].missing!] ?? 0) - stats.count,
        );
      }
      if (plan.shape !== 'range') {
        reported.order = work.order;
      }
      out.set(plan, { counts, stats: reported });
    }
    return out;
  }

  // What counting `plan` (the `f`th facet) reads, decided (and its query
  // checked) before any statement runs.
  #facetWork(
    plan: FacetPlan,
    f: number,
    base: string,
    condition: CardExpression,
    _opts: QueryOptions,
  ): FacetWork {
    let { facet, shape } = plan;
    let interval: FacetInterval | undefined =
      shape === 'date' ? (facet.interval ?? 'month') : undefined;
    let order: 'count' | 'value' | 'measure' =
      facet.order ?? (interval ? 'value' : 'count');
    let wantStats =
      Boolean(facet.stats) ||
      shape !== 'values' ||
      Boolean(facet.missing) ||
      order === 'value' ||
      order === 'measure';
    // The interval is written into the SQL, so it's checked here too: a
    // query-backed field's query reaches the engine without assertQuery.
    if (
      interval &&
      !(FACET_INTERVALS as readonly string[]).includes(interval)
    ) {
      throw refuse('facet-interval-must-one', undefined, {
        value0: FACET_INTERVALS.join(', '),
      });
    }
    if (shape === 'range' && facet.ranges && plan.dateField) {
      // A relative date is one only on a date field; elsewhere it is text.
      for (let range of facet.ranges) {
        assertRelativeDateWellFormed(range.from, facet.by);
        assertRelativeDateWellFormed(range.to, facet.by);
      }
    }
    return {
      plan,
      f,
      base,
      condition,
      size: facet.size ?? DEFAULT_FACET_SIZE,
      interval,
      order,
      wantStats,
      counted: false,
      ranges:
        shape === 'range' && facet.ranges?.length ? facet.ranges : undefined,
      autoRanges: shape === 'range' && !facet.ranges,
    };
  }

  // One statement: the match sets of `works`, each materialized once with
  // its facets' values and value counts (`#facetRowCtes`), and `parts` read
  // over them as the columns `p0`, `p1`, … of one row.
  async #facetStatement(
    works: FacetWork[],
    parts: CardExpression[],
    opts: QueryOptions,
  ): Promise<Record<string, unknown>[]> {
    let { ctes, columns } = this.#facetSql(works, parts, opts, 'p');
    return await this.queryCards(
      ['WITH', ...separatedByCommas(ctes), 'SELECT', ...columns],
      opts.timings,
      opts,
    );
  }

  #facetSql(
    works: FacetWork[],
    parts: CardExpression[],
    opts: QueryOptions,
    prefix: string,
    shared?: FacetSource,
  ): { ctes: CardExpression[]; columns: CardExpression } {
    let stored = this.#readsValueStore(opts);
    let ctes: CardExpression[] = [];
    let held = works.filter((w) => !w.plan.empty && !w.plan.column);
    if (stored && held.length > 0) {
      ctes.push(facetPathsCte(held));
    }
    let bases = new Map<string, FacetWork[]>();
    for (let work of works) {
      bases.set(work.base, [...(bases.get(work.base) ?? []), work]);
    }
    // The statement's one table-valued placeholder belongs to its first
    // match set read by condition (a shared statement's own).
    let first = !shared;
    for (let [name, own] of bases) {
      // A set the value store decides reads the store's rows alone
      // (store-facets.ts), when its facets read only declared fields.
      let storeSet = own.every((w) => w.storeSet && storeCounts(w.plan))
        ? own[0].storeSet
        : undefined;
      if (storeSet && stored) {
        ctes.push(
          storeFacetKeysCte(name, storeSet),
          ...this.#facetRowCtes(name, own, stored, opts, storeSet),
        );
        continue;
      }
      let from =
        shared && own[0].condition === shared.condition
          ? shared.from
          : undefined;
      ctes.push(
        this.#matchSetCte(
          name,
          own[0].condition,
          first && !from,
          stored,
          opts,
          from,
        ),
        ...this.#facetRowCtes(name, own, stored, opts),
      );
      if (!from) {
        first = false;
      }
    }
    let columns: CardExpression = [];
    parts.forEach((p, index) => {
      columns.push(...(index > 0 ? [','] : []), ...p, `AS ${prefix}${index}`);
    });
    return { ctes, columns };
  }

  // The match set of `condition`, one row per match: its key, its own type,
  // a number (`kn`) the facet rows count it by, and, where the value store
  // holds the card (a live card of the promoted index), its realm, type and
  // card ids there; a card the store does not hold has no `card_id`.
  #matchSetCte(
    name: string,
    condition: CardExpression,
    first: boolean,
    stored: boolean,
    opts: QueryOptions,
    from?: string,
  ): CardExpression {
    // Index rows are unique by key; only a condition that reads a list as a
    // table (a lateral join) can repeat one.
    let distinct = fansOut(condition) ? 'DISTINCT ' : '';
    let matches: CardExpression = from
      ? [
          `(SELECT s.__realm_url AS realm_url, s.url, s.type, s.__type_key AS type_key FROM ${from} AS s) AS m`,
        ]
      : [
          `(SELECT ${distinct}i.realm_url, i.url, i.type, i.types ->> 0 AS type_key FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
          // A statement takes one placeholder; a filter's conditions keep
          // their list reads in their own subqueries, so none needs it.
          ...(first ? [tableValuedFunctionsPlaceholder] : []),
          'WHERE',
          ...condition,
          ') AS m',
        ];
    if (!stored) {
      return [
        `${name} AS MATERIALIZED (SELECT m.*, ROW_NUMBER() OVER () AS kn, NULL::integer AS realm_id, NULL::integer AS type_id, NULL::integer AS card_id FROM`,
        ...matches,
        ')',
      ];
    }
    return [
      `${name} AS MATERIALIZED (SELECT m.realm_url, m.url, m.type, m.type_key, ROW_NUMBER() OVER () AS kn, vr.id AS realm_id, vt.id AS type_id, vc.id AS card_id FROM`,
      ...matches,
      `LEFT JOIN boxel_index_value_realms AS vr ON vr.realm_url = m.realm_url LEFT JOIN boxel_index_value_types AS vt ON vt.realm_url = m.realm_url AND vt.type = COALESCE(m.type_key, '') LEFT JOIN boxel_index_value_cards AS vc ON m.type = 'instance' AND vc.realm_url = m.realm_url AND vc.url = m.url AND EXISTS (SELECT 1 FROM boxel_index_values AS vk WHERE vk.realm_id = vr.id AND vk.type_id = vt.id AND vk.path_id = (SELECT id FROM boxel_index_value_paths WHERE path = '') AND vk.txt = '' AND vk.card_id = vc.id AND vk.kind = 'c'))`,
    ];
  }

  // Whether the value store answers for this search's cards: on Postgres,
  // over the promoted index (a search of a pending pass's staged rows reads
  // their search docs).
  #readsValueStore(opts: QueryOptions): boolean {
    return (
      Boolean(this.dialect.valueStore) && tableFromOpts(opts) === 'boxel_index'
    );
  }

  // The facet rows over match set `name`, for its facets `own`:
  //
  // `<name>_fv`, one row per facet (`f`), match (`kn`) and distinct value:
  // `value` as text (a link's linked card id) and `num` when it is a number.
  // A declared field's values are the card's rows in the value store at the
  // field's path (a link's at `path.id`; each element of a list), read for
  // every facet in one pass; for a card the store does not hold, or holds
  // only a marker for at or above that path (`<name>_km`, read once for the
  // set), they are the values its search doc holds there, each such card's
  // doc read once for all its facets. A built-in facet's value is the index
  // row's own column, with its label.
  //
  // `<name>_fc`, the value counts of the facets that list them, in one
  // grouped pass: per facet and value, its matches, label, and the measure's
  // aggregate (`<name>_ms`, each match's measured number).
  #facetRowCtes(
    name: string,
    own: FacetWork[],
    stored: boolean,
    opts: QueryOptions,
    storeSet?: StoreFacetSet,
  ): CardExpression[] {
    let table = tableFromOpts(opts);
    let held = own.filter((w) => !w.plan.empty && !w.plan.column);
    let columned = own.filter((w) => w.plan.column);
    let ctes: CardExpression[] = [];
    let arms: CardExpression[] = [];
    let storeHeld = stored && held.length > 0;
    let fs = held.map((w) => w.f).join(', ');
    let paths = `ARRAY(SELECT fp.path_id FROM facet_paths AS fp WHERE fp.f IN (${fs}) AND fp.path_id IS NOT NULL)`;
    // A value row of a card the store holds counts unless the card holds
    // only a marker at or above the facet's path, and only for the facet's
    // holder types.
    let counts = (k: string) =>
      `(${k}.path_ids IS NULL OR NOT ${k}.path_ids && fp.prefix_ids) AND (fp.holders IS NULL OR COALESCE(${k}.type_key, '') = ANY (fp.holders))`;
    // The set's cards are read through `<name>_km`, each with the paths at
    // or above its facets' paths where the store holds only a marker for it
    // (the marker index read on its whole key, one path at a time). Every
    // read of the store below is keyed by
    // card, and nothing joins the set to another set by a hash or a scan:
    // the set's size is unknown when the statement is planned, and a nested
    // loop over a set it took for a few rows ran quadratic.
    let keys = storeHeld ? `${name}_km` : name;
    if (storeSet) {
      if (held.length > 0) {
        let holders = new Map<number, string[]>();
        for (let w of held) {
          if (w.plan.holderTypes) {
            holders.set(w.f, w.plan.holderTypes);
          }
        }
        arms.push(
          ...storeFacetValueArms(
            name,
            storeSet,
            held.map((w) => w.f),
            holders,
          ),
        );
      }
    } else if (storeHeld) {
      ctes.push([
        `${name}_km AS MATERIALIZED (SELECT k.*, mk.path_ids FROM ${name} AS k LEFT JOIN LATERAL (SELECT array_agg(vm.path_id) AS path_ids FROM (`,
        ...unionAll(
          [
            ...new Set(held.flatMap((w) => pathPrefixes(storedPathOf(w.plan)))),
          ].map((prefix) => [
            'SELECT vm.path_id FROM boxel_index_values AS vm WHERE vm.realm_id = k.realm_id AND vm.type_id = k.type_id AND vm.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =',
            param(prefix),
            ") AND vm.card_id = k.card_id AND vm.kind = 'm'",
            // Probed only where the set's types hold some marker there
            // (read once): most paths of most types hold none.
            `AND EXISTS (SELECT 1 FROM boxel_index_values AS g WHERE g.realm_id = ANY (ARRAY(SELECT DISTINCT realm_id FROM ${name} WHERE card_id IS NOT NULL)) AND g.type_id = ANY (ARRAY(SELECT DISTINCT type_id FROM ${name} WHERE card_id IS NOT NULL)) AND g.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =`,
            param(prefix),
            ") AND g.kind = 'm')",
          ]),
        ),
        ') AS vm) AS mk ON TRUE)',
      ]);
      // Each card's rows at its facets' paths, one keyed read per card
      // (`boxel_index_values_card_idx`, by card and path), so a set larger
      // than the planner took it for costs that many probes, never a scan
      // of its types' rows per card.
      // The rows are grouped in byte order ("C", as the store keeps text,
      // and equal exactly where the database's collation is); a facet orders
      // and compares values in the database's collation, as the search doc's
      // text is.
      arms.push([
        `SELECT fp.f, k.kn, v.value, v.num, NULL::text AS label FROM ${keys} AS k CROSS JOIN LATERAL (SELECT v.path_id, COALESCE(v.txt, v.num::text) COLLATE "C" AS value, v.num FROM boxel_index_values AS v WHERE v.card_id = k.card_id AND v.path_id = ANY (${paths}) AND v.realm_id = k.realm_id AND v.type_id = k.type_id AND v.kind IN ('s', 'n', 'b')) AS v JOIN facet_paths AS fp ON fp.path_id = v.path_id AND fp.f IN (${fs}) WHERE`,
        counts('k'),
      ]);
    }
    if (held.length > 0 && !storeSet) {
      let docArms: CardExpression[] = held.map((w) =>
        this.#docValuesArm(w, storeHeld),
      );
      arms.push([
        // The cards whose search docs are read: those the store does not hold
        // or holds a marker for at or above some facet's path, each read once.
        `SELECT d.f, k.kn, d.txt COLLATE "C" AS value, d.num, NULL::text AS label FROM (SELECT k.kn, k.card_id, k.type_key, ${storeHeld ? 'k.path_ids' : 'NULL::integer[] AS path_ids'}, di.search_doc FROM ${keys} AS k`,
        `JOIN ${table} AS di ON di.realm_url = k.realm_url AND di.url = k.url AND di.type = k.type`,
        ...(storeHeld
          ? ['WHERE k.card_id IS NULL OR k.path_ids IS NOT NULL']
          : []),
        ') AS k CROSS JOIN LATERAL (',
        ...unionAll(docArms),
        ') AS d',
      ]);
    }
    if (columned.length > 0) {
      let rows = columned.map((w) => {
        let { column, builtInDate, labelColumn } = w.plan;
        // A built-in date (an epoch in seconds or milliseconds) reads as its
        // UTC instant in ISO form, as a date field's value does.
        let value = builtInDate
          ? `to_char(to_timestamp((CASE WHEN abs(${column}) >= 100000000000 THEN ${column} / 1000.0 ELSE ${column} END)::float8) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
          : `(${column})::text`;
        return `(${w.f}, ${value}, ${labelColumn ? `(${labelColumn})::text` : 'NULL::text'})`;
      });
      arms.push([
        `SELECT c.f, k.kn, c.value COLLATE "C", NULL::numeric AS num, c.label FROM ${name} AS k JOIN ${table} AS i ON i.realm_url = k.realm_url AND i.url = k.url AND i.type = k.type CROSS JOIN LATERAL (VALUES ${rows.join(', ')}) AS c(f, value, label) WHERE c.value IS NOT NULL`,
      ]);
    }
    if (arms.length === 0) {
      arms.push([
        'SELECT NULL::integer AS f, NULL::bigint AS kn, NULL::text COLLATE "C" AS value, NULL::numeric AS num, NULL::text AS label WHERE FALSE',
      ]);
    }
    // A big integer is decimal text, so it counts as a number where it
    // spells a whole number.
    let big = own.filter((w) => w.plan.bigInteger).map((w) => w.f);
    let num = big.length
      ? `CASE WHEN u.f IN (${big.join(', ')}) THEN COALESCE(MAX(u.num), CASE WHEN (u.value COLLATE "default") ~ '^\\s*-?[0-9]+\\s*$' THEN trim(u.value)::numeric END) ELSE MAX(u.num) END`
      : 'MAX(u.num)';
    ctes.push([
      `${name}_fv AS MATERIALIZED (SELECT u.f, u.kn, u.value COLLATE "default" AS value, ${num} AS num, MAX(u.label) AS label FROM (`,
      ...unionAll(arms),
      ') AS u GROUP BY u.f, u.kn, u.value)',
    ]);
    let counted = own.filter((w) => w.counted);
    if (counted.length === 0) {
      return ctes;
    }
    let measuredOf = (w: FacetWork) =>
      w.plan.measurePath && w.plan.measureScalar ? w : undefined;
    let measured = counted.filter(measuredOf);
    if (measured.length > 0) {
      ctes.push([
        `${name}_ms AS MATERIALIZED (SELECT ms.f, k.kn, ms.measure FROM ${name} AS k CROSS JOIN LATERAL (`,
        ...unionAll(
          measured.map((w) => [
            `SELECT ${w.f} AS f,`,
            ...this.#measureOf(w.plan, opts),
            'AS measure',
          ]),
        ),
        ') AS ms)',
      ]);
    }
    let ops = [
      ...new Set(
        counted.map((w) => facetMeasureOf(w.plan.facet)?.op).filter(Boolean),
      ),
    ] as string[];
    let aggregates = ops
      .map(
        (op) =>
          `, ${measured.length > 0 ? `${op.toUpperCase()}(fv.measure)` : 'NULL::numeric'} AS measure_${op}`,
      )
      .join('');
    let fcs = counted.map((w) => w.f).join(', ');
    // Each row meets its match's measure by a window over the facet's and
    // match's rows, not a join, for the reason `<name>_km` gives.
    let rows =
      measured.length > 0
        ? `(SELECT u.f, u.value, u.label, MAX(u.measure) OVER (PARTITION BY u.f, u.kn) AS measure, u.counted FROM (SELECT fv.f, fv.kn, fv.value, fv.label, NULL::numeric AS measure, TRUE AS counted FROM ${name}_fv AS fv WHERE fv.f IN (${fcs}) UNION ALL SELECT ms.f, ms.kn, NULL, NULL, ms.measure, FALSE FROM ${name}_ms AS ms) AS u) AS fv WHERE fv.counted`
        : `${name}_fv AS fv WHERE fv.f IN (${fcs})`;
    ctes.push([
      `${name}_fc AS MATERIALIZED (SELECT fv.f, fv.value, COUNT(*) AS count, MAX(fv.label) AS label${aggregates} FROM ${rows} GROUP BY fv.f, fv.value)`,
    ]);
    return ctes;
  }

  // The search doc's values for facet `work` of match `k` (a lateral arm
  // over the set's cards whose docs are read), as the facet read always
  // counted them: each element of a list, a link's id, a value of at most
  // 1,024 characters. Only a card the store does not hold, or holds only a
  // marker for at or above the facet's path, reads its doc.
  #docValuesArm(work: FacetWork, storeHeld: boolean): CardExpression {
    let { plan } = work;
    let read = plan.read ?? plan.facet.by;
    let segs = pathArray(read);
    let lax = `('lax $' || ${laxPath(read)} || '[*]')::jsonpath`;
    let docValue = plan.list
      ? `COALESCE(k.search_doc #> ${segs}, jsonb_path_query_array(k.search_doc, ${lax}))`
      : `k.search_doc #> ${segs}`;
    return [
      `SELECT ${work.f} AS f, d.txt, d.num FROM (SELECT DISTINCT ON (e.txt) e.txt, e.num FROM (SELECT ${plan.link ? "x.value ->> 'id'" : "x.value #>> '{}'"} AS txt, ${plan.link ? 'NULL::numeric' : "CASE WHEN jsonb_typeof(x.value) = 'number' THEN (x.value #>> '{}')::numeric END"} AS num FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${docValue}) = 'array' THEN ${docValue} ELSE jsonb_build_array(${docValue}) END) AS x(value) WHERE jsonb_typeof(x.value) <> 'null') AS e WHERE e.txt IS NOT NULL AND length(e.txt) <= ${MAX_FACET_VALUE_LENGTH} ORDER BY e.txt, e.num NULLS LAST) AS d`,
      'WHERE',
      storeHeld
        ? `(k.card_id IS NULL OR k.path_ids && (SELECT fp.prefix_ids FROM facet_paths AS fp WHERE fp.f = ${work.f}))`
        : 'TRUE',
      ...holdersOf(plan),
    ];
  }

  // The number a scalar `measure` reads for match `k`: the store's, or the
  // search doc's where the store does not hold the card or holds only a
  // marker for at or above its path.
  #measureOf(plan: FacetPlan, opts: QueryOptions): CardExpression {
    let path = plan.measureRead ?? plan.measurePath!;
    return [
      '(SELECT CASE WHEN k.card_id IS NOT NULL AND NOT',
      ...markedAt(path),
      'THEN (SELECT mv.num FROM boxel_index_values AS mv WHERE mv.realm_id = k.realm_id AND mv.type_id = k.type_id AND mv.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =',
      param(path),
      `) AND mv.card_id = k.card_id AND mv.kind = 'n' LIMIT 1) ELSE (SELECT CASE WHEN jsonb_typeof(mi.search_doc #> ${pathArray(path)}) = 'number' THEN (mi.search_doc #>> ${pathArray(path)})::numeric END FROM ${tableFromOpts(opts)} AS mi WHERE mi.realm_url = k.realm_url AND mi.url = k.url AND mi.type = k.type) END)`,
    ];
  }

  // Facet `work`'s rows (`kn`, `value`, `num`) of its match set.
  #facetValuesTable(work: FacetWork): CardExpression {
    return [
      `(SELECT fv.kn, fv.value, fv.num FROM ${work.base}_fv AS fv WHERE fv.f = ${work.f}) AS fv`,
    ];
  }

  // The facet's counts as one column: a JSON array of rows by value or date
  // bucket, in the facet's order, or one JSON row of range counts.
  #countsPart(work: FacetWork, opts: QueryOptions): CardExpression {
    if (work.ranges) {
      return this.#rangesPart(work, work.ranges, opts);
    }
    if (work.interval) {
      return this.#intervalPart(work, opts);
    }
    let { facet } = work.plan;
    let measured = facetMeasureOf(facet);
    let labeled = Boolean(work.plan.labelColumn);
    let order = work.order;
    let by = (alias: string) =>
      order === 'value'
        ? `${alias}facet_value`
        : order === 'measure' && measured
          ? `${alias}facet_measure DESC NULLS LAST, ${alias}count DESC, ${alias}facet_value`
          : `${alias}count DESC, ${alias}facet_value`;
    // Read from the set's value counts (`<base>_fc`), grouped once for
    // every facet that lists them.
    work.counted = true;
    return [
      `(SELECT jsonb_agg(x ORDER BY ${by('x.')}) FROM (`,
      'SELECT c.value AS facet_value, c.count',
      measured ? `, c.measure_${measured.op} AS facet_measure` : '',
      labeled ? ', c.label AS facet_label' : '',
      `FROM ${work.base}_fc AS c WHERE c.f = ${work.f}`,
      ...(facet.prefix
        ? [
            'AND LOWER(c.value) LIKE LOWER(',
            param(`${escapeLikePattern(facet.prefix)}%`),
            `) ESCAPE '\\'`,
          ]
        : []),
      `ORDER BY ${by('')}`,
      `LIMIT ${Number(work.size)}`,
      ') AS x)',
    ];
  }

  #valueCountsOf(
    work: FacetWork,
    rows: Record<string, unknown>[],
  ): FacetCount[] {
    let measured = facetMeasureOf(work.plan.facet);
    let kept = rows.filter((row) => row.facet_value != null);
    let counts = facetCountsOf(kept);
    if (measured && !work.interval) {
      counts = counts.map((c, i) =>
        kept[i].facet_measure == null
          ? c
          : { ...c, measure: { [measured.op]: Number(kept[i].facet_measure) } },
      );
    }
    if (work.plan.labelColumn && !work.interval) {
      counts = counts.map((c, i) =>
        kept[i].facet_label == null
          ? c
          : { ...c, label: String(kept[i].facet_label) },
      );
    }
    return counts;
  }

  // Labels each link facet value (a linked card's id) with that card's
  // indexed title, in one lookup for the values returned. Only a card the
  // search could itself return lends its title: one in the realm searched,
  // not deleted, and, for a caller a policy scopes, one its grants admit. Any
  // other value keeps no label, so a facet never shows the title of a card
  // in another realm, a deleted card, or one the caller cannot read; the id
  // still renders the card by delegating to its prerendered HTML, which
  // applies the caller's own access.
  async #labelLinkCounts(
    counts: FacetCount[],
    opts: QueryOptions,
    realmURL: URL,
    linkTarget?: CodeRef,
  ): Promise<FacetCount[]> {
    if (counts.length === 0) {
      return counts;
    }
    let ids = counts.map((c) => c.value);
    // A linked card lends its title under its own type's grants, as a direct
    // read of it would face them, not the query's: the query's grants are for
    // the type it searches. Where no grant on that type admits the caller, no
    // value gets a label.
    let labelFilter = opts.labelFilter;
    if (opts.grantsForType && linkTarget) {
      let own = await opts.grantsForType(linkTarget);
      if (own === null) {
        return counts;
      }
      labelFilter = { any: own };
    }
    let granted: CardExpression = labelFilter
      ? [
          'AND (',
          ...this.filterCondition(labelFilter, baseCardRef, 'positive', {
            inAny: false,
            prerenderedTable: prerenderedTableFromOpts(opts),
            now: opts.queryNow,
            indexTable: tableFromOpts(opts),
          }),
          ')',
        ]
      : [];
    let rows = await this.queryCards(
      [
        // `title_sort` is the card's title as its generated column holds it.
        // SQLite generates no `title_sort`: its title is read from the doc.
        this.dialect.titleSort
          ? `SELECT i.file_alias AS card_id, ANY_VALUE(i.title_sort) AS card_title`
          : `SELECT i.file_alias AS card_id, ANY_VALUE(json_extract(i.search_doc, '$.cardTitle')) AS card_title`,
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
        `WHERE i.type = 'instance' AND`,
        ...realmIs('i.realm_url', realmURL),
        'AND (i.is_deleted = FALSE OR i.is_deleted IS NULL) AND i.file_alias IN',
        ...addExplicitParens(separatedByCommas(ids.map((id) => [param(id)]))),
        ...granted,
        'GROUP BY i.file_alias',
      ],
      opts.timings,
      opts,
    );
    let titles = new Map(
      rows
        .filter((row) => row.card_title != null)
        .map((row) => [String(row.card_id), String(row.card_title)]),
    );
    return counts.map((c) =>
      titles.has(c.value) ? { ...c, label: titles.get(c.value)! } : c,
    );
  }

  #statsPart(work: FacetWork): CardExpression {
    return [
      `(SELECT to_jsonb(x) FROM (SELECT COUNT(DISTINCT fv.kn) AS count, COUNT(DISTINCT fv.value COLLATE "C") AS distinct_count, COUNT(fv.num) AS numeric_count, MIN(fv.num) AS min_num, MAX(fv.num) AS max_num, CAST(MIN(fv.num) AS TEXT) AS min_num_text, CAST(MAX(fv.num) AS TEXT) AS max_num_text, SUM(fv.num) AS sum_num, MIN(fv.value) AS min_text, MAX(fv.value) AS max_text FROM`,
      ...this.#facetValuesTable(work),
      ') AS x)',
    ];
  }

  #statsOf(row: unknown, plan: FacetPlan): FacetStats {
    let r = (row ?? undefined) as Record<string, unknown> | undefined;
    let stats: FacetStats = {
      count: Number(r?.count ?? 0),
      distinct: Number(r?.distinct_count ?? 0),
    };
    let values = Number(r?.numeric_count ?? 0);
    if (values > 0) {
      let sum = Number(r!.sum_num);
      // A big integer past a double's exact range keeps its exact digits.
      let exact = (n: unknown, text: unknown) => {
        let value = Number(n);
        return plan.bigInteger && text != null && !Number.isSafeInteger(value)
          ? String(text)
          : value;
      };
      Object.assign(stats, {
        values,
        min: exact(r!.min_num, r!.min_num_text),
        max: exact(r!.max_num, r!.max_num_text),
        sum,
        avg: sum / values,
      });
    } else if (r?.min_text != null) {
      Object.assign(stats, {
        min: String(r.min_text),
        max: String(r.max_text),
      });
    }
    return stats;
  }

  #rangesPart(
    work: FacetWork,
    ranges: FacetRange[],
    opts: QueryOptions,
  ): CardExpression {
    let { plan } = work;
    let columns: CardExpression = [];
    ranges.forEach((range, index) => {
      let column =
        typeof (range.from ?? range.to) === 'number' ? 'fv.num' : 'fv.value';
      let dates = Boolean(plan.dateField);
      let dateOnly = Boolean(plan.dateOnly);
      let from = dates
        ? facetRangeBound(range.from, opts.queryNow, dateOnly)
        : range.from;
      let to = dates
        ? facetRangeBound(range.to, opts.queryNow, dateOnly)
        : range.to;
      let bounds: CardExpression = [];
      if (from !== undefined) {
        bounds.push(`${column} >=`, param(from));
      }
      if (to !== undefined) {
        bounds.push(
          ...(bounds.length ? ['AND'] : []),
          `${column} <`,
          param(to),
        );
      }
      // Whether any of a match's values falls in the range.
      columns.push(
        ...(index > 0 ? [','] : []),
        `bool_or(${column} IS NOT NULL AND`,
        ...bounds,
        `) AS r${index}`,
      );
    });
    // Each range counts its matches with a value in it: one grouping by
    // match for every range.
    return [
      `(SELECT to_jsonb(x) FROM (SELECT ${ranges.map((_, index) => `COUNT(*) FILTER (WHERE g.r${index}) AS r${index}`).join(', ')} FROM (SELECT`,
      ...columns,
      'FROM',
      ...this.#facetValuesTable(work),
      'GROUP BY fv.kn) AS g) AS x)',
    ];
  }

  #intervalPart(work: FacetWork, opts: QueryOptions): CardExpression {
    let interval = work.interval!;
    let order = work.order === 'measure' ? 'count' : work.order;
    // An instant, bucketed by its UTC day: a number is epoch seconds (or
    // milliseconds); text on a real calendar day is a date or date-time. One
    // with `Z` or an offset is that instant; one that names no zone (the
    // serializer's `yyyy-MM-ddTHH:mm`) is read as UTC, never in the session's
    // zone. Text that only looks like a date is no value, not an error.
    let pgInstant: string = `CASE WHEN fv.num IS NOT NULL THEN to_timestamp((CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000 ELSE fv.num END)::float8) AT TIME ZONE 'UTC' WHEN fv.value ~ '^\\d{4}-\\d{2}-\\d{2}' AND pg_input_is_valid(fv.value, 'timestamptz') THEN (CASE WHEN fv.value ~ '[T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?\\s*(Z|[+-]\\d{2}(:?\\d{2})?)$' THEN fv.value::timestamptz AT TIME ZONE 'UTC' ELSE fv.value::timestamp END) END`;
    // In a zone other than UTC the bucket is the zone's day, week, month or
    // year of the instant: its wall time there, from its UTC wall time. A
    // date (`yyyy-MM-dd`) is a calendar day, so it stays the day it names.
    let zone = zoneOfClock(opts.queryNow);
    if (!isUtcZone(zone)) {
      pgInstant = `CASE WHEN fv.num IS NOT NULL THEN ${pgLocalTimestamp(`to_timestamp((CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000 ELSE fv.num END)::float8) AT TIME ZONE 'UTC'`, zone)} WHEN fv.value ~ '^\\d{4}-\\d{2}-\\d{2}' AND pg_input_is_valid(fv.value, 'timestamptz') THEN (CASE WHEN fv.value ~ '[T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?\\s*(Z|[+-]\\d{2}(:?\\d{2})?)$' THEN ${pgLocalTimestamp(`fv.value::timestamptz AT TIME ZONE 'UTC'`, zone)} WHEN fv.value ~ '[T ]\\d{2}:\\d{2}' THEN ${pgLocalTimestamp('fv.value::timestamp', zone)} ELSE fv.value::timestamp END) END`;
    }
    let by = (alias: string) =>
      order === 'value'
        ? `${alias}facet_value`
        : `${alias}count DESC, ${alias}facet_value`;
    return [
      `(SELECT jsonb_agg(x ORDER BY ${by('x.')}) FROM (`,
      'SELECT b.bucket AS facet_value, COUNT(DISTINCT b.k) AS count FROM (SELECT',
      ...this.dialect.dateBucket(pgBucketLabel(interval, pgInstant), interval),
      'AS bucket',
      ', fv.kn AS k FROM',
      ...this.#facetValuesTable(work),
      ') AS b WHERE b.bucket IS NOT NULL GROUP BY b.bucket',
      `ORDER BY ${by('')}`,
      `LIMIT ${Number(work.size)}`,
      ') AS x)',
    ];
  }

  // On SQLite, which keeps no value store: each facet counted in JS over its
  // match set's first rows (sqlite-facets.ts), read through the search
  // itself in the query's order, `query` being the search as asked. A set
  // the bounds cut is counted over the rows read, and says so.
  protected async countFacetsFromSearchDocs(
    plans: FacetPlan[],
    query: Pick<Query, 'filter' | 'sort' | 'let'>,
    realmURL: URL,
    opts: QueryOptions,
    entryType: 'instance' | 'file' | 'all',
  ): Promise<Map<FacetPlan, { counts: FacetCount[]; stats?: FacetStats }>> {
    let out = new Map<
      FacetPlan,
      { counts: FacetCount[]; stats?: FacetStats }
    >();
    let zone = zoneOfClock(opts.queryNow);
    let groups = new Map<string, FacetPlan[]>();
    for (let plan of plans) {
      if (plan.uncounted) {
        out.set(plan, { counts: [] });
        opts.approximations?.push(
          sqliteFacetNotCounted(
            plan.facet.by,
            plan.measurePath
              ? 'a measure is aggregated in the value store'
              : 'only the value store says which cards of other types hold it',
          ),
        );
        continue;
      }
      let filter =
        plan.facet.own === 'ignore' && query.filter
          ? filterWithout(query.filter, plan.facet.by)
          : query.filter;
      let key = stringify(filter ?? null);
      groups.set(key, [...(groups.get(key) ?? []), plan]);
    }
    let { rows: bound } = sqliteFacetLimits(opts);
    for (let group of groups.values()) {
      let filter =
        group[0].facet.own === 'ignore' && query.filter
          ? filterWithout(query.filter, group[0].facet.by)
          : query.filter;
      let works = group.map((plan, f) => {
        let work = this.#facetWork(plan, f, '', [], opts);
        if (work.interval && !isUtcZone(zone)) {
          opts.approximations?.push(
            sqliteFacetIntervalUtc(plan.facet.by, zone),
          );
        }
        return { plan, work };
      });
      let { results, meta } = await this._search(
        realmURL,
        {
          filter,
          sort: query.sort,
          ...(query.let ? { let: query.let } : {}),
          page: { size: bound, total: 'exact' },
        },
        opts,
        [
          'SELECT i.url AS url, ANY_VALUE(i.search_doc) AS search_doc, ANY_VALUE(i.types) AS types, ANY_VALUE(i.display_names) AS display_names, ANY_VALUE(i.realm_url) AS realm_url, ANY_VALUE(i.resource_created_at) AS resource_created_at, ANY_VALUE(i.last_modified) AS last_modified',
        ],
        entryType,
      );
      let rows: FacetRow[] = (results as Record<string, unknown>[]).map(
        (row) => {
          let doc: unknown = row.search_doc;
          if (typeof doc === 'string') {
            try {
              doc = JSON.parse(doc);
            } catch {
              doc = undefined;
            }
          }
          return { key: String(row.url), doc, columns: row };
        },
      );
      let sqliteWorks = works.map(({ work }) => work as SqliteFacetWork);
      let { values, read } = readFacetValues(sqliteWorks, rows, opts);
      let total = Number(meta.page?.total ?? rows.length);
      if (read < total) {
        opts.approximations?.push(sqliteFacetSampled(read, total));
      }
      for (let work of sqliteWorks) {
        let result = countFacet(work, values.get(work)!, read, opts.queryNow);
        if (work.plan.link && !work.interval && work.plan.shape !== 'range') {
          result.counts = await this.#labelLinkCounts(
            result.counts,
            opts,
            realmURL,
            work.plan.linkTarget,
          );
        }
        out.set(work.plan, result);
      }
    }
    return out;
  }
}

// The longest value a facet counts: no facet counts by a paragraph.
const MAX_FACET_VALUE_LENGTH = 1024;

// Whether the value store holds only a marker for card `k` at or above
// `path` (the card's value there is only in its search doc).
function markedAt(path: string): CardExpression {
  // One probe per path at or above it, each on the marker index's whole key
  // (an array of path ids leaves the planner free to seek on realm, type
  // and card alone and filter every marker of the type by path).
  let probes = pathPrefixes(path).map((p) => [
    'EXISTS (SELECT 1 FROM boxel_index_values AS vm WHERE vm.realm_id = k.realm_id AND vm.type_id = k.type_id AND vm.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =',
    param(p),
    ") AND vm.card_id = k.card_id AND vm.kind = 'm')",
  ]);
  return [
    '(',
    ...probes.flatMap((probe, i) => (i > 0 ? ['OR', ...probe] : probe)),
    ')',
  ];
}

// A dotted path as a Postgres text-array literal for `#>`.
function pathArray(path: string): string {
  return `'{${removeBrackets(path).split('.').map(arrayElement).join(',')}}'::text[]`;
}

// The members of a lax JSON path that steps into every list on the way
// (`."items"."name"`), as a SQL string literal.
function laxPath(path: string): string {
  let members = removeBrackets(path)
    .split('.')
    .map((seg) => `."${seg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join('');
  return `'${members.replace(/'/g, "''")}'`;
}

// The column prefix of the facets' columns in a statement that also reads
// the page.
export const SHARED_FACET_PREFIX = '__facet_p';

// A statement's CTE that holds a match set, one row per match (`url`,
// `type`, `__realm_url`, `__type_key`), and the condition it holds the
// matches of.
export interface FacetSource {
  condition: CardExpression;
  from: string;
}

// The facets' counting, before any statement runs.
export interface FacetQuery {
  works: FacetWork[];
  parts: CardExpression[];
  names: { stats?: string; missing?: string; counts?: string }[];
}

// One facet's counting over the keys of its match set (`base`, the CTE of
// `condition`'s matches); `f` numbers it in the statement's facet rows.
export interface FacetWork {
  plan: FacetPlan;
  f: number;
  base: string;
  condition: CardExpression;
  size: number;
  interval?: FacetInterval;
  order: 'count' | 'value' | 'measure';
  wantStats: boolean;
  ranges?: FacetRange[];
  // A range facet that names no ranges: its statistics give them.
  autoRanges: boolean;
  // Its counts list values, read from the set's grouped value counts.
  counted: boolean;
  // Its match set, when the value store decides it (store-facets.ts).
  storeSet?: StoreFacetSet;
}

// The value-store paths the facets `held` read, in one map read once: each
// facet's path (a link's `path.id`) and its id, the ids of the paths at or
// above it (where a marker sends a card's value to its search doc), and the
// card types it counts (all, when null).
function facetPathsCte(held: FacetWork[]): CardExpression {
  let rows: CardExpression[] = held.map((work) => {
    let path = storedPathOf(work.plan);
    let holders = work.plan.holderTypes;
    return [
      `(${work.f},`,
      param(path),
      '::text, ARRAY[',
      ...separatedByCommas(pathPrefixes(path).map((p) => [param(p)])),
      ']::text[],',
      ...(holders
        ? [
            'ARRAY[',
            ...separatedByCommas(holders.map((t) => [param(t)])),
            ']::text[]',
          ]
        : ['NULL::text[]']),
      ')',
    ];
  });
  return [
    'facet_paths AS MATERIALIZED (SELECT t.f, p.id AS path_id, ARRAY(SELECT vp.id FROM boxel_index_value_paths AS vp WHERE vp.path = ANY (t.prefixes)) AS prefix_ids, t.holders FROM (VALUES',
    ...separatedByCommas(rows),
    // The card row's path ('') holds no field's value.
    ") AS t(f, path, prefixes, holders) LEFT JOIN boxel_index_value_paths AS p ON p.path = t.path AND t.path <> '')",
  ];
}

// Whether a facet over a set the value store decides counts from the store
// alone: a declared field's values, with no measure.
export function storeCounts(plan: FacetPlan): boolean {
  return !plan.column && !plan.measurePath && !facetMeasureOf(plan.facet);
}

// Where a declared facet's values are in the value store: its read path, or
// a link's `path.id`.
export function storedPathOf(plan: FacetPlan): string {
  let read = plan.read ?? plan.facet.by;
  return plan.link ? `${read}.id` : read;
}

// '' and each dotted prefix of `path`, through `path` itself.
function pathPrefixes(path: string): string[] {
  let segments = path.split('.');
  return [''].concat(
    segments.map((_, i) => segments.slice(0, i + 1).join('.')),
  );
}

// The card types a facet counts, as a condition on match `k`.
function holdersOf(plan: FacetPlan): CardExpression {
  return plan.holderTypes
    ? [
        "AND COALESCE(k.type_key, '') IN",
        ...addExplicitParens(
          separatedByCommas(plan.holderTypes.map((t) => [param(t)])),
        ),
      ]
    : [];
}

// Expressions joined by UNION ALL.
function unionAll(arms: CardExpression[]): CardExpression {
  return arms.flatMap((arm, i) => (i > 0 ? ['UNION ALL', ...arm] : arm));
}

// Whether `expression` reads a list as a table (a lateral join of the
// statement), which can repeat an index row.
function fansOut(expression: unknown[]): boolean {
  return expression.some((element) => {
    if (!element || typeof element !== 'object') {
      return false;
    }
    if (isDbExpression(element)) {
      return Object.values(element).some(
        (value) => Array.isArray(value) && fansOut(value),
      );
    }
    return (element as { kind?: string }).kind === 'table-valued-tree';
  });
}
