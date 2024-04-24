import * as JSON from 'json-typescript';
import isEqual from 'lodash/isEqual';
import { assertJSONValue, assertJSONPrimitive } from './json-validation';
import qs from 'qs';
import { type CodeRef, isCodeRef } from './index';

export interface Query {
  filter?: Filter;
  sort?: Sort;
  page?: {
    number: number; // page.number is 0-based
    size: number;
    realmVersion?: number;
  };
}

export type CardURL = string;
export type Filter =
  | AnyFilter
  | EveryFilter
  | NotFilter
  | EqFilter
  | ContainsFilter
  | RangeFilter
  | CardTypeFilter;

export interface TypedFilter {
  on?: CodeRef;
}

interface SortExpression {
  by: string;
  on: CodeRef;
  direction?: 'asc' | 'desc';
}

export type Sort = SortExpression[];

// The CardTypeFilter is used when you solely want to filter for all cards that
// adopt from some particular card type--no other predicates are included in
// this filter.
export interface CardTypeFilter {
  type: CodeRef;
}

export interface AnyFilter extends TypedFilter {
  any: Filter[];
}

export interface EveryFilter extends TypedFilter {
  every: Filter[];
}

export interface NotFilter extends TypedFilter {
  not: Filter;
}

export interface EqFilter extends TypedFilter {
  eq: { [fieldName: string]: JSON.Value };
}

export const RANGE_OPERATORS: Record<RangeOperator, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};
export type RangeOperator = 'gt' | 'gte' | 'lt' | 'lte';
export type RangeFilterValue = {
  [range in RangeOperator]?: JSON.Value;
};

export interface RangeFilter extends TypedFilter {
  range: {
    [fieldName: string]: RangeFilterValue;
  };
}

export interface ContainsFilter extends TypedFilter {
  contains: { [fieldName: string]: JSON.Value };
}

export function isCardTypeFilter(filter: Filter): filter is CardTypeFilter {
  return (filter as CardTypeFilter).type !== undefined;
}

export function isNotFilter(filter: Filter): filter is NotFilter {
  return (filter as NotFilter).not !== undefined;
}

export function isRangeFilter(filter: Filter): filter is RangeFilter {
  return (filter as RangeFilter).range !== undefined;
}

export function isEveryFilter(filter: Filter): filter is EveryFilter {
  return (filter as EveryFilter).every !== undefined;
}
export function isAnyFilter(filter: Filter): filter is AnyFilter {
  return (filter as AnyFilter).any !== undefined;
}

export function parseQueryString(querystring: string): Query {
  let query = qs.parse(querystring);
  assertQuery(query);
  return query;
}

export function buildQueryString(query: Query): string {
  return `?${qs.stringify(query)}`;
}

export function assertQuery(
  query: any,
  pointer: string[] = [''],
): asserts query is Query {
  if (typeof query !== 'object' || query == null) {
    throw new Error(`${pointer.join('/') || '/'}: missing query object`);
  }

  for (let [key, value] of Object.entries(query)) {
    switch (key) {
      case 'filter':
        assertFilter(value, pointer.concat('filter'));
        break;
      case 'sort':
        if (!Array.isArray(value)) {
          throw new Error(
            `${pointer.concat('sort').join('/') || '/'}: sort must be an array`,
          );
        }
        value.forEach((sort, i) => {
          assertSortExpression(sort, pointer.concat(`sort[${i}]`));
        });
        break;
      case 'queryString':
        if (typeof value !== 'string') {
          throw new Error(
            `${
              pointer.concat('queryString').join('/') || '/'
            }: queryString must be a string`,
          );
        }
        break;
      case 'page':
        assertPage(value, pointer.concat('page'));
        break;
      default:
        throw new Error(`unknown field in query: ${key}`);
    }
  }
}

function assertSortExpression(
  sort: any,
  pointer: string[],
): asserts sort is Query['sort'] {
  if (typeof sort !== 'object' || sort == null) {
    throw new Error(`${pointer.join('/') || '/'}: missing sort object`);
  }
  if (!('by' in sort)) {
    throw new Error(
      `${pointer.concat('by').join('/') || '/'}: missing by object`,
    );
  }
  if (typeof sort.by !== 'string') {
    throw new Error(
      `${pointer.concat('by').join('/') || '/'}: by must be a string`,
    );
  }
  if (!('on' in sort)) {
    throw new Error(
      `${pointer.concat('on').join('/') || '/'}: missing on object`,
    );
  }
  assertCardType(sort.on, pointer.concat('on'));

  if ('direction' in sort) {
    if (sort.direction !== 'asc' && sort.direction !== 'desc') {
      throw new Error(
        `${
          pointer.concat('direction').join('/') || '/'
        }: direction must be either 'asc' or 'desc'`,
      );
    }
  }
}

function assertPage(
  page: any,
  pointer: string[],
): asserts page is Query['page'] {
  if (typeof page !== 'object' || page == null) {
    throw new Error(`${pointer.join('/') || '/'}: missing page object`);
  }

  if ('size' in page) {
    if (
      (typeof page.size !== 'number' && typeof page.size !== 'string') ||
      (typeof page.size === 'string' && isNaN(page.size))
    ) {
      throw new Error(
        `${pointer.concat('size').join('/') || '/'}: size must be a number`,
      );
    }
  }

  if ('cursor' in page && typeof page.cursor !== 'string') {
    throw new Error(
      `${pointer.concat('cursor').join('/') || '/'}: cursor must be a string`,
    );
  }
}

