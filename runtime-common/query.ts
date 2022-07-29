import * as JSON from "json-typescript";
import isEqual from "lodash/isEqual";
import { assertJSONValue, assertJSONPrimitive } from "./json-validation";
import qs from "qs";

export interface Query {
  filter?: Filter;
  sort?: Sort;
  page?: { size?: number | string; cursor?: string };
  queryString?: string;
}

export type CardURL = string;
export type Filter =
  | AnyFilter
  | EveryFilter
  | NotFilter
  | EqFilter
  | RangeFilter
  | CardTypeFilter;

export interface TypedFilter {
  on?: CardURL;
}

interface SortExpression {
  by: string;
  on: CardURL;
  direction?: "asc" | "desc";
}

export type Sort = SortExpression[];

// The CardTypeFilter is used when you solely want to filter for all cards that
// adopt from some particular card type--no other predicates are included in
// this filter.
export interface CardTypeFilter {
  type: CardURL;
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

export interface RangeFilter extends TypedFilter {
  range: {
    [fieldName: string]: {
      gt?: JSON.Primitive;
      gte?: JSON.Primitive;
      lt?: JSON.Primitive;
      lte?: JSON.Primitive;
    };
  };
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
  pointer: string[] = [""]
): asserts query is Query {
  if (typeof query !== "object" || query == null) {
    throw new Error(`${pointer.join("/") || "/"}: missing query object`);
  }

  for (let [key, value] of Object.entries(query)) {
    switch (key) {
      case "filter":
        assertFilter(value, pointer.concat("filter"));
        break;
      case "sort":
        if (
          typeof value !== "string" &&
          (!Array.isArray(value) ||
            value.some((i: any) => typeof i !== "string"))
        ) {
          throw new Error(
            `${
              pointer.concat("sort").join("/") || "/"
            }: sort must be a string or string array`
          );
        }
        break;
      case "queryString":
        if (typeof value !== "string") {
          throw new Error(
            `${
              pointer.concat("queryString").join("/") || "/"
            }: queryString must be a string`
          );
        }
        break;
      case "page":
        assertPage(value, pointer.concat("page"));
        break;
      default:
        throw new Error(`unknown field in query: ${key}`);
    }
  }
}

function assertPage(
  page: any,
  pointer: string[]
): asserts page is Query["page"] {
  if (typeof page !== "object" || page == null) {
    throw new Error(`${pointer.join("/") || "/"}: missing page object`);
  }

  if ("size" in page) {
    if (
      (typeof page.size !== "number" && typeof page.size !== "string") ||
      (typeof page.size === "string" && isNaN(page.size))
    ) {
      throw new Error(
        `${pointer.concat("size").join("/") || "/"}: size must be a number`
      );
    }
  }

  if ("cursor" in page && typeof page.cursor !== "string") {
    throw new Error(
      `${pointer.concat("cursor").join("/") || "/"}: cursor must be a string`
    );
  }
}

function assertFilter(
  filter: any,
  pointer: string[]
): asserts filter is Filter {
  if (typeof filter !== "object" || filter == null) {
    throw new Error(`${pointer.join("/") || "/"}: missing filter object`);
  }

  if ("type" in filter) {
    assertCardId(filter.type, pointer.concat("type"));
    if (isEqual(Object.keys(filter), ["type"])) {
      return; // This is a pure card type filter
    }
  }

  if ("on" in filter) {
    assertCardId(filter.on, pointer.concat("on"));
  }

  if ("any" in filter) {
    assertAnyFilter(filter, pointer);
  } else if ("every" in filter) {
    assertEveryFilter(filter, pointer);
  } else if ("not" in filter) {
    assertNotFilter(filter, pointer);
  } else if ("eq" in filter) {
    assertEqFilter(filter, pointer);
  } else if ("range" in filter) {
    assertRangeFilter(filter, pointer);
  } else {
    throw new Error(
      `${pointer.join("/") || "/"}: cannot determine the type of filter`
    );
  }
}

function assertCardId(id: any, pointer: string[]): asserts id is CardURL {
  if (typeof id !== "string") {
    throw new Error(
      `${pointer.join("/") || "/"}: card id must be a string URL`
    );
  }
}

function assertAnyFilter(
  filter: any,
  pointer: string[]
): asserts filter is AnyFilter {
  if (typeof filter !== "object" || filter == null) {
    throw new Error(`${pointer.join("/") || "/"}: filter must be an object`);
  }
  pointer.concat("any");
  if (!("any" in filter)) {
    throw new Error(
      `${pointer.join("/") || "/"}: AnyFilter must have any property`
    );
  }

  if (!Array.isArray(filter.any)) {
    throw new Error(
      `${pointer.join("/") || "/"}: any must be an array of Filters`
    );
  } else {
    filter.any.every((value: any, index: number) =>
      assertFilter(value, pointer.concat(`[${index}]`))
    );
  }
}

function assertEveryFilter(
  filter: any,
  pointer: string[]
): asserts filter is EveryFilter {
  if (typeof filter !== "object" || filter == null) {
    throw new Error(`${pointer.join("/") || "/"}: filter must be an object`);
  }
  pointer.concat("every");
  if (!("every" in filter)) {
    throw new Error(
      `${pointer.join("/") || "/"}: EveryFilter must have every property`
    );
  }

  if (!Array.isArray(filter.every)) {
    throw new Error(
      `${pointer.join("/") || "/"}: every must be an array of Filters`
    );
  } else {
    filter.every.every((value: any, index: number) =>
      assertFilter(value, pointer.concat(`[${index}]`))
    );
  }
}

function assertNotFilter(
  filter: any,
  pointer: string[]
): asserts filter is NotFilter {
  if (typeof filter !== "object" || filter == null) {
    throw new Error(`${pointer.join("/") || "/"}: filter must be an object`);
  }
  pointer.concat("not");
  if (!("not" in filter)) {
    throw new Error(
      `${pointer.join("/") || "/"}: NotFilter must have not property`
    );
  }

  assertFilter(filter.not, pointer);
}

function assertEqFilter(
  filter: any,
  pointer: string[]
): asserts filter is EqFilter {
  if (typeof filter !== "object" || filter == null) {
    throw new Error(`${pointer.join("/") || "/"}: filter must be an object`);
  }
  pointer.concat("eq");
  if (!("eq" in filter)) {
    throw new Error(
      `${pointer.concat("eq").join("/") || "/"}: EqFilter must have eq property`
    );
  }
  if (typeof filter.eq !== "object" || filter.eq == null) {
    throw new Error(`${pointer.join("/") || "/"}: eq must be an object`);
  }
  Object.entries(filter.eq).every(([key, value]) =>
    assertJSONValue(value, pointer.concat(key))
  );
}

function assertRangeFilter(
  filter: any,
  pointer: string[]
): asserts filter is RangeFilter {
  if (typeof filter !== "object" || filter == null) {
    throw new Error(`${pointer.join("/") || "/"}: filter must be an object`);
  }
  pointer.concat("range");
  if (!("range" in filter)) {
    throw new Error(
      `${
        pointer.concat("range").join("/") || "/"
      }: RangeFilter must have range property`
    );
  }
  if (typeof filter.range !== "object" || filter.range == null) {
    throw new Error(`${pointer.join("/") || "/"}: range must be an object`);
  }
  Object.entries(filter.range).every(([fieldPath, constraints]) => {
    let innerPointer = [...pointer, fieldPath];
    if (typeof constraints !== "object" || constraints == null) {
      throw new Error(
        `${innerPointer.join("/") || "/"}: range constraint must be an object`
      );
    }
    Object.entries(constraints).every(([key, value]) => {
      switch (key) {
        case "gt":
        case "gte":
        case "lt":
        case "lte":
          assertJSONPrimitive(value, innerPointer.concat(key));
          return;
        default:
          throw new Error(
            `${
              innerPointer.join("/") || "/"
            }: range item must be gt, gte, lt, or lte`
          );
      }
    });
  });
}
