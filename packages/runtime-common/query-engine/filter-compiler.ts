// Pass 1 of compilation: a card filter tree compiled to a `CardExpression`
// through the shared compiler (filter-operators.ts), with cards as its
// source: field tests resolved in pass 2, and the nodes only cards have
// (`near`, `linkedFrom`, `pattern`, `regex`, the type anchor). Text filters
// (`matches`, type-ahead) compile in text-search.ts.
// Owns: the card source, the filter checks that read definitions (near
// targets, regex), the indexed UNION form of an `any`, and the
// list-element and plural-path forms.
// Must not: resolve a field to its column (expression-resolver.ts), or
// order or page.
// Guarantees: docs/search.md ("Filters", "Edge cases and what is
// guaranteed"); the client-side mirror is instance-filter-matcher.ts.

import { refuse } from '../query-v2/query-refusals.ts';
import { CARD_INSTANCE_FILE_KEY } from '../search-doc-keys.ts';
import {
  type CardExpression,
  type Expression,
  addExplicitParens,
  any,
  currentFilterNow,
  every,
  type FieldTest,
  fieldTest,
  param,
  separatedByCommas,
  typeCondition as typeConditionNode,
  withFilterNow,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import {
  type ContainsFilter,
  type Filter,
  type LinkedFromFilter,
  type MatchesFilter,
  type NearFilter,
  type PatternFilter,
  type RegexFilter,
  type TypeAheadFilter,
  filterOperators,
  isCardTypeFilter,
  isMatchesFilter,
  isNearFilter,
  isReferenceFilterField,
  isTypeAheadFilter,
  matchesHoldsNoWord,
} from '../query-v2/query.ts';
import {
  DEFAULT_FILTER_CONTEXT,
  type FilterContext,
  type FilterPolarity,
  type QueryOptions,
  assertNever,
} from './types.ts';
import {
  type FilterSource,
  compileFilterTree,
  foldEveryEqs,
} from './filter-operators.ts';
import { ExpressionResolver } from './expression-resolver.ts';
import type * as JSONTypes from 'json-typescript';
import type { NearContext } from '../vector-query.ts';
import {
  TRIGRAM_INDEXED_TITLE_KEYS,
  escapeLikePattern,
  foldSameKeyEqs,
  withoutRepeatedMembers,
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
import { currentField, getField, removeBrackets } from './filter-paths.ts';
import { isRealmAdmissionFilter, realmIs } from '../realm-union.ts';
import {
  cardIdentityURLs,
  isCardIdentityFilter,
} from '../card-identity-filter.ts';
import {
  markdownVector,
  rankVector,
  realmBound,
  searchTextVector,
  tableFromOpts,
} from './index-sql.ts';
import { FILE_PATTERN_FIELDS, searchesByPattern } from '../search-intent.ts';
import stringify from 'safe-stable-stringify';

// What a card filter's fields resolve in: the type a node is anchored on,
// and the filter context.
interface CardScope {
  on: CodeRef;
  context: FilterContext;
}

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
    return compileFilterTree(
      withoutRepeatedMembers(filter),
      this.#source,
      { on: onRef, context },
      polarity,
    );
  }

  // Cards as a filter source: a field reads and tests through its
  // definition (expression-resolver.ts), and a node's `on` or `type` anchors
  // its fields and adds that type's test.
  #source: FilterSource<CardScope> = {
    node: (filter, scope, polarity) =>
      this.#cardNode(filter as Filter, scope.on, polarity, scope.context),
    anchor: (filter, { on, context }) => {
      let typeRef = (filter as { type?: CodeRef }).type;
      let onProp = 'on' in filter ? (filter as { on?: CodeRef }).on : undefined;
      let typeConditionRef = onProp ?? typeRef;
      return {
        scope: { on: onProp ?? typeRef ?? on, context },
        conjuncts: typeConditionRef
          ? [this.typeCondition(typeConditionRef)]
          : [],
      };
    },
    inAny: ({ on, context }) => ({ on, context: { ...context, inAny: true } }),
    eq: ({ on, context }, path, value, polarity) =>
      this.fieldEqFilter(path, value, on, polarity, context),
    in: ({ on, context }, path, values, polarity) =>
      this.fieldInFilter(path, values, on, polarity, context),
    eqAll: ({ on }, path, values, polarity) =>
      currentField(path) === CARD_INSTANCE_FILE_KEY ||
      values.some((v) => this.expandReferenceFilterValues(path, [v]).length > 1)
        ? undefined
        : this.#test(on, path, 'eq', { values, polarity }),
    like: ({ on }, path, pattern) =>
      this.#test(on, path, 'like', { values: [pattern] }),
    range: ({ on, context }, path, bounds, polarity) =>
      this.#test(on, path, 'range', {
        range: bounds,
        ...(polarity ? { polarity } : {}),
        ...(context.valueStoreRealm && !context.perRow
          ? { valueStoreRealm: context.valueStoreRealm }
          : {}),
      }),
    missing: ({ on }, path) => this.#test(on, path, 'missing'),
    refuse: (filter) => new Error(`Unknown filter: ${stringify(filter)}`),
  };

  // The nodes only cards have, and the card rewrites of `every` and `any`;
  // undefined for the shared operators (filter-operators.ts).
  #cardNode(
    filter: Filter,
    onRef: CodeRef,
    polarity: FilterPolarity,
    context: FilterContext,
  ): CardExpression | undefined {
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
      throw refuse('filter-may-use-only-2', undefined, {
        value0: operators.map((key) => `"${key}"`).join(', '),
      });
    }

    if ('eq' in filter || 'in' in filter || 'not' in filter) {
      return undefined;
    } else if ('contains' in filter) {
      return this.#shortTitleContains(filter, typeConditionRef, context);
    } else if ('range' in filter) {
      return undefined;
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
    } else if (isCardIdentityFilter(filter)) {
      // Named cards by the row's own `url` (card-identity-filter.ts).
      let urls = cardIdentityURLs(filter.cardIdentity.ids);
      return any([
        ...(urls.length
          ? [
              [
                'i.url IN',
                ...addExplicitParens(
                  separatedByCommas(urls.map((url) => [param(url)])),
                ),
              ] as CardExpression,
            ]
          : []),
        ['i.search_doc IS NULL'] as CardExpression,
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
            // the grants were composed in the request's grammar, which the
            // engine's reads member for member
            this.filterCondition(
              { any: grants as unknown as Filter[] },
              onRef,
              polarity,
              context,
            ),
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
      return this.#anchoredEvery(
        filter.every,
        on,
        typeConditionRef,
        polarity,
        context,
      );
    } else if ('any' in filter) {
      let folded = foldSameKeyEqs(filter.any);
      if (folded) {
        return every([
          ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
          this.filterCondition(folded, on, polarity, context),
        ]);
      }
      // Membership in the union is true or false, where the general form's
      // branch can be unknown (a missing title, no text): under a `not` the
      // two answer differently, so the union serves positive polarity only.
      let union =
        polarity === 'positive'
          ? this.#anyAsIndexedUnion(filter.any, context)
          : undefined;
      if (union) {
        return every([
          ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
          union,
        ]);
      }
      return undefined;
    } else {
      if (isCardTypeFilter(filter)) {
        return this.typeCondition(filter.type);
      }
      assertNever(filter);
    }
    throw new Error(`Unknown filter: ${stringify(filter)}`);
  }

  // An `every` that names types: each type's membership test is stated once
  // per conjunction. A sibling anchored on a type the AND already tests keeps
  // that type for resolving its fields, but emits no second test: Postgres
  // multiplies the two tests' selectivities, expects almost no rows, and then
  // re-runs an indexed `in`/`matches` subquery per row instead of hashing it
  // (a 20-value `in` beside a bare `{ on }` took 12 s against 70 ms alone).
  // Dropping a repeated conjunct never changes what an AND selects. An
  // `every` naming no type is the shared one (undefined).
  #anchoredEvery(
    children: Filter[],
    on: CodeRef,
    typeConditionRef: CodeRef | undefined,
    polarity: FilterPolarity,
    context: FilterContext,
  ): CardExpression | undefined {
    let anchorOf = (child: Filter) => {
      let childOn = (child as { on?: CodeRef }).on;
      let childType = (child as { type?: CodeRef }).type;
      let pureRef =
        Object.keys(child).length === 1 ? (childOn ?? childType) : undefined;
      return { childOn, pureRef };
    };
    if (
      !typeConditionRef &&
      children.every((child) => {
        let { childOn, pureRef } = anchorOf(child);
        return !pureRef && !childOn;
      })
    ) {
      return undefined;
    }
    let established = new Set<string>();
    let parts: CardExpression[] = [];
    if (typeConditionRef) {
      established.add(stringify(typeConditionRef));
      parts.push(this.typeCondition(typeConditionRef));
    }
    parts.push(
      ...foldEveryEqs(
        children,
        polarity,
        (path, values) =>
          this.#source.eqAll!({ on, context }, path, values, polarity),
        (child) => {
          let { childOn, pureRef } = anchorOf(child as Filter);
          if (pureRef) {
            let key = stringify(pureRef);
            if (established.has(key)) {
              return undefined;
            }
            established.add(key);
            return this.typeCondition(pureRef);
          }
          if (childOn && established.has(stringify(childOn))) {
            let { on: _anchor, ...rest } = child as { on?: CodeRef } & Filter;
            return this.filterCondition(
              rest as Filter,
              childOn,
              polarity,
              context,
            );
          }
          if (childOn) {
            established.add(stringify(childOn));
          }
          return this.filterCondition(child as Filter, on, polarity, context);
        },
      ),
    );
    return every(parts);
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

  // A short title search reads the trigram index through a capped
  // candidate set; any other `contains` is the shared one (undefined).
  #shortTitleContains(
    filter: ContainsFilter,
    typeRef: CodeRef | undefined,
    context: FilterContext,
  ): CardExpression | undefined {
    let short = shortTitleContains(filter);
    if (!(filter.candidateCap && short && this.dialect.titleTrigram)) {
      return undefined;
    }
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
          throw refuse('filter-needs-field-searched', undefined, {
            operator,
            path,
          });
        }
        // A file row's pattern text holds what the file indexer stamps (its
        // URL and name), so another field a file type declares for patterns
        // would never match through the prefilter: refused, not silent.
        if (
          definition.type === 'file-def' &&
          !FILE_PATTERN_FIELDS.includes(path)
        ) {
          throw refuse('filter-file-reads-only', undefined, {
            operator,
            value1: FILE_PATTERN_FIELDS.map((f) => `"${f}"`).join(' and '),
            path,
          });
        }
        if (operator === 'regex') {
          await this.#assertRegex(
            path,
            (filter as RegexFilter).regex[path] as string,
          );
        } else {
          let glob = (filter as PatternFilter).pattern[path];
          if (
            this.dialect.globSegments &&
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
      throw refuse(
        tooComplex
          ? 'regex-regular-expression-postgres'
          : 'regex-regular-expression-postgres-2',
        undefined,
        { path, value1: reason[1] || 'invalid' },
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
      throw refuse(
        tooComplex ? 'pattern-too-complex-run' : 'pattern-too-complex-run-2',
        undefined,
        { path, value1: reason[1] || 'invalid' },
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
        !isRegex && this.dialect.globSegments && globNeedsSegments(value);
      conditions.push(
        this.#test(on, key, 'pattern', {
          sqlOp: isRegex ? '~' : 'ILIKE',
          values: [operand, ...(segments ? [globToRegex(value)] : [])],
        }),
      );
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
        // As `matchesCondition`: each side reads only the realm searched,
        // and a term broader than the candidate cap takes at most that many
        // of its field matches, best first; every card whose rendered page
        // holds it is read.
        let cap = branch.candidateCap;
        selects.push([
          `SELECT phm.url, phm.realm_url, phm.type FROM ${context.prerenderedTable} AS phm WHERE ${markdownVector('phm', context.prerenderedTable !== 'prerendered_html')} @@`,
          ...renderedTsQuery(branch),
          ...realmBound('phm', context),
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
        ...this.dialect.pathExists(removeBrackets(path)),
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
    return this.dialect.linkedFromIds(
      context.indexTable,
      filter.linkedFrom.field,
      cardIs('lfs.file_alias'),
    );
  }

  #test(
    on: CodeRef,
    path: string,
    op: FieldTest['op'],
    rest: Partial<FieldTest> = {},
  ): CardExpression {
    return [fieldTest({ type: on, path, op, ...rest })];
  }

  // `eq` on a present value (the shared layer reads null as missing).
  private fieldEqFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
    polarity: FilterPolarity,
    context: FilterContext,
  ): CardExpression {
    if (
      currentField(key) === CARD_INSTANCE_FILE_KEY &&
      typeof value === 'boolean'
    ) {
      return this.#test(onRef, key, 'file', { values: [value] });
    }
    // A card reference matches under each form of its URL.
    if (
      typeof value === 'string' &&
      this.expandReferenceFilterValues(key, [value]).length > 1
    ) {
      return this.fieldInFilter(key, [value], onRef, polarity, context);
    }
    return this.#test(onRef, key, 'eq', {
      values: [value],
      polarity,
    });
  }

  // `in` over present values (the shared layer adds the missing test for a
  // null among them).
  private fieldInFilter(
    key: string,
    values: JSONTypes.Value[],
    onRef: CodeRef,
    polarity: FilterPolarity,
    context: FilterContext,
  ): CardExpression {
    return this.#test(onRef, key, 'in', {
      values: this.expandReferenceFilterValues(key, values),
      polarity,
      perRow: context.perRow,
      indexTable: context.indexTable,
      realmBound: realmBound('ti', context),
    });
  }
}
