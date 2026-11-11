// Pass 1 of compilation: a filter tree (`eq`, `in`, `contains`, `range`,
// `not`, `any`, `every`, `near`, `linkedFrom`, `pattern`, `regex`, the
// type anchor) compiled to a `CardExpression`. Text filters (`matches`,
// type-ahead) compile in text-search.ts.
// Owns: each operator's meaning, the filter checks that read definitions
// (near targets, regex), the indexed UNION form of an `any`, and the
// list-element and plural-path forms.
// Must not: resolve a field to its column (expression-resolver.ts), or
// order or page.
// Guarantees: docs/search.md ("Filters", "Edge cases and what is
// guaranteed"); the client-side mirror is instance-filter-matcher.ts.

import { CARD_INSTANCE_FILE_KEY } from '../search-doc-keys.ts';
import {
  type CardExpression,
  type Expression,
  addExplicitParens,
  any,
  currentFilterNow,
  dbExpression,
  every,
  fieldArity,
  fieldQuery,
  fieldValue,
  jsonContainsQuery,
  param,
  separatedByCommas,
  spillArm as spillArmNode,
  typeCondition as typeConditionNode,
  withFilterNow,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import {
  type ContainsFilter,
  type EqFilter,
  type Filter,
  type InFilter,
  InvalidQueryError,
  type LinkedFromFilter,
  type MatchesFilter,
  type NearFilter,
  type NotFilter,
  type PatternFilter,
  RANGE_OPERATORS,
  type RangeFilter,
  type RangeFilterValue,
  type RangeOperator,
  type RegexFilter,
  type TypeAheadFilter,
  filterOperators,
  isCardTypeFilter,
  isMatchesFilter,
  isNearFilter,
  isReferenceFilterField,
  isTypeAheadFilter,
  matchesHoldsNoWord,
} from '../query.ts';
import {
  DEFAULT_FILTER_CONTEXT,
  type FilterContext,
  type FilterPolarity,
  type QueryOptions,
  assertNever,
  flipPolarity,
} from './types.ts';
import { ExpressionResolver } from './expression-resolver.ts';
import type * as JSONTypes from 'json-typescript';
import type { NearContext } from '../vector-query.ts';
import { SPILL_KINDS, SPILL_MARKER_KEY } from '../search-doc-spill.ts';
import {
  TRIGRAM_INDEXED_TITLE_KEYS,
  escapeLikePattern,
  foldSameKeyEqs,
  globToLike,
  globNeedsSegments,
  globToRegex,
  shortTitleContains,
  shortTitleContainsSelect,
} from './filter-sql.ts';
import {
  TYPE_AHEAD_TSVECTOR,
  matchTsQuery,
  renderedTsQuery,
  typeAheadTsQuery,
} from './text-search-sql.ts';
import { arrayElement } from '../sql-literal.ts';
import { currentField, getField, removeBrackets } from './filter-paths.ts';
import {
  isRealmAdmissionFilter,
  isRealmUnion,
  realmIs,
} from '../realm-union.ts';
import {
  markdownVector,
  rankVector,
  realmBound,
  searchTextVector,
  tableFromOpts,
} from './index-sql.ts';
import { FILE_PATTERN_FIELDS, searchesByPattern } from '../search-intent.ts';
import stringify from 'safe-stable-stringify';

export abstract class FilterCompiler extends ExpressionResolver {
  // Text filters compile in text-search.ts.
  protected abstract typeAheadCondition(
    filter: TypeAheadFilter,
    typeConditionRef: CodeRef | undefined,
    context: FilterContext,
  ): CardExpression;
  protected abstract matchesCondition(
    filter: MatchesFilter,
    _on: CodeRef,
    typeConditionRef?: CodeRef,
    context?: FilterContext,
  ): CardExpression;

  protected filterCondition(
    filter: Filter,
    onRef: CodeRef,
    polarity: FilterPolarity,
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    if (context.now && currentFilterNow() !== context.now) {
      let now = context.now;
      return withFilterNow(now, () =>
        this.filterCondition(filter, onRef, polarity, context),
      );
    }
    let typeRef = (filter as { type?: CodeRef }).type;
    let onProp = 'on' in filter ? filter.on : undefined;
    let on = onProp ?? typeRef ?? onRef;
    let typeConditionRef = onProp ?? typeRef;

    if (typeRef && Object.keys(filter).length === 1) {
      return this.typeCondition(typeRef);
    }

    // The validator rejects a multi-operator node on the wire, but a
    // query-backed field is indexed through here with no `assertQuery` in the
    // path. Each branch below picks a single operator, so without this backstop
    // such a node would compile on whichever one comes first and silently drop
    // the rest — diverging from the host, which rejects the same query. Reject
    // here too so every path agrees. `type`/`on` are not operators.
    let operators = filterOperators(filter);
    if (operators.length > 1) {
      throw new InvalidQueryError(
        `a filter may use only one operator, but found ${operators
          .map((key) => `"${key}"`)
          .join(
            ', ',
          )}; combine operators by nesting them under "every" or "any"`,
        'conflicting-members',
      );
    }

    if ('eq' in filter) {
      return this.eqCondition(filter, on, typeConditionRef, polarity, context);
    } else if ('in' in filter) {
      return this.inCondition(filter, on, typeConditionRef, polarity, context);
    } else if ('contains' in filter) {
      return this.containsCondition(filter, on, typeConditionRef, context);
    } else if ('not' in filter) {
      return this.notCondition(filter, on, typeConditionRef, polarity, context);
    } else if ('range' in filter) {
      return this.rangeCondition(filter, on, typeConditionRef);
    } else if ('matches' in filter) {
      return this.matchesCondition(filter, on, typeConditionRef, context);
    } else if (isTypeAheadFilter(filter)) {
      return this.typeAheadCondition(filter, typeConditionRef, context);
    } else if (isNearFilter(filter)) {
      return this.nearCondition(filter, typeConditionRef, context.realmURL);
    } else if ('linkedFrom' in filter) {
      return every([
        ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
        this.#linkedFromCondition(filter as LinkedFromFilter, context),
      ]);
    } else if (isRealmAdmissionFilter(filter)) {
      // Which rows of each realm of a union the caller reads (realm-union.ts).
      let { readable, scoped } = filter.realmAdmission;
      return any([
        ...(readable.length
          ? [
              [
                'i.realm_url IN',
                ...addExplicitParens(
                  separatedByCommas(readable.map((realm) => [param(realm)])),
                ),
              ] as CardExpression,
            ]
          : []),
        ...scoped.map(({ realm, grants }) =>
          every([
            ['i.realm_url =', param(realm)],
            this.filterCondition({ any: grants }, onRef, polarity, context),
          ]),
        ),
        // a union admitting nothing reads no row
        ...(readable.length === 0 && scoped.length === 0
          ? [['FALSE'] as CardExpression]
          : []),
      ]);
    } else if ('pattern' in filter || 'regex' in filter) {
      return this.#patternCondition(
        filter as PatternFilter | RegexFilter,
        on,
        typeConditionRef,
        context,
      );
    } else if ('every' in filter) {
      // State each type's membership test once per conjunction. A sibling
      // anchored on a type the AND already tests keeps that type for resolving
      // its fields, but emits no second test: Postgres multiplies the two
      // tests' selectivities, expects almost no rows, and then re-runs an
      // indexed `in`/`matches` subquery per row instead of hashing it (a
      // 20-value `in` beside a bare `{ on }` took 12 s against 70 ms alone).
      // Dropping a repeated conjunct never changes what an AND selects.
      let established = new Set<string>();
      let parts: CardExpression[] = [];
      if (typeConditionRef) {
        established.add(stringify(typeConditionRef));
        parts.push(this.typeCondition(typeConditionRef));
      }
      for (let child of filter.every) {
        let childKeys = Object.keys(child);
        let childOn = (child as { on?: CodeRef }).on;
        let childType = (child as { type?: CodeRef }).type;
        let pureRef =
          childKeys.length === 1 ? (childOn ?? childType) : undefined;
        if (pureRef) {
          let key = stringify(pureRef);
          if (established.has(key)) {
            continue;
          }
          established.add(key);
          parts.push(this.typeCondition(pureRef));
          continue;
        }
        if (childOn && established.has(stringify(childOn))) {
          let { on: _anchor, ...rest } = child as { on?: CodeRef } & Filter;
          parts.push(
            this.filterCondition(rest as Filter, childOn, polarity, context),
          );
          continue;
        }
        if (childOn) {
          established.add(stringify(childOn));
        }
        parts.push(this.filterCondition(child, on, polarity, context));
      }
      return every(parts);
    } else if ('any' in filter) {
      let folded = foldSameKeyEqs(filter.any);
      if (folded) {
        return every([
          ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
          this.filterCondition(folded, on, polarity, context),
        ]);
      }
      let union = this.#anyAsIndexedUnion(filter.any, context);
      if (union) {
        return every([
          ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
          union,
        ]);
      }
      return every([
        ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
        any([
          ...filter.any.map((i) =>
            this.filterCondition(i, on, polarity, { ...context, inAny: true }),
          ),
        ]),
      ]);
    } else {
      if (isCardTypeFilter(filter)) {
        return this.typeCondition(filter.type);
      }
      assertNever(filter);
    }
    throw new Error(`Unknown filter: ${stringify(filter)}`);
  }

  // the type condition only consumes absolute URL card refs.
  protected typeCondition(ref: CodeRef): CardExpression {
    // Deferred to pass 1 (`handleTypeCondition`): the membership keys need the
    // ref's definition, which resolves asynchronously.
    return [typeConditionNode(ref)];
  }

  // The card's primary `id` and a FileDef's `url` index in URL form, but a
  // query may now arrive with a canonical-RRI (prefix) value. For filter paths
  // whose leaf is `id`/`url`, a prefix-form value additionally matches its
  // equivalent spellings — real-URL, RRI-prefix, and any virtual-alias — via
  // the realm's VirtualNetwork, so a reference filter matches the URL-indexed
  // value without a reindex or DB migration. Unlike `types`, which is written
  // and read in one canonical form, `id`/`url` are still indexed in URL form,
  // so the expansion here is load-bearing.
  //
  // Only a *prefix-form* value (one that starts with a registered realm prefix)
  // is expanded. These leaf names also occur on ordinary user-data fields (a
  // contained `url` StringField, a FieldDef `id`) whose values are plain
  // strings or URLs and whose `in` filter is an exact string comparison —
  // those are matched exactly as given, gaining no extra normalized spellings,
  // so exact semantics are preserved for non-reference fields.
  private expandReferenceFilterValues(
    key: string,
    values: JSONTypes.Value[],
  ): JSONTypes.Value[] {
    if (!isReferenceFilterField(key)) {
      return values;
    }
    let expanded: JSONTypes.Value[] = [];
    let seen = new Set<string>();
    for (let value of values) {
      if (typeof value !== 'string') {
        expanded.push(value);
        continue;
      }
      // Match the value as given by default — this preserves exact `in`
      // semantics for URL-form refs and for ordinary (non-reference) `id`/`url`
      // user-data fields.
      let forms: string[] = [value];
      if (this.virtualNetwork.isRegisteredPrefix(value)) {
        try {
          // A prefix-form RRI: resolve to its real URL (the server's VN owns
          // the realm mappings), then enumerate equivalent spellings so it
          // matches the URL-form indexed reference.
          forms.push(
            ...this.virtualNetwork.equivalentURLForms(
              this.virtualNetwork.toURL(value).href,
            ),
          );
        } catch {
          // Unresolvable prefix — match the value as given.
        }
      }
      for (let form of forms) {
        if (!seen.has(form)) {
          seen.add(form);
          expanded.push(form);
        }
      }
    }
    return expanded;
  }

  private eqCondition(
    filter: EqFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.eq).map(([key, value]) => {
        return this.fieldEqFilter(key, value, on, polarity, context);
      }),
    ]);
  }

  private inCondition(
    filter: InFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.in).map(([key, values]) => {
        return this.fieldInFilter(
          key,
          values as JSONTypes.Value[],
          on,
          polarity,
          context,
        );
      }),
    ]);
  }

  private containsCondition(
    filter: ContainsFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    // A short title substring broader than the candidate cap (see
    // `capBroadMatches`) matches at most that many of the realm's cards.
    let short = shortTitleContains(filter);
    if (filter.candidateCap && short && this.dialect.titleTrigram) {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        [
          '(i.url, i.realm_url, i.type) IN (',
          ...shortTitleContainsSelect(
            short,
            context,
            filter.candidateCap,
            (filter as { candidateCapOn?: CodeRef }).candidateCapOn ?? typeRef,
            (filter as { candidateCapKind?: 'instance' | 'file' })
              .candidateCapKind,
          ),
          ')',
        ],
      ]);
    }
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.contains).map(([key, value]) => {
        // text to find: an object or a list is no text (and one with no
        // prototype cannot even be turned into some)
        if (value !== null && typeof value === 'object') {
          throw new InvalidQueryError(
            `contains on "${key}" takes text to find, not ${Array.isArray(value) ? 'a list' : 'an object'}`,
            'invalid-value',
          );
        }
        return this.fieldLikeFilter(key, value, on);
      }),
    ]);
  }

  private notCondition(
    filter: NotFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      [
        'NOT',
        ...addExplicitParens(
          this.filterCondition(filter.not, on, flipPolarity(polarity), context),
        ),
      ],
    ]);
  }

  private rangeCondition(
    filter: RangeFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.range).map(([key, filterValue]) => {
        return this.fieldRangeFilter(key, filterValue as RangeFilterValue, on);
      }),
    ]);
  }

  // Validates every near filter in the tree up front (field lookups are
  // async, the filter compiler is not), resolving each node's `on` the way
  // `filterCondition` does.
  protected async assertNearFilters(
    filter: Filter | undefined,
    onRef: CodeRef,
    realmURL?: URL,
    near?: NearContext,
  ) {
    if (!filter) {
      return;
    }
    let on =
      ('on' in filter ? filter.on : undefined) ??
      (filter as { type?: CodeRef }).type ??
      onRef;
    if (isNearFilter(filter)) {
      await this.vectors.assertNearFilter(filter, on, realmURL, near);
    } else if ('pattern' in filter || 'regex' in filter) {
      let operator = 'regex' in filter ? 'regex' : 'pattern';
      if (operator === 'regex') {
        this.dialect.requirePostgres(
          'a regex filter needs Postgres; this index has no regular expressions',
        );
      }
      let definition = await this.getDefinition(on);
      for (let path of Object.keys(
        (filter as unknown as Record<string, Record<string, string>>)[operator],
      )) {
        let field = await getField(definition, path, this.definitionLookup);
        let search = field.search === false ? undefined : field.search;
        if (!searchesByPattern(search)) {
          throw new InvalidQueryError(
            `a ${operator} filter on "${path}" needs a field searched by pattern: declare it \`search: { patterns: true }\`, or give it an identifier or code role`,
            'needs-declaration',
          );
        }
        // A file row's pattern text holds what the file indexer stamps (its
        // URL and name), so another field a file type declares for patterns
        // would never match through the prefilter: refused, not silent.
        if (
          definition.type === 'file-def' &&
          !FILE_PATTERN_FIELDS.includes(path)
        ) {
          throw new InvalidQueryError(
            `a ${operator} filter on a file reads only ${FILE_PATTERN_FIELDS.map((f) => `"${f}"`).join(' and ')}, not "${path}"; to find words in a file's text use \`matches\``,
            'needs-declaration',
          );
        }
        if (operator === 'regex') {
          await this.#assertRegex(
            path,
            (filter as RegexFilter).regex[path] as string,
          );
        } else {
          let glob = (filter as PatternFilter).pattern[path];
          if (
            this.dialect.isPostgres &&
            typeof glob === 'string' &&
            globNeedsSegments(glob)
          ) {
            await this.#assertGlob(path, glob);
          }
        }
      }
    } else if ('every' in filter) {
      for (let child of filter.every) {
        await this.assertNearFilters(child, on, realmURL, near);
      }
    } else if ('any' in filter) {
      for (let child of filter.any) {
        await this.assertNearFilters(child, on, realmURL, near);
      }
    } else if ('not' in filter) {
      await this.assertNearFilters(filter.not, on, realmURL, near);
    }
  }

  // A regular expression Postgres cannot compile is the caller's mistake: it
  // is refused with a code, never left to fail the search statement. The same
  // check covers the newline-sensitive form the prefilter runs.
  async #assertRegex(path: string, value: string) {
    try {
      // the prefilter's newline-sensitive form, which it runs only on an
      // expression that sets no embedded options of its own
      await this.dbAdapter.execute(`SELECT '' ~ $1 AS a, '' ~ $2 AS b`, {
        bind: [value, value.startsWith('(?') ? value : `(?n)${value}`],
      });
    } catch (e) {
      let message = String((e as Error)?.message ?? e);
      let reason = /invalid regular expression:?\s*(.*)/i.exec(message);
      if (!reason) throw e;
      let tooComplex = /too complex|too large|out of memory/i.test(reason[1]);
      throw new InvalidQueryError(
        `the regex on "${path}" is not a regular expression Postgres can run: ${reason[1] || 'invalid'}`,
        tooComplex ? 'limit-exceeded' : 'invalid-value',
      );
    }
  }

  // A glob with a single-segment wildcard runs as a regular expression
  // (`globToRegex`); one Postgres cannot compile (100,000 `?`, say) is
  // refused with a code before the search runs, as a regex is.
  async #assertGlob(path: string, glob: string) {
    try {
      await this.dbAdapter.execute(`SELECT '' ~* $1 AS a`, {
        bind: [globToRegex(glob)],
      });
    } catch (e) {
      let message = String((e as Error)?.message ?? e);
      let reason = /invalid regular expression:?\s*(.*)/i.exec(message);
      if (!reason) throw e;
      let tooComplex = /too complex|too large|out of memory/i.test(reason[1]);
      throw new InvalidQueryError(
        `the pattern on "${path}" is too complex to run: ${reason[1] || 'invalid'}`,
        tooComplex ? 'limit-exceeded' : 'invalid-value',
      );
    }
  }

  // A glob (`pattern`) or regular expression (`regex`) over a field's value.
  // On Postgres the row's `pattern_text` (every pattern field's value, one per
  // line, trigram-indexed) narrows to the rows that can match first; the
  // field itself decides. A glob matches the whole value, ignoring case, and
  // is path-aware: `*` and `?` stay within a `/` segment, `**` crosses them
  // (`globToRegex`). The field test is the glob's LIKE form, plus, for a glob
  // with a single-segment wildcard, its anchored regular expression; SQLite
  // has no regular expressions, so there every wildcard crosses `/`.
  #patternCondition(
    filter: PatternFilter | RegexFilter,
    on: CodeRef,
    typeConditionRef: CodeRef | undefined,
    context: FilterContext,
  ): CardExpression {
    let isRegex = 'regex' in filter;
    let entries = Object.entries(
      isRegex
        ? (filter as RegexFilter).regex
        : (filter as PatternFilter).pattern,
    );
    let prefilter =
      this.dialect.patternPrefilter &&
      context.indexTable === DEFAULT_FILTER_CONTEXT.indexTable;
    let conditions: CardExpression[] = [];
    for (let [key, value] of entries) {
      let operand = isRegex ? value : globToLike(value);
      if (prefilter) {
        if (!isRegex) {
          conditions.push(['i.pattern_text ILIKE', param(`%${operand}%`)]);
        } else if (!value.startsWith('(?')) {
          // Newline-sensitive, so `^` and `$` hold at each value's ends.
          conditions.push(['i.pattern_text ~', param(`(?n)${value}`)]);
        }
      }
      let segments =
        !isRegex && this.dialect.isPostgres && globNeedsSegments(value);
      conditions.push([
        fieldArity({
          type: on,
          path: key,
          value: [
            fieldQuery(key, on, false, 'filter'),
            isRegex ? '~' : 'ILIKE',
            fieldValue(key, [param(operand)], on, 'filter'),
            ...(segments
              ? [
                  'AND',
                  fieldQuery(key, on, false, 'filter'),
                  '~*',
                  fieldValue(key, [param(globToRegex(value))], on, 'filter'),
                ]
              : []),
          ],
          errorHint: 'filter',
        }),
      ]);
    }
    return every([
      ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
      ...conditions,
    ]);
  }

  // A near filter (see `VectorQuery#nearCondition`).
  private nearCondition(
    filter: NearFilter,
    typeConditionRef?: CodeRef,
    realmURL?: URL,
  ): CardExpression {
    return every([
      ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
      this.vectors.nearCondition(filter, realmURL),
    ]);
  }

  // An `any` whose every branch an index answers on its own — a full-text
  // `matches` (the markdown GIN index) or a `contains` on a row's title (the
  // title trigram indexes) — compiled as one membership test against the
  // UNION of each branch's matching keys. Written as an OR of per-row
  // conditions instead, Postgres can't combine indexes across the two tables
  // and scans every row of the realm, reading each row's whole search doc to
  // test its title; the union lets each index find its few rows first. This
  // is the search sheet's term filter (`matches` OR `_title` OR `cardTitle`).
  // A branch carrying a type anchor, or any other operator, keeps the general
  // compilation. Postgres only; SQLite has neither index.
  #anyAsIndexedUnion(
    branches: Filter[],
    context: FilterContext,
  ): CardExpression | undefined {
    if (!this.dialect.indexedUnion || branches.length < 2) {
      return undefined;
    }
    let selects: CardExpression[] = [];
    for (let branch of branches) {
      if ('on' in branch || 'type' in branch) {
        return undefined;
      }
      if (isMatchesFilter(branch)) {
        if (matchesHoldsNoWord(branch.matches)) {
          continue;
        }
        if (branch.scope) {
          return undefined;
        }
        if (branch.within) {
          selects.push([
            `SELECT pp.url, pp.realm_url, pp.type FROM boxel_index_passages AS pp WHERE pp.field_path =`,
            param(branch.within),
            `AND pp.tsv @@`,
            ...matchTsQuery(branch),
            ...realmBound('pp', context),
          ]);
          continue;
        }
        // As `matchesCondition`: each side reads only the realm searched, and
        // a term broader than the candidate cap takes at most that many
        // candidates from each side.
        let cap = branch.candidateCap;
        selects.push([
          ...(cap ? ['('] : []),
          `SELECT phm.url, phm.realm_url, phm.type FROM ${context.prerenderedTable} AS phm WHERE ${markdownVector('phm', context.prerenderedTable !== 'prerendered_html')} @@`,
          ...renderedTsQuery(branch),
          ...realmBound('phm', context),
          ...(cap ? [`LIMIT ${Number(cap)})`] : []),
        ]);
        selects.push([
          ...(cap ? ['('] : []),
          `SELECT tsi.url, tsi.realm_url, tsi.type FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)} @@`,
          ...matchTsQuery(branch),
          ...realmBound('tsi', context),
          ...(cap
            ? [
                `ORDER BY ts_rank_cd(COALESCE(${rankVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)}, ''::tsvector),`,
                ...matchTsQuery(branch),
                `, 32) DESC, tsi.url LIMIT ${Number(cap)})`,
              ]
            : []),
        ]);
        continue;
      }
      if (isTypeAheadFilter(branch)) {
        let query = branch.typoQuery
          ? [`to_tsquery('boxel_simple',`, param(branch.typoQuery), `)`]
          : typeAheadTsQuery(branch.typeahead);
        if (query) {
          selects.push([
            `SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ${TYPE_AHEAD_TSVECTOR('ti')} @@`,
            ...query,
            ...realmBound('ti', context),
          ]);
        }
        continue;
      }
      if (
        !('contains' in branch) ||
        Object.keys(branch).some(
          (k) =>
            k !== 'contains' &&
            k !== 'candidateCap' &&
            k !== 'candidateCapOn' &&
            k !== 'candidateCapKind',
        )
      ) {
        return undefined;
      }
      // A one- or two-character title substring: no trigram narrows it, so
      // it reads the realm's titles, and at most the candidate cap of them
      // when it is broader than that (see `capBroadMatches`).
      let short = shortTitleContains(branch);
      if (short) {
        selects.push([
          '(',
          ...shortTitleContainsSelect(
            short,
            context,
            branch.candidateCap,
            (branch as { candidateCapOn?: CodeRef }).candidateCapOn,
            (branch as { candidateCapKind?: 'instance' | 'file' })
              .candidateCapKind,
          ),
          ')',
        ]);
        continue;
      }
      let entries = Object.entries(branch.contains);
      if (entries.length !== 1) {
        return undefined;
      }
      let [key, value] = entries[0];
      // A trigram index needs three characters to narrow anything; a shorter
      // term matches most titles, and the general compilation serves it
      // better than a union of nearly every row.
      if (
        typeof value !== 'string' ||
        [...value].length < 3 ||
        !(TRIGRAM_INDEXED_TITLE_KEYS as readonly string[]).includes(key)
      ) {
        return undefined;
      }
      // The key is spliced in as a literal from the fixed list above: the
      // trigram index is on `search_doc ->> '<key>'`, and the planner matches
      // a predicate to an expression index only when the key is a constant.
      selects.push([
        `SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ti.search_doc ->> '${key}' ILIKE`,
        param(`%${escapeLikePattern(String(value))}%`),
        `ESCAPE '\\'`,
        ...realmBound('ti', context),
      ]);
    }
    if (selects.length === 0) {
      return ['FALSE'];
    }
    let union: CardExpression = [];
    selects.forEach((select, i) => {
      if (i > 0) {
        union.push('UNION');
      }
      union.push(...select);
    });
    return ['(i.url, i.realm_url, i.type) IN (', ...union, ')'];
  }

  // Whether a card of `type` (any subclass of it) in the realm holds a value
  // at `path` in its search doc: a name the type does not declare that one
  // of its subclasses does.
  protected async typeHoldsPath(
    realmURL: URL,
    type: CodeRef,
    path: string,
    opts: QueryOptions,
  ): Promise<boolean> {
    let [row] = await this.queryCards(
      [
        `SELECT 1 AS held FROM ${tableFromOpts(opts)} AS i WHERE`,
        ...realmIs('i.realm_url', realmURL),
        'AND (i.is_deleted = FALSE OR i.is_deleted IS NULL) AND',
        ...this.typeCondition(type),
        dbExpression({
          pg: [
            'AND i.search_doc #>',
            param(
              `{${removeBrackets(path)
                .split('.')
                .map(arrayElement)
                .join(',')}}`,
            ),
            '::text[] IS NOT NULL',
          ],
          sqlite: [
            'AND json_extract(i.search_doc,',
            param(`$.${removeBrackets(path)}`),
            ') IS NOT NULL',
          ],
        }),
        'LIMIT 1',
      ],
      opts.timings,
      opts,
    );
    return Boolean(row);
  }

  // `linkedFrom`: the ids `card` links to at `field`, read from its search
  // doc (a link is `{ id }` there, a list of them for linksToMany), matched
  // against each row's card id. The source must be a live card instance in
  // the realm being searched, so a search never reads another realm's links.
  #linkedFromCondition(
    filter: LinkedFromFilter,
    context: FilterContext,
  ): CardExpression {
    let card = filter.linkedFrom.card.replace(/\.json$/, '');
    // The card's id in either form: a registered prefix's form resolves
    // through the realm's network to the URL the index keys the card by.
    let forms = [card];
    try {
      let resolved = this.virtualNetwork.toURLHref(card);
      if (resolved !== card) forms.push(resolved);
    } catch {
      // not a form the network resolves: matched as written
    }
    let cardIs = (column: string): Expression => [
      `${column} IN (`,
      ...forms.flatMap((f, i) => (i > 0 ? [',', param(f)] : [param(f)])),
      ')',
    ];
    let path = filter.linkedFrom.field;
    return [
      dbExpression({
        pg: [
          `i.file_alias IN (SELECT lf.value ->> 'id' FROM ${context.indexTable} AS lfs CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(spill_unmark(lfs.search_doc #>`,
          param(`{${path.split('.').map(arrayElement).join(',')}}`),
          `::text[])) WHEN 'array' THEN spill_unmark(lfs.search_doc #>`,
          param(`{${path.split('.').map(arrayElement).join(',')}}`),
          `::text[]) WHEN 'object' THEN jsonb_build_array(spill_unmark(lfs.search_doc #>`,
          param(`{${path.split('.').map(arrayElement).join(',')}}`),
          `::text[])) ELSE '[]'::jsonb END) AS lf(value) WHERE`,
          ...cardIs('lfs.file_alias'),
          `AND lfs.type = 'instance' AND lfs.realm_url = i.realm_url AND (lfs.is_deleted IS NOT TRUE) AND lf.value ->> 'id' IS NOT NULL)`,
        ],
        sqlite: [
          `i.file_alias IN (SELECT json_extract(lf.value, '$.id') FROM ${context.indexTable} AS lfs, json_each(CASE json_type(lfs.search_doc,`,
          param(`$.${path}`),
          `) WHEN 'array' THEN json_extract(lfs.search_doc,`,
          param(`$.${path}`),
          `) WHEN 'object' THEN json_array(json_extract(lfs.search_doc,`,
          param(`$.${path}`),
          `)) ELSE '[]' END) AS lf WHERE`,
          ...cardIs('lfs.file_alias'),
          `AND lfs.type = 'instance' AND lfs.realm_url = i.realm_url AND (lfs.is_deleted IS NULL OR lfs.is_deleted = 0))`,
        ],
      }),
    ];
  }

  // `eq: null` (and `missing`): the card has no value at the path. On a
  // scalar path that is the leaf being null or absent. On a path through a
  // list it is no element holding a value, so an empty list, a null list, no
  // list at all and a list of nulls are all missing, and `exists` (its `not`)
  // is "some element has a value". The test is the negation of an existence
  // test, so it is plain true or false on either kind of path; on a scalar
  // path `NOT (x IS NOT NULL)` is `x IS NULL`.
  #noValue(key: string, onRef: CodeRef): CardExpression {
    let query = fieldQuery(key, onRef, true, 'filter');
    return [
      'NOT (',
      fieldArity({
        type: onRef,
        path: key,
        value: [query, 'IS NOT NULL'],
        // a list's element rows; a JSON null element is SQL NULL in SQLite's
        // json_tree and the JSON null in Postgres's jsonb_tree
        pluralValue: [
          query,
          dbExpression({ pg: "<> 'null'::jsonb", sqlite: 'IS NOT NULL' }),
        ],
        errorHint: 'filter',
      }),
      ')',
    ];
  }

  private fieldEqFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    if (
      currentField(key) === CARD_INSTANCE_FILE_KEY &&
      typeof value === 'boolean'
    ) {
      // Synthetic boolean search-doc key, stamped `true` only on the file row of
      // a dual-indexed card `.json` and omitted (never stamped `false`)
      // everywhere else. Because the key is present exactly when it is true,
      // membership is an existence test: `eq: false` ("not a card-instance
      // file", which must also match rows lacking the key) is `->> IS NULL`, and
      // `eq: true` is `->> IS NOT NULL`. This deliberately avoids comparing the
      // extracted value against a boolean literal: `->>` of a JSON boolean
      // renders as 'true'/'false' on Postgres but 1/0 on SQLite, so a
      // `= 'true'` comparison would silently diverge between adapters. `IS
      // [NOT] NULL` is adapter-agnostic and inverts cleanly when `notCondition`
      // wraps this in `NOT (...)`, so polarity needs no special handling here.
      let extracted = fieldQuery(key, onRef, false, 'filter');
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [extracted, value ? 'IS NOT NULL' : 'IS NULL'],
          errorHint: 'filter',
        }),
      ];
    }
    if (value === null) {
      return this.#noValue(key, onRef);
    }
    // An id written in the other of its two forms (a registered prefix's,
    // where the index holds the URL) matches as `in` matches it: by every
    // equivalent spelling. An id in the form the index holds keeps the
    // exact `@>` containment below, which the GIN index serves.
    if (
      typeof value === 'string' &&
      this.expandReferenceFilterValues(key, [value]).length > 1
    ) {
      return this.fieldInFilter(key, [value], onRef, polarity, context);
    }
    let query = fieldQuery(key, onRef, false, 'filter');
    let v = fieldValue(key, [param(value)], onRef, 'filter');
    // At positive polarity a singular-path string `eq` can be served by the GIN
    // `search_doc` index via a `@>` containment predicate. fieldArity routes on
    // cardinality only: the singular branch resolves the containment-capable
    // node (which itself falls back to `->>` extraction for numeric/non-string
    // leaves), while a plural path anywhere uses the json_tree machinery. At
    // negated polarity we keep plain extraction, whose NULL-on-absent-path
    // semantics `@>` cannot reproduce under `NOT`.
    if (polarity === 'positive') {
      let pathMatch = this.#pluralPathMatch(key, [value], context);
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [jsonContainsQuery(key, onRef, [param(value)])],
          pluralValue: pathMatch ?? [query, '=', v],
          pluralSelfContained: pathMatch !== undefined,
          errorHint: 'filter',
        }),
      ];
    }
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, '=', v],
        errorHint: 'filter',
      }),
    ];
  }

  // A positive match on a path that runs through a list (`concepts.id`
  // inside a linksToMany, `segments.speaker`), served by the search_doc GIN
  // index as a SQL/JSON path test: `$."concepts"."id" ? (@ == "a" || …)`,
  // whose lax mode reads every list on the way. The json_tree form it
  // replaces walks every row of the type (over a minute on 40k cards). A row
  // whose list was spilled out of its doc is matched on the
  // restored list instead. Strings only, where the path test and the tree's
  // text comparison agree; anything else keeps the tree. Postgres only.
  #pluralPathMatch(
    key: string,
    values: JSONTypes.Value[],
    // The match tests the outer row, so it reads whichever table the
    // context's query does. The context's realm lets pass 1 drop the spilled
    // arm when the realm has no spilled list under this root.
    context: FilterContext,
  ): CardExpression | undefined {
    if (!this.dialect.jsonbContainment || values.length === 0) {
      return undefined;
    }
    if (!values.every((v) => typeof v === 'string')) {
      return undefined;
    }
    let segments = key.split('.');
    if (segments.some((x) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))) {
      return undefined;
    }
    let path = '$' + segments.map((x) => `."${x}"`).join('');
    let test = `${path} ? (${values.map((v) => `@ == ${JSON.stringify(v)}`).join(' || ')})`;
    let root = segments[0];
    // Both arms test the candidate row itself, so the planner either drives
    // the match from the GIN index (a BitmapOr of the two path tests) or
    // checks each candidate another condition already narrowed. The marker
    // test names the marker's kinds: a path with no comparison in it can't
    // be served by the index, and as a bare existence test it read every
    // row of the realm, once per outer candidate.
    let spilled = `$."${root}"."${SPILL_MARKER_KEY}" ? (${SPILL_KINDS.map((k) => `@ == ${JSON.stringify(k)}`).join(' || ')})`;
    // The list is restored whole when it spilled whole, and element by
    // element when only its long elements spilled (each is a marker in
    // place), so a long value in a list is found as a short one is.
    let restored: CardExpression = [
      "(SELECT CASE WHEN jsonb_typeof(sl.v) = 'array' THEN (SELECT COALESCE(jsonb_agg(spill_unmark(se.e) ORDER BY se.o), '[]'::jsonb) FROM jsonb_array_elements(sl.v) WITH ORDINALITY AS se(e, o)) ELSE sl.v END FROM (SELECT spill_unmark(i.search_doc -> CAST(",
      param(root),
      'AS text)) AS v) AS sl)',
    ];
    let spilledArm: CardExpression = [
      '(i.search_doc @? CAST(',
      param(spilled),
      // jsonb_build_object takes `any`, so a bare parameter has no type.
      'AS jsonpath) AND jsonb_path_exists(jsonb_build_object(CAST(',
      param(root),
      'AS text),',
      ...restored,
      '), CAST(',
      param(test),
      'AS jsonpath)))',
    ];
    return [
      '(i.search_doc @? CAST(',
      param(test),
      'AS jsonpath) OR',
      // A union reads the spilled arm as it is: the probe that drops it is
      // one realm's.
      ...(context.realmURL && !isRealmUnion(context.realmURL)
        ? [spillArmNode(context.realmURL.href, root, spilledArm)]
        : spilledArm),
      ')',
    ];
  }

  private fieldInFilter(
    key: string,
    values: JSONTypes.Value[],
    onRef: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    if (values.length === 0) {
      // Empty set matches nothing
      return ['false'];
    }
    let nonNullValues = this.expandReferenceFilterValues(
      key,
      values.filter((v) => v !== null),
    );
    let hasNull = values.some((v) => v === null);

    let conditions: CardExpression[] = [];

    if (nonNullValues.length > 0 && polarity === 'positive') {
      // Like a positive `eq`, a positive `in` on a singular path is served by
      // the GIN `search_doc` index: one `@>` containment per value, OR'd, so
      // Postgres plans a BitmapOr of index scans. The `->> IN (...)` form
      // below extracts per row, which no index covers, so it scans every row
      // of the type. A plural path keeps the json_tree machinery. At negated
      // polarity we keep extraction, whose NULL-on-absent-path semantics
      // `@>` cannot reproduce under `NOT` (see `fieldEqFilter`).
      let query = fieldQuery(key, onRef, false, 'filter');
      let inList: CardExpression = [];
      let containments: CardExpression = [];
      nonNullValues.forEach((v, i) => {
        if (i > 0) {
          inList.push(',');
          containments.push('OR');
        }
        inList.push(fieldValue(key, [param(v)], onRef, 'filter'));
        containments.push(jsonContainsQuery(key, onRef, [param(v)]));
      });
      // On Postgres the values are one test, `@> ANY` or `= ANY` (see
      // `#jsonContainsAny`), which reads each row's search doc once: as an
      // OR of one test a value, a row whose search doc is stored out of line
      // was read once a value (10,000 values over 2,000 such rows: 25 s).
      let anyOfValues: CardExpression =
        nonNullValues.length > 1
          ? [
              {
                ...jsonContainsQuery(key, onRef, [param(nonNullValues[0])]),
                anyOf: nonNullValues.map((v) => [param(v)]),
              },
            ]
          : containments;
      // Postgres misestimates an OR of containments ANDed with a separate
      // type-membership clause, and rechecks every typed row once per value
      // (~0.5 s a value on 6k cards). An uncorrelated IN becomes a hashed
      // SubPlan: the GIN index answers the OR once, and each outer row is a
      // hash probe, whatever else the filter ANDs in. The unqualified
      // `search_doc` in each containment binds to the subquery's own row.
      // Keyed on the index's primary key, so it selects exactly the rows the
      // inline form would.
      // Text values a containment serves are one path test of the row
      // instead, when they allow (`#containedJsonPath`): it reads the search
      // doc once per row, so neither the GIN recheck nor a scan multiplies
      // by the values, and it needs no subquery.
      let matched: CardExpression = context.perRow
        ? ['(', query, 'IN', '(', ...inList, ')', ')']
        : this.dialect.jsonbContainment
          ? [
              {
                ...jsonContainsQuery(key, onRef, [param(nonNullValues[0])]),
                anyOf: nonNullValues.map((v) => [param(v)]),
                orElse: [
                  `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE (`,
                  ...anyOfValues,
                  ')',
                  // the outer IN compares the realm too, so bounding the
                  // subquery to it changes no row; it stops a value no index
                  // answers (a number's cast) being tested on every realm's rows
                  ...realmBound('ti', context),
                  ')',
                ],
              },
            ]
          : ['(', ...containments, ')'];
      let inPathMatch = this.#pluralPathMatch(key, nonNullValues, context);
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: matched,
          pluralValue: inPathMatch ?? [query, 'IN', '(', ...inList, ')'],
          pluralSelfContained: inPathMatch !== undefined,
          errorHint: 'filter',
        }),
      ]);
    } else if (nonNullValues.length > 0) {
      let query = fieldQuery(key, onRef, false, 'filter');
      let inList: CardExpression = [];
      nonNullValues.forEach((v, i) => {
        if (i > 0) {
          inList.push(',');
        }
        inList.push(fieldValue(key, [param(v)], onRef, 'filter'));
      });
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IN', '(', ...inList, ')'],
          errorHint: 'filter',
        }),
      ]);
    }

    if (hasNull) {
      conditions.push(this.#noValue(key, onRef));
    }

    if (conditions.length === 1) {
      return conditions[0];
    }
    return any(conditions);
  }

  private fieldLikeFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
  ): CardExpression {
    if (value === null) {
      return this.#noValue(key, onRef);
    }
    let query = fieldQuery(key, onRef, false, 'filter');
    // The value is text to find, not a pattern: `%`, `_` and the escape
    // character itself are matched as written.
    let v = fieldValue(
      key,
      [param(`%${escapeLikePattern(String(value))}%`)],
      onRef,
      'filter',
    );
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, 'ILIKE', v, `ESCAPE '\\'`],
        errorHint: 'filter',
      }),
    ];
  }

  private fieldRangeFilter(
    key: string,
    filterValue: RangeFilterValue,
    onRef: CodeRef,
  ): CardExpression {
    let query = fieldQuery(key, onRef, false, 'filter');
    let bounds: CardExpression[] = [];
    Object.entries(filterValue).forEach(([operator, value]) => {
      if (value == null) {
        throw new Error(`'null' is not a permitted value in a 'range' filter`);
      }
      let v = fieldValue(key, [param(value)], onRef, 'filter');
      bounds.push([query, RANGE_OPERATORS[operator as RangeOperator], v]);
    });
    // One test of the field with every bound in it: on a list, the bounds
    // are met by one element together, never by one element each.
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: every(bounds),
        errorHint: 'filter',
      }),
    ];
  }
}
