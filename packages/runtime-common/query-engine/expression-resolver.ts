// Pass 2 of compilation: the symbolic nodes of a `CardExpression` (a field
// read, a field test, a type condition) resolved against the type's
// definitions into SQL. See docs/search.md ("Edge cases and what is
// guaranteed") for missing values and list semantics.
import { refuse } from '../query-v2/query-refusals.ts';
import { CONTAINMENT_ANY_MAX, JSONPATH_ANY_MAX } from './filter-sql.ts';
import {
  type CardExpression,
  type Expression,
  type FieldQuery,
  type FieldTest,
  type Param,
  any,
  every,
  isDbExpression,
  isParam,
  param,
  separatedByCommas,
  tableValuedTree,
  typesContains,
} from '../expression.ts';
import { getSerializer } from '../index.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';
import {
  type FilterFieldHandler,
  type ReadContext,
  assertNever,
} from './types.ts';
import {
  FilterRefersToNonsearchableFieldError,
  getField,
  isFieldPlural,
  removeBrackets,
  seedSearchableRoutesFromDefinition,
} from './filter-paths.ts';
import { IndexRows } from './index-rows.ts';
import { storedRangeCandidates } from './value-store-filter.ts';
import { hotDoc, hotIndexedTest } from './dialect.ts';
import {
  RANGE_OPERATORS,
  type RangeOperator,
  absoluteDateForField,
  assertRelativeDateWellFormed,
  relativeDateForField,
  spellsAnInstant,
} from '../query.ts';
import type * as JSONTypes from 'json-typescript';
import type { RequestTimings } from '../request-timings.ts';
import { arrayElement, jsonPathOfKeys } from '../sql-literal.ts';
import { matchSearchableRoutes } from '../searchable-routes.ts';

const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;
const LIST = 'le';
// `every` and `separatedByCommas` over resolved SQL: their overloads pick the
// symbolic type for a spread.
const all = (parts: Expression[]) => every(parts) as Expression;
const commas = (parts: Expression[]) => separatedByCommas(parts) as Expression;

// A field path walked once against its type: the names, which of them are
// lists (`traveled` marks those with `[]`), the first list's path (`root`),
// and the leaf's definition.
interface Field {
  definition: Definition;
  path: string;
  traveled: string;
  root?: string;
  leaf: FieldDefinition;
  numeric: boolean;
}

export abstract class ExpressionResolver extends IndexRows {
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

