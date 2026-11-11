// Pass 2 of compilation: a `CardExpression` (pass 1's output, with field
// queries, field values, arity and json-containment nodes still symbolic)
// resolved against the type's definitions into SQL `Expression`s, and run.
// Owns: `makeExpression`, walking a field path to its column and jsonb path
// (`walkFilterFieldPath`), spilled values, type conditions, and the jsonb
// containment and jsonpath forms of `eq` and `in`.
// Must not: decide what a filter means (filter-compiler.ts), or rank.
// Guarantees: the pipeline is in `.claude/skills/index-query-engine/SKILL.md`;
// missing values and list semantics in docs/search.md ("Edge cases and what
// is guaranteed").

import {
  CONTAINMENT_ANY_MAX,
  JSONPATH_ANY_MAX,
  existsInList,
} from './filter-sql.ts';
import {
  type CardExpression,
  type Expression,
  type FieldArity,
  type FieldQuery,
  type FieldValue,
  type JsonContainsQuery,
  type SpillArm,
  type TypeCondition,
  any,
  dbExpression,
  every,
  fieldQuery,
  fieldValue,
  isDbExpression,
  isParam,
  param,
  separatedByCommas,
  tableValuedTree,
  typesContains,
} from '../expression.ts';
import { type CodeRef, getSerializer } from '../index.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';
import {
  type FilterFieldHandler,
  type FilterFieldHandlerWithEntryAndExit,
  type ReadContext,
  assertNever,
} from './types.ts';
import {
  FilterRefersToNonsearchableFieldError,
  NEVER_SPILLED_SERIALIZERS,
  convertBracketsToWildCards,
  currentField,
  getField,
  isFieldPlural,
  removeBrackets,
  seedSearchableRoutesFromDefinition,
  traveledThruPlural,
  trimPathAtFirstPluralField,
  trimTrailingBrackets,
} from './filter-paths.ts';
import { IndexRows } from './index-rows.ts';
import {
  InvalidQueryError,
  assertRelativeDateWellFormed,
  relativeDateForField,
} from '../query.ts';
import type * as JSONTypes from 'json-typescript';
import type { RequestTimings } from '../request-timings.ts';
import { SEARCH_DOC_INLINE_STRING_MAX } from '../search-doc-spill.ts';
import { flatten } from 'lodash-es';
import { jsonPathOfKeys } from '../sql-literal.ts';
import { matchSearchableRoutes } from '../searchable-routes.ts';
import stringify from 'safe-stable-stringify';

// A filter value resolved in the containment route, which runs after
// `withFilterNow` has returned: it carries the clock its node captured, so a
// relative date reads the query's clock, not the wall clock.
function filterFieldValue(
  path: string,
  value: CardExpression,
  type: CodeRef,
  now: Date | undefined,
): FieldValue {
  return {
    ...fieldValue(path, value, type, 'filter'),
    ...(now ? { now } : {}),
  };
}

export abstract class ExpressionResolver extends IndexRows {
  // Split the two phases so the search-timing line can attribute the SQL
  // stage. `makeExpression` resolves the filter tree to SQL — that resolution
  // runs a `getDefinition` card-definition lookup per type/field (a cache
  // read, or a module prerender on a miss), so it can dominate a search whose
  // actual row fetch is tiny. `#query` is the DB round-trip itself. The data
  // and count queries run concurrently, so these accumulate into the
  // parallel-sum `busy` bucket rather than the wall-clock stages.
  protected async queryCards(
    query: CardExpression,
    timings?: RequestTimings,
    ctx?: ReadContext,
  ) {
    let expression = timings
      ? await timings.busyTime('compile', () => this.makeExpression(query, ctx))
      : await this.makeExpression(query, ctx);
    return timings
      ? await timings.busyTime('sqlExec', () => this.query(expression, ctx))
      : this.query(expression, ctx);
  }

  // A realm with no spilled list under the root can't match through the
  // spilled arm, so the arm is FALSE and the GIN-served arm answers alone.
  // One indexed probe per search (`boxel_index_spill_field_idx`).
  private async handleSpillArm(
    arm: SpillArm,
    ctx?: ReadContext,
  ): Promise<Expression> {
    let rows = (await this.query(
      [
        'SELECT 1 FROM boxel_index_spill WHERE realm_url =',
        param(arm.realmURL),
        'AND field_path =',
        param(arm.root),
        'LIMIT 1',
      ] as Expression,
      ctx,
    )) as unknown[];
    return rows.length > 0
      ? await this.makeExpression(arm.expression, ctx)
      : ['FALSE'];
  }