function assertFilter(
  filter: any,
  pointer: string[],
): asserts filter is Filter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: missing filter object`);
  }

  if ('type' in filter) {
    assertCardType(filter.type, pointer.concat('type'));
    if (isEqual(Object.keys(filter), ['type'])) {
      return; // This is a pure card type filter
    }
  }

  if ('on' in filter) {
    assertCardType(filter.on, pointer.concat('on'));
  }

  if ('any' in filter) {
    assertAnyFilter(filter, pointer);
  } else if ('every' in filter) {
    assertEveryFilter(filter, pointer);
  } else if ('not' in filter) {
    assertNotFilter(filter, pointer);
  } else if ('eq' in filter) {
    assertEqFilter(filter, pointer);
  } else if ('contains' in filter) {
    assertContainsFilter(filter, pointer);
  } else if ('range' in filter) {
    assertRangeFilter(filter, pointer);
  } else {
    throw new Error(
      `${pointer.join('/') || '/'}: cannot determine the type of filter`,
    );
  }
}

function assertCardType(type: any, pointer: string[]) {
  if (!isCodeRef(type)) {
    throw new Error(`${pointer.join('/') || '/'}: type is not valid`);
  }
}

function assertAnyFilter(
  filter: any,
  pointer: string[],
): asserts filter is AnyFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: filter must be an object`);
  }
  pointer.concat('any');
  if (!('any' in filter)) {
    throw new Error(
      `${pointer.join('/') || '/'}: AnyFilter must have any property`,
    );
  }

  if (!Array.isArray(filter.any)) {
    throw new Error(
      `${pointer.join('/') || '/'}: any must be an array of Filters`,
    );
  } else {
    filter.any.every((value: any, index: number) =>
      assertFilter(value, pointer.concat(`[${index}]`)),
    );
  }
}

function assertEveryFilter(
  filter: any,
  pointer: string[],
): asserts filter is EveryFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: filter must be an object`);
  }
  pointer.concat('every');
  if (!('every' in filter)) {
    throw new Error(
      `${pointer.join('/') || '/'}: EveryFilter must have every property`,
    );
  }

  if (!Array.isArray(filter.every)) {
    throw new Error(
      `${pointer.join('/') || '/'}: every must be an array of Filters`,
    );
  } else {
    filter.every.every((value: any, index: number) =>
      assertFilter(value, pointer.concat(`[${index}]`)),
    );
  }
}

function assertNotFilter(
  filter: any,
  pointer: string[],
): asserts filter is NotFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: filter must be an object`);
  }
  pointer.concat('not');
  if (!('not' in filter)) {
    throw new Error(
      `${pointer.join('/') || '/'}: NotFilter must have not property`,
    );
  }

  assertFilter(filter.not, pointer);
}

function assertEqFilter(
  filter: any,
  pointer: string[],
): asserts filter is EqFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: filter must be an object`);
  }
  pointer.concat('eq');
  if (!('eq' in filter)) {
    throw new Error(
      `${
        pointer.concat('eq').join('/') || '/'
      }: EqFilter must have eq property`,
    );
  }
  if (typeof filter.eq !== 'object' || filter.eq == null) {
    throw new Error(`${pointer.join('/') || '/'}: eq must be an object`);
  }
  Object.entries(filter.eq).every(([key, value]) =>
    assertJSONValue(value, pointer.concat(key)),
  );
}

function assertContainsFilter(
  filter: any,
  pointer: string[],
): asserts filter is ContainsFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: filter must be an object`);
  }
  pointer.concat('contains');
  if (!('contains' in filter)) {
    throw new Error(
      `${
        pointer.concat('contains').join('/') || '/'
      }: ContainsFilter must have contains property`,
    );
  }
  if (typeof filter.contains !== 'object' || filter.contains == null) {
    throw new Error(`${pointer.join('/') || '/'}: contains must be an object`);
  }
  Object.entries(filter.contains).every(([key, value]) =>
    assertJSONValue(value, pointer.concat(key)),
  );
}

function assertRangeFilter(
  filter: any,
  pointer: string[],
): asserts filter is RangeFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new Error(`${pointer.join('/') || '/'}: filter must be an object`);
  }
  pointer.concat('range');
  if (!('range' in filter)) {
    throw new Error(
      `${
        pointer.concat('range').join('/') || '/'
      }: RangeFilter must have range property`,
    );
  }
  if (typeof filter.range !== 'object' || filter.range == null) {
    throw new Error(`${pointer.join('/') || '/'}: range must be an object`);
  }
  Object.entries(filter.range).every(([fieldPath, constraints]) => {
    let innerPointer = [...pointer, fieldPath];
    if (typeof constraints !== 'object' || constraints == null) {
      throw new Error(
        `${innerPointer.join('/') || '/'}: range constraint must be an object`,
      );
    }
    Object.entries(constraints).every(([key, value]) => {
      switch (key) {
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
          assertJSONPrimitive(value, innerPointer.concat(key));
          return;
        default:
          throw new Error(
            `${
              innerPointer.join('/') || '/'
            }: range item must be gt, gte, lt, or lte`,
          );
      }
    });
  });
}
