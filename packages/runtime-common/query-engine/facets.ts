// Facets: planning each requested facet (declared or built-in, its shape,
// the types that hold it) and counting it from the facet table over the
// page's match set: values, link labels, statistics, ranges and date
// intervals.
// Owns: the facet statements and the declaration checks
// (`needs-declaration`, `needs-type`).
// Must not: change the page's rows or total (a facet ignoring its own
// selection drops predicates only from its own count).
// Guarantees: docs/search.md ("Facets").

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
  dbExpression,
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
} from './facet-sql.ts';
import {
  DEFAULT_FACET_SIZE,
  FACET_INTERVALS,
  type Facet,
  type FacetCount,
  type FacetInterval,
  type FacetRange,
  type FacetStats,
  type Filter,
  InvalidQueryError,
  assertRelativeDateWellFormed,
  facetRangeLabel,
} from '../query.ts';
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
} from '../time-zone.ts';
import {
  prerenderedJoin,
  prerenderedTableFromOpts,
  tableFromOpts,
} from './index-sql.ts';
import { realmIs } from '../realm-union.ts';

export abstract class Facets extends SortWindow {
  // Each extended facet's plan, for the queries that read its values.
  #facetPlanOf = new WeakMap<Facet, FacetPlan>();

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
  // declared field's type's. Facets are counted from the facet table, which
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
    this.dialect.requirePostgres(
      'facets are counted from the facet table, which only the Postgres index keeps; this index (SQLite) cannot count them',
    );
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
    // The declared facet `path` names, or 'empty' when no card the query
    // could match holds it (nothing to count).
    let resolve = async (
      path: string,
      member: string,
      // Set by a facet whose query names its shape: holders that declare the
      // field as different kinds of value are then counted as plain values.
      shaped = false,
    ): Promise<DeclaredFacet | 'empty' | 'rows'> => {
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
      // card's. Its cards' own types must declare it.
      let holders = realmURL
        ? await this.#facetHolderTypes(realmURL, anchor, path, opts)
        : { declared: [], rows: false, undeclared: undefined };
      if (holders.undeclared === null) {
        throw new InvalidQueryError(
          `${member} "${path}": cards with no recorded type hold "${path}", so no declaration makes it a facet of theirs; anchor the query on a type (\`type\`) that declares \`search: { facet: true }\` on it`,
          'needs-declaration',
        );
      }
      if (holders.undeclared) {
        let ref = codeRefFromInternalKey(holders.undeclared);
        let def = ref ? await lookup(ref) : undefined;
        let missing = def
          ? await missingFacetDeclaration(def, path, lookup, member)
          : undefined;
        throw new InvalidQueryError(
          missing ??
            `${member} "${path}": cards of ${ref?.name ?? holders.undeclared} hold "${path}", which their type does not declare as a facet. Facets count only declared fields: add \`search: { facet: true }\` to the field where ${ref?.name ?? 'the type'} defines it`,
          'needs-declaration',
        );
      }
      // Every holder's declaration, so the facet's shape never depends on
      // which type's cards the database happens to list first.
      let declarations: { type: string; facet: DeclaredFacet }[] = [];
      for (let key of holders.declared) {
        let ref = codeRefFromInternalKey(key);
        let def = ref ? await lookup(ref) : undefined;
        let found = def
          ? (await declaredFacetFields(def, lookup)).get(path)
          : undefined;
        if (found) {
          declarations.push({ type: ref?.name ?? key, facet: found });
        }
      }
      let kindOf = (f: DeclaredFacet) =>
        f.link ? 'a link' : (f.field.serializerName ?? 'text');
      let kinds = new Set(declarations.map((d) => kindOf(d.facet)));
      if (kinds.size > 1) {
        if (shaped) {
          // The query says how to count it; each stored value counts as
          // the text it is (the number 10 and the text "10" alike).
          return 'rows';
        }
        throw new InvalidQueryError(
          `${member} "${path}": the types whose cards hold it declare it as different kinds of value (${declarations
            .map((d) => `${d.type}: ${kindOf(d.facet)}`)
            .join(
              ', ',
            )}), so the facet has no one shape: anchor the query on one type (\`type\`), or name the shape (\`stats: true\` to count each stored value, \`ranges\` or \`interval\`)`,
          'needs-type',
        );
      }
      if (declarations.length > 0) {
        return declarations[0].facet;
      }
      if (holders.rows) {
        // The facet table holds rows for it, and it keeps rows only for
        // fields declared facets when the card was indexed, but no holder's
        // type resolves now (a module that no longer loads, a row with no
        // recorded type): its rows count as plain values, whose shape no
        // declaration can say.
        return 'rows';
      }
      if (typed && definition) {
        // As in a filter, a name no card of the type can hold is refused.
        try {
          await getField(definition, path, this.definitionLookup);
        } catch (e) {
          if (e instanceof InvalidQueryError && e.code === 'unknown-field') {
            throw new InvalidQueryError(
              `${member} "${path}": ${e.message.replace(/^Your filter refers to/, 'refers to')}`,
              'unknown-field',
            );
          }
          throw e;
        }
      }
      return 'empty';
    };
    let plans: FacetPlan[] = [];
    for (let facet of facets) {
      let measured = facetMeasureOf(facet);
      let measure: Pick<FacetPlan, 'measurePath' | 'measureScalar'> = {};
      if (measured) {
        if (isIndexField(measured.path)) {
          throw new InvalidQueryError(
            `facet measure ${measured.op} "${measured.path}": a measure aggregates a number field declared \`search: { facet: true }\`, not an index field`,
            'invalid-value',
          );
        }
        let m = await resolve(measured.path, `facet measure ${measured.op}`);
        measure = {
          measurePath: measured.path,
          // A list holds no one number to aggregate.
          measureScalar:
            m !== 'empty' &&
            m !== 'rows' &&
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
      if (found === 'rows') {
        plans.push({ facet, shape: queryShape ?? 'values', ...measure });
        continue;
      }
      if (found === 'empty') {
        plans.push({
          facet,
          shape: queryShape ?? 'values',
          empty: true,
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
        ...(found.link ? { link: true } : {}),
        ...(found.link ? { linkTarget: found.linkTarget } : {}),
        ...(serializer === 'big-integer' ? { bigInteger: true } : {}),
        ...(DATE_SERIALIZERS.has(serializer) ? { dateField: true } : {}),
        ...(serializer === 'date' ? { dateOnly: true } : {}),
        ...measure,
      });
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
    throw new InvalidQueryError(
      `facet by "${name}": ${typeName} does not declare the index field "${name}" a facet. Base declares the index fields every card and file has in \`static indexFields\` (\`${name}: { search: { facet: true } }\`)${name === '_cardType' ? '; a file has no `_cardType`: facet a mixed search by `_type`' : ''}`,
      'needs-declaration',
    );
  }

  // The types of the cards (of `type`, when the query names one) in the realm
  // that hold a value at `path`: those whose rows are in the facet table
  // (their types declared it when the cards were indexed; `rows` says
  // whether any are, whatever their type), in type order, or, when none are,
  // one type whose cards hold it in their search docs undeclared (for the
  // refusal to name; `null` when those rows record no type).
  async #facetHolderTypes(
    realmURL: URL,
    type: CodeRef | undefined,
    path: string,
    opts: QueryOptions,
  ): Promise<{
    declared: string[];
    rows: boolean;
    undeclared: string | null | undefined;
  }> {
    let typeCondition: CardExpression = type
      ? ['AND', ...this.typeCondition(type)]
      : [];
    let rows = await this.queryCards(
      [
        'SELECT DISTINCT i.types ->> 0 AS type_key FROM boxel_index_facet_values AS f',
        `JOIN ${tableFromOpts(opts)} AS i ON i.realm_url = f.realm_url AND i.url = f.url AND i.type = f.type`,
        'WHERE',
        ...realmIs('f.realm_url', realmURL),
        'AND f.field_path =',
        param(path),
        'AND (i.is_deleted = FALSE OR i.is_deleted IS NULL)',
        ...typeCondition,
        'ORDER BY type_key',
        'LIMIT 20',
      ],
      opts.timings,
      opts,
    );
    let declared = rows
      .map((row) => row.type_key)
      .filter((key): key is string => typeof key === 'string');
    if (rows.length > 0) {
      return { declared, rows: true, undeclared: undefined };
    }
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
      declared,
      rows: false,
      // `null`: cards hold it whose rows record no type.
      undeclared: !held
        ? undefined
        : typeof held.type_key === 'string'
          ? held.type_key
          : null,
    };
  }

  // Value facets over the same filter share one read of the matching keys.
  protected async batchValueFacets(
    plans: FacetPlan[],
    opts: QueryOptions,
    condition: CardExpression,
    realmURL: URL,
  ): Promise<Map<FacetPlan, FacetCount[]>> {
    let batch = plans.filter(
      ({ facet, shape, column, empty, link, bigInteger, measurePath }) =>
        shape === 'values' &&
        !column &&
        !empty &&
        !link &&
        !bigInteger &&
        !measurePath &&
        !facet.stats &&
        !facet.missing &&
        !facet.prefix &&
        (!facet.order || facet.order === 'count') &&
        facet.own !== 'ignore',
    );
    if (batch.length < 2) {
      return new Map();
    }

    let requested = batch.map(({ facet }, slot) =>
      addExplicitParens([
        String(slot),
        ',',
        param(facet.by),
        ',',
        param(facet.size ?? DEFAULT_FACET_SIZE),
        '::integer',
      ]),
    );
    let rows = await this.queryCards(
      [
        'WITH requested(slot, path, size) AS (VALUES',
        ...separatedByCommas(requested),
        '), counts AS (SELECT field_path, facet_value, COUNT(*) AS count FROM (',
        'SELECT DISTINCT fv.field_path, fv.url, fv.type, fv.txt AS facet_value, fv.num',
        'FROM boxel_index_facet_values AS fv WHERE',
        ...realmIs('fv.realm_url', realmURL),
        'AND fv.field_path IN',
        ...addExplicitParens(
          separatedByCommas(batch.map(({ facet }) => [param(facet.by)])),
        ),
        'AND (fv.realm_url, fv.url, fv.type) IN (SELECT i.realm_url, i.url, i.type',
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
        tableValuedFunctionsPlaceholder,
        'WHERE',
        ...condition,
        ')) AS facet_rows GROUP BY field_path, facet_value',
        '), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY field_path ORDER BY count DESC, facet_value) AS position FROM counts)',
        'SELECT slot, facet_value, count FROM ranked JOIN requested ON path = field_path',
        'WHERE position <= size ORDER BY slot, position',
      ],
      opts.timings,
      opts,
    );
    return new Map(
      batch.map((plan, slot) => [
        plan,
        facetCountsOf(rows.filter((row) => Number(row.slot) === slot)),
      ]),
    );
  }

  // A facet that isn't plain values counted with the page: its counts (by
  // value, by range or by date bucket) and, when it asked for them or its
  // shape implies them, its statistics.
  protected async extendedFacet(
    plan: FacetPlan,
    opts: QueryOptions,
    condition: CardExpression,
    realmURL: URL,
  ): Promise<{ counts: FacetCount[]; stats?: FacetStats }> {
    let { facet, shape, link, linkTarget } = plan;
    this.#facetPlanOf.set(facet, plan);
    let size = facet.size ?? DEFAULT_FACET_SIZE;
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
    let stats = wantStats
      ? await this.#facetStatsQuery(facet, opts, condition)
      : undefined;
    let counts: FacetCount[];
    if (shape === 'range') {
      let ranges = facet.ranges ?? autoFacetRanges(stats);
      counts =
        ranges.length > 0
          ? await this.#facetRangeCounts(facet, ranges, opts, condition)
          : await this.#facetValueCounts(facet, size, order, opts, condition);
    } else if (interval) {
      counts = await this.#facetIntervalCounts(
        facet,
        interval,
        size,
        order === 'measure' ? 'count' : order,
        opts,
        condition,
      );
    } else {
      counts = await this.#facetValueCounts(
        facet,
        size,
        order,
        opts,
        condition,
      );
      if (link) {
        counts = await this.#labelLinkCounts(
          counts,
          opts,
          realmURL,
          linkTarget,
        );
      }
    }
    if (!stats) {
      return { counts };
    }
    let out: FacetStats = { count: stats.count, distinct: stats.distinct };
    if (facet.stats || shape !== 'values') {
      Object.assign(out, stats);
    }
    if (facet.missing) {
      let [row] = await this.queryCards(
        [
          'SELECT COUNT(*) AS total FROM (SELECT DISTINCT i.url, i.type',
          `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
          'WHERE',
          ...condition,
          ') AS t',
        ],
        opts.timings,
        opts,
      );
      out.missing = Math.max(0, Number(row?.total ?? 0) - stats.count);
    }
    if (shape !== 'range') {
      out.order = order;
    }
    return { counts, stats: out };
  }

  // The facet's values over the rows `condition` admits, one row per match
  // and distinct value: `value` as text (a link's linked card id) and `num`
  // when it is a number, with the match's `measure`. A declared field's
  // values are its rows in the facet table (one per element of a list); a
  // built-in facet's value is the index row's own column.
  #facetValuesTable(
    facet: Facet,
    opts: QueryOptions,
    condition: CardExpression,
  ): CardExpression {
    let plan = this.#facetPlanOf.get(facet);
    if (!plan || plan.empty) {
      return [
        '(SELECT NULL::text AS url, NULL::text AS type, NULL::text AS value, NULL::numeric AS num, NULL::numeric AS measure WHERE FALSE) AS fv',
      ];
    }
    let measure: CardExpression =
      plan.measurePath && plan.measureScalar
        ? [
            ', (SELECT mv.num FROM boxel_index_facet_values AS mv WHERE mv.realm_url = i.realm_url AND mv.url = i.url AND mv.type = i.type AND mv.field_path =',
            param(plan.measurePath),
            'LIMIT 1) AS measure',
          ]
        : [', NULL::numeric AS measure'];
    let from = `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`;
    if (plan.column) {
      // A built-in date (an epoch in seconds or milliseconds) reads as its
      // UTC instant in ISO form, as a date field's value does.
      let value = plan.builtInDate
        ? `to_char(to_timestamp((CASE WHEN abs(${plan.column}) >= 100000000000 THEN ${plan.column} / 1000.0 ELSE ${plan.column} END)::float8) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
        : `(${plan.column})::text`;
      return [
        `(SELECT DISTINCT i.url, i.type, ${value} AS value, NULL::numeric AS num`,
        ...(plan.labelColumn ? [`, ${plan.labelColumn} AS label`] : []),
        ...measure,
        from,
        tableValuedFunctionsPlaceholder,
        'WHERE',
        ...condition,
        `AND (${plan.column}) IS NOT NULL`,
        ') AS fv',
      ];
    }
    // A big integer is decimal text, so it counts as a number where it
    // spells a whole number.
    let num = plan.bigInteger
      ? `COALESCE(fv0.num, CASE WHEN fv0.txt ~ '^\\s*-?[0-9]+\\s*$' THEN trim(fv0.txt)::numeric END)`
      : 'fv0.num';
    return [
      `(SELECT DISTINCT i.url, i.type, fv0.txt AS value, ${num} AS num`,
      ...measure,
      from,
      'JOIN boxel_index_facet_values AS fv0 ON fv0.realm_url = i.realm_url AND fv0.url = i.url AND fv0.type = i.type AND fv0.field_path =',
      param(facet.by),
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...condition,
      ') AS fv',
    ];
  }

  async #facetValueCounts(
    facet: Facet,
    size: number,
    order: 'count' | 'value' | 'measure',
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetCount[]> {
    let measured = facetMeasureOf(facet);
    let labeled = Boolean(this.#facetPlanOf.get(facet)?.labelColumn);
    let rows = await this.queryCards(
      [
        'SELECT fv.value AS facet_value, COUNT(*) AS count',
        measured
          ? `, ${measured.op.toUpperCase()}(fv.measure) AS facet_measure`
          : '',
        labeled ? ', MAX(fv.label) AS facet_label' : '',
        'FROM',
        ...this.#facetValuesTable(facet, opts, condition),
        ...(facet.prefix
          ? [
              'WHERE LOWER(fv.value) LIKE LOWER(',
              param(`${escapeLikePattern(facet.prefix)}%`),
              `) ESCAPE '\\'`,
            ]
          : []),
        'GROUP BY fv.value',
        order === 'value'
          ? 'ORDER BY fv.value'
          : order === 'measure' && measured
            ? 'ORDER BY facet_measure DESC NULLS LAST, count DESC, fv.value'
            : 'ORDER BY count DESC, fv.value',
        `LIMIT ${Number(size)}`,
      ],
      opts.timings,
      opts,
    );
    let kept = rows.filter((row) => row.facet_value != null);
    let counts = facetCountsOf(kept);
    if (measured) {
      counts = counts.map((c, i) =>
        kept[i].facet_measure == null
          ? c
          : { ...c, measure: { [measured.op]: Number(kept[i].facet_measure) } },
      );
    }
    if (labeled) {
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
        // `title_sort` is the card's title as its own column holds it.
        `SELECT i.file_alias AS card_id, ANY_VALUE(i.title_sort) AS card_title`,
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

  async #facetStatsQuery(
    facet: Facet,
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetStats> {
    let [row] = await this.queryCards(
      [
        `SELECT COUNT(DISTINCT fv.url || '|' || fv.type) AS count, COUNT(DISTINCT fv.value) AS distinct_count, COUNT(fv.num) AS numeric_count, MIN(fv.num) AS min_num, MAX(fv.num) AS max_num, CAST(MIN(fv.num) AS TEXT) AS min_num_text, CAST(MAX(fv.num) AS TEXT) AS max_num_text, SUM(fv.num) AS sum_num, MIN(fv.value) AS min_text, MAX(fv.value) AS max_text FROM`,
        ...this.#facetValuesTable(facet, opts, condition),
      ],
      opts.timings,
      opts,
    );
    let stats: FacetStats = {
      count: Number(row?.count ?? 0),
      distinct: Number(row?.distinct_count ?? 0),
    };
    let values = Number(row?.numeric_count ?? 0);
    if (values > 0) {
      let sum = Number(row!.sum_num);
      // A big integer past a double's exact range keeps its exact digits.
      let bigInteger = this.#facetPlanOf.get(facet)?.bigInteger;
      let exact = (n: unknown, text: unknown) => {
        let value = Number(n);
        return bigInteger && text != null && !Number.isSafeInteger(value)
          ? String(text)
          : value;
      };
      Object.assign(stats, {
        values,
        min: exact(row!.min_num, row!.min_num_text),
        max: exact(row!.max_num, row!.max_num_text),
        sum,
        avg: sum / values,
      });
    } else if (row?.min_text != null) {
      Object.assign(stats, {
        min: String(row.min_text),
        max: String(row.max_text),
      });
    }
    return stats;
  }

  async #facetRangeCounts(
    facet: Facet,
    ranges: FacetRange[],
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetCount[]> {
    let columns: CardExpression = [];
    ranges.forEach((range, index) => {
      let column =
        typeof (range.from ?? range.to) === 'number' ? 'fv.num' : 'fv.value';
      // A relative date is one only on a date field; elsewhere it is text.
      let dates = Boolean(this.#facetPlanOf.get(facet)?.dateField);
      if (dates) {
        assertRelativeDateWellFormed(range.from, facet.by);
        assertRelativeDateWellFormed(range.to, facet.by);
      }
      let dateOnly = Boolean(this.#facetPlanOf.get(facet)?.dateOnly);
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
      columns.push(
        ...(index > 0 ? [','] : []),
        `COUNT(DISTINCT CASE WHEN ${column} IS NOT NULL AND`,
        ...bounds,
        `THEN fv.url || '|' || fv.type END) AS r${index}`,
      );
    });
    let [row] = await this.queryCards(
      [
        'SELECT',
        ...columns,
        'FROM',
        ...this.#facetValuesTable(facet, opts, condition),
      ],
      opts.timings,
      opts,
    );
    return ranges.map((range, index) => ({
      value: facetRangeLabel(range),
      count: Number(row?.[`r${index}`] ?? 0),
    }));
  }

  async #facetIntervalCounts(
    facet: Facet,
    interval: FacetInterval,
    size: number,
    order: 'count' | 'value',
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetCount[]> {
    // The interval is written into the SQL below, so it's checked here too:
    // a query-backed field's query reaches the engine without assertQuery.
    if (!(FACET_INTERVALS as readonly string[]).includes(interval)) {
      throw new InvalidQueryError(
        `facet interval must be one of ${FACET_INTERVALS.join(', ')}`,
        'invalid-value',
      );
    }
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
      this.dialect.requirePostgres(
        `a facet interval in a time zone other than UTC ("${zone}") runs on Postgres only`,
      );
      pgInstant = `CASE WHEN fv.num IS NOT NULL THEN ${pgLocalTimestamp(`to_timestamp((CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000 ELSE fv.num END)::float8) AT TIME ZONE 'UTC'`, zone)} WHEN fv.value ~ '^\\d{4}-\\d{2}-\\d{2}' AND pg_input_is_valid(fv.value, 'timestamptz') THEN (CASE WHEN fv.value ~ '[T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?\\s*(Z|[+-]\\d{2}(:?\\d{2})?)$' THEN ${pgLocalTimestamp(`fv.value::timestamptz AT TIME ZONE 'UTC'`, zone)} WHEN fv.value ~ '[T ]\\d{2}:\\d{2}' THEN ${pgLocalTimestamp('fv.value::timestamp', zone)} ELSE fv.value::timestamp END) END`;
    }
    let sqliteInstant = `CASE WHEN fv.num IS NOT NULL THEN datetime(CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000.0 ELSE fv.num END, 'unixepoch') ELSE datetime(fv.value) END`;
    let sqliteBucket = {
      day: `date(${sqliteInstant})`,
      week: `date(${sqliteInstant}, '-6 days', 'weekday 1')`,
      month: `strftime('%Y-%m-01', ${sqliteInstant})`,
      year: `strftime('%Y-01-01', ${sqliteInstant})`,
    }[interval];
    let rows = await this.queryCards(
      [
        'SELECT b.bucket AS facet_value, COUNT(DISTINCT b.k) AS count FROM (SELECT',
        dbExpression({
          pg: [`${pgBucketLabel(interval, pgInstant)} AS bucket`],
          sqlite: [`${sqliteBucket} AS bucket`],
        }),
        `, fv.url || '|' || fv.type AS k FROM`,
        ...this.#facetValuesTable(facet, opts, condition),
        ') AS b WHERE b.bucket IS NOT NULL GROUP BY b.bucket',
        order === 'value'
          ? 'ORDER BY b.bucket'
          : 'ORDER BY count DESC, b.bucket',
        `LIMIT ${Number(size)}`,
      ],
      opts.timings,
      opts,
    );
    return facetCountsOf(rows);
  }
}