  private async handleTypeCondition(
    condition: TypeCondition,
  ): Promise<Expression> {
    // Each key is a self-contained `types-contains` membership predicate rather
    // than a comparison against a shared `jsonb_array_elements_text(types)`
    // cross-join alias. The cross join gave every type condition in a query
    // exists-one-element semantics (all type conditions dedupe onto one alias),
    // which miscompose: `not: { type: X }` failed to exclude X, and
    // `every: [{ type: A }, { type: B }]` was unsatisfiable. Per-row membership
    // makes negation a true exclusion and conjunction a true intersection.
    let keys = await this.typeKeysFor(condition.ref);
    return any(
      keys.map((typeKey) => [typesContains(typeKey, condition.column)]),
    ) as Expression;
  }

  protected async makeExpression(
    query: CardExpression,
    ctx?: ReadContext,
  ): Promise<Expression> {
    return flatten(
      await Promise.all(
        query.map((element) => {
          if (
            isParam(element) ||
            isDbExpression(element) ||
            typeof element === 'string' ||
            element.kind === 'table-valued-tree' ||
            element.kind === 'json-contains' ||
            element.kind === 'types-contains' ||
            element.kind === 'sort-direction'
          ) {
            return Promise.resolve([element]);
          } else if (element.kind === 'field-query') {
            return this.handleFieldQuery(element);
          } else if (element.kind === 'field-value') {
            return this.handleFieldValue(element, ctx);
          } else if (element.kind === 'field-arity') {
            return this.handleFieldArity(element, ctx);
          } else if (element.kind === 'json-contains-query') {
            return this.handleJsonContainsQuery(element);
          } else if (element.kind === 'type-condition') {
            return this.handleTypeCondition(element);
          } else if (element.kind === 'spill-arm') {
            return this.handleSpillArm(element, ctx);
          } else {
            throw assertNever(element);
          }
        }),
      ),
    );
  }

  // The goal of this handler is to ensure that the use of table valued
  // json_tree() function that we use for querying thru fields that are plural
  // is confined to the specific JSON path that our query should run. This means
  // that we need to determine the root path for the json_tree() function, as
  // well as the "query path" for the json_tree() function. The query path
  // predicate is AND'ed to the expression contained in the FieldArity
  // expression. Queries that do not go thru a plural field can use the normal
  // '->' and '->>' JSON operators.
  // The result is a query that looks like this:
  //
  //   SELECT url, pristine_doc
  //   FROM
  //     boxel_index,
  //     -- This json_tree was derived by this handler:
  //   CROSS JOIN LATERAL jsonb_tree(search_doc, '$.friends') as friends1_tree
  //   WHERE
  //     ( ( is_deleted = FALSE OR is_deleted IS NULL ) )
  //     AND (
  //       ( COALESCE(types, '[]'::jsonb) @> $1::jsonb )
  //       AND (
  //         ( friends1_tree.text_value = $2 )
  //         AND
  //         -- This predicate was derived by this handler:
  //         ( friends1_tree.fullkey LIKE '$.friends[%].bestFriend.name' )
  //       )
  //     )
  //   GROUP BY url
  //   ORDER BY url

  private async handleFieldArity(
    fieldArity: FieldArity,
    ctx?: ReadContext,
  ): Promise<Expression> {
    let {
      path,
      value,
      type,
      pluralValue,
      pluralSelfContained,
      usePluralContainer,
    } = fieldArity;
    let definition = await this.getDefinition(type);
    let exp: CardExpression = await this.walkFilterFieldPath(
      definition,
      path,
      value,
      // Leaf field handler
      async (_definition, expression, pathTraveled) => {
        if (traveledThruPlural(pathTraveled)) {
          // A JSON path match tests the card on its own; joining the list's
          // jsonb_tree would only make Postgres expand every row's list.
          if (pluralSelfContained && pluralValue) {
            return pluralValue;
          }
          return [
            ...every([
              pluralValue ?? expression,
              [
                tableValuedTree(
                  'search_doc',
                  trimPathAtFirstPluralField(pathTraveled),
                  path,
                  'fullkey',
                ),
                `LIKE '$.${
                  usePluralContainer
                    ? convertBracketsToWildCards(
                        trimTrailingBrackets(pathTraveled),
                      )
                    : convertBracketsToWildCards(pathTraveled)
                }'`,
              ],
            ]),
          ];
        }
        return expression;
      },
      undefined,
      // This is a filter path: walk it with the card's `searchable` routes so
      // a hop into a non-searchable relationship is rejected as we cross it.
      seedSearchableRoutesFromDefinition(definition),
    );
    return existsInList(await this.makeExpression(exp, ctx));
  }