  protected async makeExpression(
    query: CardExpression,
    ctx?: ReadContext,
  ): Promise<Expression> {
    let parts = await Promise.all(
      query.map(async (element): Promise<Expression> => {
        if (
          typeof element === 'string' ||
          isParam(element) ||
          isDbExpression(element)
        ) {
          return [element];
        }
        switch (element.kind) {
          case 'table-valued-tree':
          case 'json-contains':
          case 'types-contains':
          case 'sort-direction':
            return [element];
          case 'field-query':
            return this.#read(
              await this.#field(
                await this.getDefinition(element.type),
                element.path,
                element.errorHint === 'filter',
              ),
              element,
            );
          case 'field-test':
            return this.#test(element, ctx);
          case 'type-condition':
            return any(
              (await this.typeKeysFor(element.ref)).map((key) => [
                typesContains(key, element.column),
              ]),
            ) as Expression;
          default:
            throw assertNever(element);
        }
      }),
    );
    return parts.flat();
  }

  // Walks `path` from `definition`, refusing a link the search doc does not
  // carry when `searchable` is asked for (a filter, never a sort).
  async #field(
    definition: Definition,
    path: string,
    searchable: boolean,
  ): Promise<Field> {
    let names = path.split('.');
    let routes = searchable
      ? seedSearchableRoutesFromDefinition(definition)
      : undefined;
    let traveled: string[] = [];
    let leaf!: FieldDefinition;
    for (let [i, name] of names.entries()) {
      let here = removeBrackets([...traveled, name].join('.'));
      leaf = await getField(definition, here, this.definitionLookup);
      let rest = names.slice(i + 1);
      if (routes) {
        let { matched, tails } = matchSearchableRoutes(routes, name);
        let isLink = leaf.type === 'linksTo' || leaf.type === 'linksToMany';
        let reason: 'query-backed' | 'not-searchable' | undefined =
          !rest.length || !isLink
            ? undefined
            : leaf.query
              ? 'query-backed'
              : !matched && !(rest.length === 1 && rest[0] === 'id')
                ? 'not-searchable'
                : undefined;
        if (reason) {
          throw new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path: [here, ...rest].join('.'),
            relationshipPath: here,
            reason,
          });
        }
        routes = tails;
      }
      traveled.push(`${name}${isFieldPlural(leaf) ? '[]' : ''}`);
    }
    let joined = traveled.join('.');
    return {
      definition,
      path,
      traveled: joined,
      root: joined.includes('[')
        ? joined.substring(0, joined.indexOf('['))
        : undefined,
      leaf,
      numeric:
        leaf.serializerName === 'number' ||
        leaf.serializerName === 'big-integer',
    };
  }

  // Kept for the callers that only need a path's traveled form.
  protected async walkFilterFieldPath<T extends unknown[]>(
    definition: Definition,
    path: string,
    expression: T,
    handleLeafField: FilterFieldHandler<T>,
    _interior?: unknown,
    searchableRoutes?: string[],
  ): Promise<T> {
    let field = await this.#field(
      definition,
      path,
      searchableRoutes !== undefined,
    );
    return await handleLeafField(definition, expression, field.traveled);
  }

  // The column a list at `root` is walked in: the hot doc's (`hotDoc`).
  #listDoc(root: string): string {
    return root === '$'
      ? 'search_doc'
      : hotDoc(this.dialect.kind, root.split('.'));
  }

  // The SQL that reads a field's value: a list element's column when the
  // path crosses a list, else the value out of `search_doc`.
  #read(
    field: Field,
    {
      useJsonBValue,
      errorHint,
    }: Pick<FieldQuery, 'useJsonBValue' | 'errorHint'>,
    listAlias?: string,
  ): Expression {
    let inFilter = errorHint === 'filter';
    if (field.root) {
      let column = useJsonBValue ? 'jsonb_value' : 'text_value';
      let value: Expression = listAlias
        ? [`${listAlias}.${column}`]
        : [
            tableValuedTree(
              this.#listDoc(field.root),
              field.root,
              field.path,
              column,
            ),
          ];
      return field.numeric && inFilter && !useJsonBValue
        ? this.dialect.numericText(value)
        : value;
    }
    // The one read of a field out of the doc (the dialect's `docRead`, which
    // serves it from the row's narrow `search_keys` where it can).
    let read = this.dialect.docRead(removeBrackets(field.traveled).split('.'));
    if (field.numeric) {
      return this.dialect.numericField(read);
    }
    if (this.dialect.titleSort && !inFilter && field.path === 'cardTitle') {
      return ['title_sort'];
    }
    return read;
  }

  // A query's value as the index stores it: a relative or partial date
  // resolved, the field's serializer applied, a non-number refused on a
  // number field.
  async #value(
    field: Field,
    value: JSONTypes.Value,
    now?: Date,
    bound?: RangeOperator,
  ): Promise<Expression> {
    await this.#assertSearchable(field);
    let name = field.leaf.serializerName;
    if (
      field.numeric &&
      value != null &&
      (typeof value === 'string'
        ? !/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(value)
        : typeof value !== 'bigint' &&
          (typeof value !== 'number' || !Number.isFinite(value)))
    ) {
      let shown: string;
      try {
        shown = JSON.stringify(value) ?? String(value);
      } catch {
        shown = 'that value';
      }
      throw refuse('number-field-compares-number', undefined, {
        path: field.path,
        value1: shown.slice(0, 80),
      });
    }
    if (name === 'date' || name === 'datetime') {
      assertRelativeDateWellFormed(value, field.path);
    }
    let stored =
      relativeDateForField(value, name, now) ??
      absoluteDateForField(value, name, bound) ??
      (name ? getSerializer(name) : undefined)?.formatQuery?.(value) ??
      value;
    return field.numeric && stored != null
      ? this.dialect.numericBind(param(stored))
      : [param(stored)];
  }

  async #assertSearchable(field: Field) {
    let segments = removeBrackets(field.traveled).split('.');
    let last = segments[segments.length - 1];
    if (last === 'id' || last === 'cardTitle') return;
    for (let i = 1; i <= segments.length; i++) {
      let prefix = segments.slice(0, i).join('.');
      let found: FieldDefinition | undefined;
      try {
        found = await getField(field.definition, prefix, this.definitionLookup);
      } catch {
        return;
      }
      if (found.search === false) {
        throw refuse('cannot-filtered-declared-search', undefined, {
          path: field.path,
          prefix,
        });
      }
    }
  }

  // One test of one field. On a path that crosses a list, the test holds
  // when some element satisfies it.
  async #test(test: FieldTest, ctx?: ReadContext): Promise<Expression> {
    let field = await this.#field(
      await this.getDefinition(test.type),
      test.path,
      true,
    );
    let read = (jsonb = false) =>
      this.#read(
        field,
        { useJsonBValue: jsonb, errorHint: 'filter' },
        field.root ? LIST : undefined,
      );
    let value = (v: JSONTypes.Value, bound?: RangeOperator) =>
      this.#value(field, v, test.now, bound);
    let someElement = (predicate: Expression): Expression => {
      if (!field.root) {
        return predicate;
      }
      let tree: Expression = [
        `EXISTS (SELECT 1 FROM jsonb_tree(${this.#listDoc(field.root)},`,
        param(`$.${field.root}`),
        `) AS ${LIST} WHERE`,
        ...all([
          predicate,
          [
            `${LIST}.fullkey LIKE`,
            param(`$.${field.traveled.replace(/\[\]/g, '[%]')}`),
          ],
        ]),
        ')',
      ];
      if (this.dialect.kind !== 'pg' || field.traveled !== `${field.root}[]`) {
        return tree;
      }
      // A list the path ends in: the tree's nodes it tests are the list's
      // elements and everything under them. Each element is read directly,
      // with the text the tree gives it, and the tree is walked only for a
      // list holding an object or a list, whose nested nodes the elements
      // alone do not reach.
      let doc = this.#listDoc(field.root);
      let at: Expression = [
        `(${doc} #>`,
        param(`{${field.root.split('.').map(arrayElement).join(',')}}`),
        '::text[])',
      ];
      let list: Expression = [
        'CASE WHEN jsonb_typeof(',
        ...at,
        ") = 'array' THEN",
        ...at,
        'END',
      ];
      return [
        '(',
        'EXISTS (SELECT 1 FROM jsonb_array_elements(',
        ...list,
        `) AS ${LIST}_e (v) CROSS JOIN LATERAL (SELECT ${LIST}_e.v AS jsonb_value, CASE WHEN jsonb_typeof(${LIST}_e.v) = 'string' THEN ${LIST}_e.v #>> '{}' ELSE trim('"' from ${LIST}_e.v::text) END AS text_value) AS ${LIST} WHERE`,
        ...predicate,
        ')',
        'OR (jsonb_path_exists(',
        ...list,
        `, 'strict $[*] ? (@.type() == "object" || @.type() == "array")') AND`,
        ...tree,
        '))',
      ];
    };
    let list = async (values: JSONTypes.Value[]) =>
      commas(await Promise.all(values.map((v) => value(v))));
    let positive = test.polarity === 'positive';

    switch (test.op) {
      case 'file':
        return someElement([
          ...read(),
          test.values[0] ? 'IS NOT NULL' : 'IS NULL',
        ]);
      case 'missing':
        return [
          'NOT (',
          ...someElement(
            field.root
              ? [...read(true), ...this.dialect.jsonPresent()]
              : [...read(true), 'IS NOT NULL'],
          ),
          ')',
        ];
      case 'like':
        return someElement([
          ...read(),
          'ILIKE',
          ...(await value(test.values[0])),
          `ESCAPE '\\'`,
        ]);
      case 'pattern':
        return someElement([
          ...read(),
          test.sqlOp!,
          ...(await value(test.values[0])),
          ...(test.values.length > 1
            ? ['AND', ...read(), '~*', ...(await value(test.values[1]))]
            : []),
        ]);
      case 'range': {
        let tested = someElement(
          all(
            await Promise.all(
              Object.entries(test.range!).map(
                async ([operator, v]): Promise<Expression> => [
                  ...read(),
                  RANGE_OPERATORS[operator as RangeOperator],
                  ...(await value(
                    v as JSONTypes.Value,
                    operator as RangeOperator,
                  )),
                ],
              ),
            ),
          ),
        );
        let narrowed =
          test.valueStoreRealm &&
          positive &&
          !field.root &&
          field.leaf.serializerName === 'number'
            ? storedRangeCandidates(
                test.valueStoreRealm,
                removeBrackets(field.traveled),
                test.range!,
              )
            : undefined;
        return narrowed ? ['(', ...tested, 'AND', ...narrowed, ')'] : tested;
      }
      case 'eq': {
        if (test.values.length > 1) {
          // An `every`'s eqs on this field, folded (filter-operators.ts): all
          // of them hold. A list holds them all in one containment; a single
          // value cannot equal two different strings.
          if (field.root) {
            return (
              (field.root === test.path
                ? await this.#listHoldsAll(test.values, test)
                : undefined) ??
              all(
                await Promise.all(
                  test.values.map(
                    async (v): Promise<Expression> =>
                      (await this.#listHolds([v], test)) ??
                      someElement([...read(), '=', ...(await value(v))]),
                  ),
                ),
              )
            );
          }
          if (!field.numeric) {
            return ['FALSE'];
          }
          return all(
            await Promise.all(
              test.values.map((v) => this.#contains(field, v, test.now)),
            ),
          );
        }
        let [v] = test.values;
        if (!positive) {
          return someElement([...read(), '=', ...(await value(v))]);
        }
        if (!field.root) {
          return await this.#contains(field, v, test.now);
        }
        return (
          (await this.#listHolds([v], test)) ??
          someElement([...read(), '=', ...(await value(v))])
        );
      }
      case 'in': {
        let values = test.values;
        if (!positive) {
          return someElement([
            ...read(),
            'IN',
            '(',
            ...(await list(values)),
            ')',
          ]);
        }
        if (field.root) {
          return (
            (await this.#listHolds(values, test)) ??
            someElement([...read(), 'IN', '(', ...(await list(values)), ')'])
          );
        }
        if (test.perRow) {
          return ['(', ...read(), 'IN', '(', ...(await list(values)), ')', ')'];
        }
        if (!this.dialect.jsonbContainment) {
          let each = await Promise.all(
            values.map((v) => this.#contains(field, v, test.now)),
          );
          return ['(', ...each.flatMap((e, i) => (i ? ['OR', ...e] : e)), ')'];
        }
        return (
          (await this.#jsonPathHolds(field, values, test.now)) ?? [
            `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${test.indexTable} AS ti WHERE (`,
            ...(values.length > 1
              ? await this.#containsAny(field, values, test.now)
              : await this.#contains(field, values[0], test.now)),
            ')',
            ...(await this.makeExpression(test.realmBound ?? [], ctx)),
            ')',
          ]
        );
      }
      default:
        throw assertNever(test.op);
    }
  }

  // Whether `value` is a string, so a containment or jsonpath test can find
  // it through the GIN index.
  #inline(field: Field, leaf: Expression): leaf is [Param & { param: string }] {
    let [only] = leaf;
    return (
      leaf.length === 1 &&
      isParam(only) &&
      typeof only.param === 'string' &&
      !field.numeric
    );
  }

  async #contains(
    field: Field,
    value: JSONTypes.Value,
    now?: Date,
  ): Promise<Expression> {
    let leaf = await this.#value(field, value, now);
    if (this.#inline(field, leaf)) {
      let segments = field.path.split('.');
      return hotIndexedTest(this.dialect.kind, segments, (column) => [
        { kind: 'json-contains', column, segments, value: leaf[0] },
      ]);
    }
    return [
      ...this.#read(field, { useJsonBValue: false, errorHint: 'filter' }),
      '=',
      ...leaf,
    ];
  }

  // A scalar field equal to any of `values`, as one jsonpath test.
  async #jsonPathHolds(
    field: Field,
    values: JSONTypes.Value[],
    now?: Date,
  ): Promise<Expression | undefined> {
    if (!values.length || values.length > JSONPATH_ANY_MAX || field.numeric) {
      return undefined;
    }
    let texts: string[] = [];
    for (let v of values) {
      let leaf = await this.#value(field, v, now);
      if (!this.#inline(field, leaf)) {
        return undefined;
      }
      texts.push((leaf[0].pg ?? leaf[0].param) as string);
    }
    let path = `strict ${jsonPathOfKeys(field.path.split('.'))} ? (${texts
      .map((t) => `@ == ${JSON.stringify(t)}`)
      .join(' || ')})`;
    return hotIndexedTest(
      this.dialect.kind,
      field.path.split('.'),
      (column) => [`${column} @?`, param(path), '::jsonpath'],
      'i',
      true,
    );
  }

  async #containsAny(
    field: Field,
    values: JSONTypes.Value[],
    now?: Date,
  ): Promise<Expression> {
    let segments = field.path.split('.');
    let contained: string[] = [];
    let compared: Expression[] = [];
    for (let v of values) {
      let leaf = await this.#value(field, v, now);
      if (this.#inline(field, leaf)) {
        contained.push((leaf[0].pg ?? leaf[0].param) as string);
      } else {
        compared.push(leaf);
      }
    }
    let tests: Expression[] = [];
    if (contained.length > 0 && contained.length <= CONTAINMENT_ANY_MAX) {
      tests.push(
        hotIndexedTest(this.dialect.kind, segments, (column) => [
          `${column} @> ANY(ARRAY[`,
          ...commas(
            contained.map(
              (text): Expression => [
                param(
                  segments.reduceRight<JSONTypes.Value>(
                    (acc, segment) => ({ [segment]: acc }),
                    text,
                  ) as JSONTypes.Object,
                ),
                '::jsonb',
              ],
            ),
          ),
          '])',
        ]),
      );
    } else if (contained.length > 0) {
      tests.push([
        // Through the hot doc (dialect.ts `hotDoc`), as every field read is.
        `(${hotDoc(this.dialect.kind, segments)} #>`,
        param(
          `{${segments.map((name) => `"${name.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`,
        ),
        '::text[]) = ANY(ARRAY[',
        ...commas(
          contained.map(
            (text): Expression => [param(JSON.stringify(text)), '::jsonb'],
          ),
        ),
        '])',
      ]);
    }
    if (compared.length > 0) {
      let read = this.#read(field, {
        useJsonBValue: false,
        errorHint: 'filter',
      });
      if (compared.every((v) => v.length === 1 && isParam(v[0]))) {
        tests.push([
          '(',
          ...read,
          ') = ANY(ARRAY[',
          ...commas(compared),
          `]::${field.numeric ? 'numeric' : 'text'}[])`,
        ]);
      } else {
        for (let v of compared) {
          tests.push(['(', ...read, ') =', ...v]);
        }
      }
    }
    return tests.length === 1
      ? tests[0]
      : ['(', ...tests.flatMap((t, i) => (i ? ['OR', ...t] : t)), ')'];
  }

  // A list that holds every one of `values`, as one test however many there
  // are; undefined where a value is not a plain string (an instant), or the
  // path is not plain. Plain strings are one containment of all of them. A
  // string that spells a number also matches that number on a list (as
  // `#listHolds` tests it), which containment would not, so values like that
  // are one jsonpath predicate: each value is in the list, as the string or
  // the number.
  async #listHoldsAll(
    values: JSONTypes.Value[],
    test: FieldTest,
  ): Promise<Expression | undefined> {
    let segments = test.path.split('.');
    if (
      !this.dialect.jsonbContainment ||
      !values.every((v) => typeof v === 'string') ||
      values.some(spellsAnInstant) ||
      segments.some((x) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))
    ) {
      return undefined;
    }
    if (values.some((v) => JSON_NUMBER.test(v as string))) {
      let list = `@${segments.map((x) => `."${x}"`).join('')}[*]`;
      let holdsAll = `$ ? (${values
        .map(
          (v) =>
            `exists(${list} ? (@ == ${JSON.stringify(v)}${
              JSON_NUMBER.test(v as string) ? ` || @ == ${v}` : ''
            }))`,
        )
        .join(' && ')})`;
      return hotIndexedTest(
        this.dialect.kind,
        segments,
        (column) => [`(${column} @? CAST(`, param(holdsAll), 'AS jsonpath))'],
        'i',
      );
    }
    let contained = segments.reduceRight<JSONTypes.Value>(
      (acc, segment) => ({ [segment]: acc }),
      values,
    );
    return hotIndexedTest(this.dialect.kind, segments, (column) => [
      `${column} @>`,
      param(contained as JSONTypes.Object),
      '::jsonb',
    ]);
  }

  // A list holding any of `values`, as a jsonpath test the GIN index
  // answers. Strings only: a number or an instant compares by value, not by
  // its text.
  async #listHolds(
    values: JSONTypes.Value[],
    test: FieldTest,
  ): Promise<Expression | undefined> {
    let segments = test.path.split('.');
    if (
      !this.dialect.jsonbContainment ||
      values.length === 0 ||
      !values.every((v) => typeof v === 'string') ||
      values.some(spellsAnInstant) ||
      segments.some((x) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))
    ) {
      return undefined;
    }
    let holds = `$${segments.map((x) => `."${x}"`).join('')} ? (${values
      .flatMap((v) => [
        `@ == ${JSON.stringify(v)}`,
        ...(JSON_NUMBER.test(v as string) ? [`@ == ${v}`] : []),
      ])
      .join(' || ')})`;
    return hotIndexedTest(
      this.dialect.kind,
      segments,
      (column) => [`(${column} @? CAST(`, param(holds), 'AS jsonpath))'],
      'i',
    );
  }
}