  private async handleFieldQuery(fieldQuery: FieldQuery): Promise<Expression> {
    let { path, type, useJsonBValue, errorHint } = fieldQuery;
    let definition = await this.getDefinition(type);
    // The rootPluralPath should line up with the tableValuedTree that was
    // used in the handleFieldArity (the multiple tableValuedTree expressions will
    // collapse into a single function)
    let rootPluralPath: string | undefined;
    let isNumericField = false;
    // Whether the leaf can hold a spilled value: read through
    // `spill_text`, which resolves a marker and is `->>` otherwise. Numbers,
    // booleans and dates never spill, so they keep the raw extraction their
    // casts and indexes expect.
    let readsSpill = false;

    let exp = await this.walkFilterFieldPath(
      definition,
      path,
      [],
      // Leaf field handler
      async (definition, expression, pathTraveled) => {
        let field = await getField(
          definition,
          pathTraveled,
          this.definitionLookup,
        );
        isNumericField =
          field.serializerName === 'number' ||
          field.serializerName === 'big-integer';
        if (isFieldPlural(field)) {
          rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
          return [
            tableValuedTree(
              'search_doc',
              rootPluralPath,
              path,
              useJsonBValue ? 'jsonb_value' : 'text_value',
            ),
          ];
        } else if (!rootPluralPath) {
          let fieldName = currentField(pathTraveled);
          readsSpill =
            this.dialect.searchDocSpill &&
            !NEVER_SPILLED_SERIALIZERS.has(field.serializerName ?? '');
          return [...expression, readsSpill ? '->' : '->>', param(fieldName)];
        }
        return expression;
      },
      // interior field handler
      {
        enter: async (definition, expression, pathTraveled) => {
          // we work forwards determining if any interior fields are plural
          // since that requires a different style predicate
          let field = await getField(
            definition,
            pathTraveled,
            this.definitionLookup,
          );
          if (isFieldPlural(field)) {
            rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
            return [
              tableValuedTree(
                'search_doc',
                rootPluralPath,
                path,
                useJsonBValue ? 'jsonb_value' : 'text_value',
              ),
            ];
          }
          return expression;
        },
        exit: async (definition, expression, pathTraveled) => {
          // we populate the singular fields backwards as we can only do that
          // after we are assured that we are not leveraging the plural style
          // predicate
          let field = await getField(
            definition,
            pathTraveled,
            this.definitionLookup,
          );
          if (!isFieldPlural(field) && !rootPluralPath) {
            let fieldName = currentField(pathTraveled);
            return ['->', param(fieldName), ...expression];
          }
          return expression;
        },
      },
      // `fieldQuery` serves both filters and sorts; only gate filter paths on
      // searchability (a sort key that isn't in the doc is out of scope here).
      errorHint === 'filter'
        ? seedSearchableRoutesFromDefinition(definition)
        : undefined,
    );
    if (!rootPluralPath) {
      // Numeric fields (NumberField, BigIntegerField) are stored as JSON
      // numbers/strings but PostgreSQL's ->> extracts them as text. Cast to
      // numeric so that ORDER BY and range comparisons use numeric ordering
      // instead of lexicographic ordering (e.g. 100 > 20 > 3, not
      // "100" < "20" < "3"). SQLite's ->> preserves the original JSON type so
      // no cast is needed there.
      if (isNumericField) {
        // A sort reads every row the query returns, and a sort anchored on
        // one subclass reaches rows of its siblings, which may hold text
        // under the same name: only text that reads as a number is cast, so
        // any other value sorts as no value rather than failing the search.
        // A filter (`eq`, `in`, `range`) is guarded the same way: nothing
        // makes Postgres apply the type gate before the cast, so another
        // type's text there would fail the query.
        exp = [
          dbExpression({
            pg: [
              '(CASE WHEN (search_doc',
              ...exp,
              `) ~ '^\\s*-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?\\s*$' THEN (search_doc`,
              ...exp,
              ')::numeric END)',
            ],
            sqlite: ['search_doc', ...exp],
          }),
        ];
      } else if (readsSpill && errorHint !== 'filter' && path === 'cardTitle') {
        // A title sort reads the row's inline `title_sort`, the same text as
        // `spill_text(search_doc -> 'cardTitle')` in the same collation,
        // which an index holds in order (see the `add-boxel-index-title-sort`
        // migration). A staged read gets the column from `stagedRows`.
        exp = ['title_sort'];
      } else if (readsSpill) {
        exp = ['spill_text(search_doc', ...exp, ')'];
      } else {
        exp = ['search_doc', ...exp];
      }
    } else if (isNumericField && errorHint === 'filter' && !useJsonBValue) {
      // A number inside a list is read from the list's tree as text, so it is
      // cast as a singular number is: without the cast `gte: 10` compares
      // "5" with "10" as text and passes it. The tree also yields the rows
      // beside the one a predicate tests (the list itself, an element's other
      // fields), and SQL may evaluate the cast on those first, so only text
      // that reads as a number is cast. SQLite's tree keeps the JSON type.
      exp = [
        dbExpression({
          pg: [
            '(CASE WHEN',
            ...exp,
            `~ '^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (`,
            ...exp,
            ')::numeric END)',
          ],
          sqlite: exp,
        }),
      ];
    }
    return exp;
  }

  // A field declared `search: false` (or one inside it) is not in the search
  // doc, so a filter on it would match nothing whatever it asks: refused,
  // naming the field, rather than answered with no rows.
  async #assertSearchable(
    definition: Definition,
    pathTraveled: string,
    written: string,
  ) {
    let segments = removeBrackets(pathTraveled).split('.');
    // a card's `id` and `cardTitle` stay in the search doc whatever they
    // declare
    let last = segments[segments.length - 1];
    if (last === 'id' || last === 'cardTitle') return;
    for (let i = 1; i <= segments.length; i++) {
      let prefix = segments.slice(0, i).join('.');
      let field: FieldDefinition | undefined;
      try {
        field = await getField(definition, prefix, this.definitionLookup);
      } catch {
        return;
      }
      if (field.search === false) {
        throw new InvalidQueryError(
          `"${written}" cannot be filtered: "${prefix}" is declared \`search: false\`, so the index does not hold it`,
          'needs-declaration',
        );
      }
    }
  }

  private async handleFieldValue(
    fieldValue: FieldValue,
    ctx?: ReadContext,
  ): Promise<Expression> {
    let { path, value, type, now } = fieldValue;
    let definition = await this.getDefinition(type);
    let exp = await this.makeExpression(value, ctx);

    return await this.walkFilterFieldPath(
      definition,
      path,
      exp,
      // Leaf field handler
      async (definition, expression, pathTraveled) => {
        let queryValue: any;
        let [value] = expression;
        let field = await getField(
          definition,
          pathTraveled,
          this.definitionLookup,
        );
        await this.#assertSearchable(definition, pathTraveled, path);
        let serializer = field.serializerName
          ? getSerializer(field.serializerName)
          : undefined;
        // A number field compares as a number, so its value has to read as
        // one. Anything else is refused here: the cast would otherwise fail
        // in the database, as an error with no code.
        if (
          (field.serializerName === 'number' ||
            field.serializerName === 'big-integer') &&
          isParam(value) &&
          value.param != null &&
          (typeof value.param === 'string'
            ? !/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(value.param)
            : typeof value.param !== 'bigint' &&
              (typeof value.param !== 'number' ||
                !Number.isFinite(value.param)))
        ) {
          let shown: string;
          try {
            shown = JSON.stringify(value.param) ?? String(value.param);
          } catch {
            shown = 'that value';
          }
          throw new InvalidQueryError(
            `"${path}" is a number field, so it compares with a number, not ${shown.slice(0, 80)}`,
            'invalid-value',
          );
        }
        if (
          isParam(value) &&
          (field.serializerName === 'date' ||
            field.serializerName === 'datetime')
        ) {
          assertRelativeDateWellFormed(value.param, path);
        }
        let relative = isParam(value)
          ? relativeDateForField(value.param, field.serializerName, now)
          : undefined;
        if (relative !== undefined) {
          // `now-30d` and the like, as the field's search doc spells a date.
          queryValue = relative;
        } else if (isParam(value)) {
          queryValue = serializer?.formatQuery?.(value.param) ?? value.param;
        } else if (typeof value === 'string') {
          queryValue = serializer?.formatQuery?.(value) ?? value;
        } else {
          throw new Error(
            `Do not know how to handle field value: ${stringify(value)}`,
          );
        }
        return [param(queryValue)];
      },
      undefined,
      // This is a filter path: validate searchability as the walk crosses it.
      seedSearchableRoutesFromDefinition(definition),
    );
  }

  // Resolves a non-null `eq` predicate that fieldArity routed to a singular
  // path (no plural segment was crossed). When the leaf is a string-valued,
  // non-numeric field the predicate becomes a GIN-servable `JsonContains`
  // node; otherwise it degrades to the same `->>` extraction equality the
  // engine has always emitted — numeric leaves keep their `::numeric` cast
  // semantics, non-string values keep text equality.
  private async handleJsonContainsQuery(
    node: JsonContainsQuery,
  ): Promise<Expression> {
    if (node.orElse) {
      return (
        (await this.#containedJsonPath(
          node.path,
          node.type,
          node.anyOf ?? [node.value],
          node.now,
        )) ?? (await this.makeExpression(node.orElse))
      );
    }
    if (node.anyOf && node.anyOf.length > 1 && this.dialect.jsonbContainment) {
      return await this.#jsonContainsAny(node, node.anyOf);
    }
    let { path, type, value } = node;
    let resolvedValue = await this.makeExpression([
      filterFieldValue(path, value, type, node.now),
    ]);
    let [leaf] = resolvedValue;
    let definition = await this.getDefinition(type);
    let leafField = await getField(definition, path, this.definitionLookup);
    let isNumericLeaf =
      leafField.serializerName === 'number' ||
      leafField.serializerName === 'big-integer';
    if (
      isParam(leaf) &&
      typeof leaf.param === 'string' &&
      !isNumericLeaf &&
      // A value longer than the inline limit may be spilled, which a
      // containment can't see, so it compares through `spill_text` instead. A
      // shorter one is always inline.
      (!this.dialect.searchDocSpill ||
        leaf.param.length <= SEARCH_DOC_INLINE_STRING_MAX)
    ) {
      return [
        {
          kind: 'json-contains',
          column: 'search_doc',
          segments: path.split('.'),
          value: leaf,
        },
      ];
    }
    return await this.makeExpression([
      fieldQuery(path, type, false, 'filter'),
      '=',
      ...resolvedValue,
    ]);
  }

  // A positive `in` on a singular path, on Postgres: the OR of the tests
  // `handleJsonContainsQuery` gives each value, written as at most two tests
  // of the row against all the values at once. ANY is that OR by definition,
  // so the rows are the same; what changes is how often the row's search doc
  // is read. Postgres reads it again for each OR arm, and for each element
  // of an ANY whose operator takes the whole document, so an `in` of 10,000
  // values over 2,000 cards whose search docs are stored out of line read 20
  // million documents (25 s).
  //
  // The values a containment serves (text within the inline limit, on a
  // field that is not a number) stay one `search_doc @> ANY(ARRAY[…])` up to
  // `CONTAINMENT_ANY_MAX` of them, which the search doc's GIN index serves as
  // it served the OR of containments. Past that, the value at the path is
  // read out once and compared as JSON (`#> … = ANY(ARRAY[…]::jsonb)`): a
  // string at a path of objects is exactly what `@> {path: string}` asks for,
  // and an array on the way, which a containment does not look into, reads
  // as NULL. The other values compare the extracted value once, with
  // `= ANY(ARRAY[…]::numeric[])` on a number field and `::text[]` otherwise:
  // the types the OR's untyped values took from the extraction.
  // A positive `in` whose values are all text a containment serves (within
  // the inline limit, on a field that is not a number), up to
  // `JSONPATH_ANY_MAX` of them, as one SQL/JSON path test of the row's search
  // doc: `i.search_doc @? 'strict $."a"."b" ? (@ == "x" || @ == "y")'`.
  // Undefined when some value needs another test.
  //
  // It selects the rows the OR of containments `{a: {b: x}}` selects. In
  // strict mode the path does not step into a list on the way, as a
  // containment does not (a list there is a structural error, which `@?`
  // reads as no match), and the filter compares the value at the path
  // itself, so a list holding "x" is not "x"; a string equals only the same
  // string, never a number. Unlike `@> ANY(…)`, which hands the row's search
  // doc to the operator once per value (and Postgres decompresses an
  // out-of-line doc on every call), the path is evaluated once a row, both
  // when the GIN index's candidates are rechecked and when rows are tested
  // in turn. A wide list of the same values cost 25 times a single test.
  async #containedJsonPath(
    path: string,
    type: CodeRef,
    values: CardExpression[],
    now?: Date,
  ): Promise<Expression | undefined> {
    if (values.length === 0 || values.length > JSONPATH_ANY_MAX) {
      return undefined;
    }
    let definition = await this.getDefinition(type);
    let leafField = await getField(definition, path, this.definitionLookup);
    if (
      leafField.serializerName === 'number' ||
      leafField.serializerName === 'big-integer'
    ) {
      return undefined;
    }
    let texts: string[] = [];
    for (let value of values) {
      let [leaf, ...rest] = await this.makeExpression([
        filterFieldValue(path, value, type, now),
      ]);
      if (
        rest.length > 0 ||
        !isParam(leaf) ||
        typeof leaf.param !== 'string' ||
        leaf.param.length > SEARCH_DOC_INLINE_STRING_MAX
      ) {
        return undefined;
      }
      texts.push((leaf.pg ?? leaf.param) as string);
    }
    let test = texts.map((t) => `@ == ${JSON.stringify(t)}`).join(' || ');
    return [
      'i.search_doc @?',
      param(`strict ${jsonPathOfKeys(path.split('.'))} ? (${test})`),
      '::jsonpath',
    ];
  }

  async #jsonContainsAny(
    node: JsonContainsQuery,
    values: CardExpression[],
  ): Promise<Expression> {
    let { path, type } = node;
    let definition = await this.getDefinition(type);
    let leafField = await getField(definition, path, this.definitionLookup);
    let isNumericLeaf =
      leafField.serializerName === 'number' ||
      leafField.serializerName === 'big-integer';
    let resolved = await Promise.all(
      values.map((value) =>
        this.makeExpression([filterFieldValue(path, value, type, node.now)]),
      ),
    );
    let segments = path.split('.');
    let contained: string[] = [];
    let compared: Expression[] = [];
    for (let resolvedValue of resolved) {
      let [leaf] = resolvedValue;
      if (
        resolvedValue.length === 1 &&
        isParam(leaf) &&
        typeof leaf.param === 'string' &&
        !isNumericLeaf &&
        leaf.param.length <= SEARCH_DOC_INLINE_STRING_MAX
      ) {
        contained.push((leaf.pg ?? leaf.param) as string);
      } else {
        compared.push(resolvedValue);
      }
    }
    let tests: Expression[] = [];
    if (contained.length > 0 && contained.length <= CONTAINMENT_ANY_MAX) {
      tests.push([
        'search_doc @> ANY(ARRAY[',
        ...(separatedByCommas(
          contained.map((value) => [
            param(
              segments.reduceRight<JSONTypes.Value>(
                (acc, segment) => ({ [segment]: acc }),
                value,
              ) as JSONTypes.Object,
            ),
            '::jsonb',
          ]),
        ) as Expression),
        '])',
      ]);
    } else if (contained.length > 0) {
      tests.push([
        '(search_doc #>',
        // a text-array literal, bound: each name quoted
        param(
          `{${segments.map((name) => `"${name.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`,
        ),
        '::text[]) = ANY(ARRAY[',
        ...(separatedByCommas(
          contained.map((value) => [param(JSON.stringify(value)), '::jsonb']),
        ) as Expression),
        '])',
      ]);
    }
    if (compared.length > 0) {
      let extracted = await this.makeExpression([
        fieldQuery(path, type, false, 'filter'),
      ]);
      // Each value resolves to a lone parameter, typed by the extraction it
      // is compared with; anything else keeps one comparison a value.
      if (compared.every((v) => v.length === 1 && isParam(v[0]))) {
        tests.push([
          '(',
          ...extracted,
          ') = ANY(ARRAY[',
          ...(separatedByCommas(compared) as Expression),
          `]::${isNumericLeaf ? 'numeric' : 'text'}[])`,
        ]);
      } else {
        for (let value of compared) {
          tests.push(['(', ...extracted, ') =', ...value]);
        }
      }
    }
    return tests.length === 1
      ? tests[0]
      : ([
          '(',
          ...tests.flatMap((t, i) => (i ? ['OR', ...t] : t)),
          ')',
        ] as Expression);
  }

  protected async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<Expression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<Expression>,
    searchableRoutes?: string[],
    pathTraveled?: string[],
  ): Promise<Expression>;
  protected async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: CardExpression,
    handleLeafField: FilterFieldHandler<CardExpression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<CardExpression>,
    searchableRoutes?: string[],
    pathTraveled?: string[],
  ): Promise<CardExpression>;
  protected async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<any[]>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<any[]>,
    // `searchable` routes for this card, supplied (and narrowed to the target's
    // tails on each hop) only when walking a FILTER path — sort paths pass none,
    // which disables the searchability check. Seeded by the caller from the
    // queried card's annotations so the check uses the SAME route model the
    // search-doc generator uses.
    searchableRoutes?: string[],
    pathTraveled: string[] = [],
  ): Promise<any> {
    let pathSegments = path.split('.');
    let isLeaf = pathSegments.length === 1;
    let currentSegment = pathSegments.shift()!;
    let currentPath = removeBrackets(
      [...pathTraveled, currentSegment].join('.'),
    );
    let field = await getField(definition, currentPath, this.definitionLookup);

    // Validate searchability as we cross each relationship hop. A filter that
    // continues past a `linksTo`/`linksToMany` whose target the search doc does
    // not carry would match nothing silently, so raise a distinct, actionable
    // error instead. `getField` above has already resolved this segment, so a
    // genuinely nonexistent field surfaces as the "nonexistent field" error
    // before we get here.
    let interiorRoutes: string[] | undefined;
    if (searchableRoutes !== undefined) {
      let { matched, tails } = matchSearchableRoutes(
        searchableRoutes,
        currentSegment,
      );
      interiorRoutes = tails;
      if (
        !isLeaf &&
        (field.type === 'linksTo' || field.type === 'linksToMany')
      ) {
        // A path stopping at the link's `id` reads only the always-present
        // `{ id }` sentinel, so it needs no expansion.
        let crossingToIdOnly =
          pathSegments.length === 1 && pathSegments[0] === 'id';
        if (field.query) {
          // Query-backed relationships are never in the search doc at all (not
          // even `{ id }`) — they can't be invalidated when matching cards
          // change — so nothing can be filtered through them.
          throw new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path: [currentPath, ...pathSegments].join('.'),
            relationshipPath: currentPath,
            reason: 'query-backed',
          });
        }
        if (!matched && !crossingToIdOnly) {
          throw new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path: [currentPath, ...pathSegments].join('.'),
            relationshipPath: currentPath,
            reason: 'not-searchable',
          });
        }
      }
    }

    // we use '[]' to denote plural fields as that has important ramifications
    // to how we compose our queries in the various handlers and ultimately in
    // SQL construction
    let traveled = [
      ...(pathTraveled ?? []),
      `${currentSegment}${isFieldPlural(field) ? '[]' : ''}`,
    ].join('.');
    if (isLeaf) {
      expression = await handleLeafField(definition, expression, traveled);
    } else {
      let passThru: FilterFieldHandler<any[]> = async (
        _definition,
        e: Expression,
      ) => e;
      // when dealing with an interior field that is not a leaf path segment,
      // the entrance and exit hooks allow you to decorate the expression for
      // the interior field before the interior's antecedant segment's
      // expression is processed and after the interior field's antecedant
      // segment's expression has been processed (i.e. recursing into the
      // antecedant field and recursing out of the antecedant field).
      let entranceHandler = handleInteriorField
        ? handleInteriorField.enter || passThru
        : passThru;
      let exitHandler = handleInteriorField
        ? handleInteriorField.exit || passThru
        : passThru;

      let interiorExpression = await this.walkFilterFieldPath(
        definition,
        pathSegments.join('.'),
        await entranceHandler(definition, expression, traveled),
        handleLeafField,
        handleInteriorField,
        interiorRoutes,
        traveled.split('.'),
      );
      expression = await exitHandler(definition, interiorExpression, traveled);
    }
    return expression;
  }
}
