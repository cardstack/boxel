# Predicate Profile SQL Compiler

The `predicate` profile is the BXL subset intended for query-time boolean filtering. It is narrow on purpose: every accepted expression should be able to lower to SQL or another query language without running arbitrary BXL over every row.

Predicate pushdown is a convenience bridge for query authors. The normal server-scale pattern is still: retrieve with the host query language, then process the bounded JSON result with BXL. See [`query-then-process.md`](./query-then-process.md).

```ts
import { compileBxlPredicateToSql } from '@cardstack/bxl/compiler';

const result = compileBxlPredicateToSql(
  'Status = "Active" and Department IN @User.Departments',
  {
    schema,
    context: {
      User: { Departments: ['Finance', 'Legal'] },
    },
    pathToSql(path, usage) {
      return `data #>> '{${path.parts.join(',')}}'`;
    },
  },
);

result.sql;
// ((data #>> '{status}') = ($1)) AND ((data #>> '{department}') IN ($2, $3))

result.params;
// ['Active', 'Finance', 'Legal']
```

The default SQL path renderer emits quoted identifier paths like `"status"` or `"owner"."id"`. Real hosts should usually provide `pathToSql` so field paths point at their storage model and can cast by `usage` (`value`, `text`, `array`, or `timestamp`).

## SQL Predicate Module

The portable SQL module is the part of `predicate` that intentionally looks like SQL. It is limited to operators available in SQLite-class engines and upward.

Anything outside this module must be a normal jq-style function/filter call. For example, `matches("...")`, `age(CreatedAt)`, and `Tags | overlaps(@User.Clearances)` are semantic functions, not SQL operators.

```ebnf
SqlPredicate      = SqlOr ;
SqlOr             = SqlAnd, { "OR", SqlAnd } ;
SqlAnd            = SqlNot, { "AND", SqlNot } ;
SqlNot            = [ "NOT" ], SqlComparison ;
SqlComparison     = SqlValue
                  | SqlValue, CompareOp, SqlValue
                  | SqlValue, [ "NOT" ], "IN", ArrayOrContext
                  | SqlValue, [ "NOT" ], "BETWEEN", SqlValue, "AND", SqlValue
                  | SqlValue, [ "NOT" ], "LIKE", SqlLikePattern
                  | SqlValue, "IS", [ "NOT" ], ("NULL" | "TRUE" | "FALSE") ;
SqlValue          = SqlTerm, { ("+" | "-"), SqlTerm } ;
SqlTerm           = SqlFactor, { ("*" | "/" | "%"), SqlFactor } ;
SqlFactor         = FieldPath | ContextPath | Literal | ArrayLiteral | "(", SqlValue, ")" ;
CompareOp         = "=" | "==" | "!=" | "<>" | "<" | "<=" | ">" | ">=" ;
ArrayOrContext    = ArrayLiteral | ContextPath ;
SqlLikePattern    = String ;
```

Every SQL predicate form has an explicit jq mapping:

| SQL-like BXL | Canonical jq mapping | SQL lowering |
| --- | --- | --- |
| `Status = "Active"` | `.status == "Active"` | `status = $1` |
| `Status <> "Closed"` | `.status != "Closed"` | `status <> $1` |
| `Amount + Tax >= 1000` | `.amount + .tax >= 1000` | `(amount + tax) >= $1` |
| `OwnerID IS NULL` | `.ownerId == null` | `owner_id IS NULL` |
| `OwnerID IS NOT NULL` | `.ownerId != null` | `owner_id IS NOT NULL` |
| `Status IN ["Active", "Pending"]` | `.status \| IN(["Active", "Pending"])` | `status IN ($1, $2)` |
| `Status NOT IN ["Closed"]` | `(.status \| IN(["Closed"])) \| not` | `NOT (status IN ($1))` |
| `Amount BETWEEN 1000 AND 5000` | `between(.amount; 1000; 5000)` | `amount BETWEEN $1 AND $2` |
| `Amount NOT BETWEEN 1000 AND 5000` | `between(.amount; 1000; 5000) \| not` | `NOT (amount BETWEEN $1 AND $2)` |
| `Name LIKE "Ali%"` | `like(.name; "Ali%")` | `name LIKE $1` |
| `Name LIKE "%ice"` | `like(.name; "%ice")` | `name LIKE $1` |
| `Name LIKE "%lic%"` | `like(.name; "%lic%")` | `name LIKE $1` |
| `Name NOT LIKE "Bob%"` | `like(.name; "Bob%") \| not` | `NOT (name LIKE $1)` |

`LIKE` is the only portable string-pattern operator in this module. Basic SQL engines do not have standard `CONTAINS` or `STARTSWITH` operators. The wildcard lives in the string pattern:

- `LIKE "fish"` is exact string match.
- `LIKE "fish%"` is prefix / starts-with matching.
- `LIKE "%fish"` is suffix / ends-with matching.
- `LIKE "%fish%"` is substring / contains matching.
- `_` matches one character.

## Predicate Extensions

These are allowed predicate-profile calls, but they are not part of the SQLite-portable SQL module. They stay function-shaped because the host must decide how to lower them.

| BXL | Why it stays in `predicate` | SQL shape |
| --- | --- | --- |
| `present(OwnerID)` | existence/non-empty checks | `field IS NOT NULL AND CAST(field AS text) <> ''` |
| `age(CreatedAt) < "30 days"` | host-defined relative temporal windows via `ageToSql` | host-provided age SQL |
| `matches("jwt OR token")` | corpus-level full-text hook | host-provided match SQL |
| `Tags \| overlaps(@User.Clearances)` | set intersection when the host has arrays/tags | host-provided overlap SQL |

`IN`, `BETWEEN`, `LIKE`, and `IS` are SQL and remain infix. `overlaps` is not portable SQL, so it remains a function/filter call. That keeps the language honest: SQL operators look like SQL; host-specific semantics look like jq.

## Full-Text Search

Use lowercase `matches("...")` for a predicate-profile full-text hook when the host query planner supports it.

```bxl
matches('"jwt verify" OR "token verification" -oauth')
```

`matches` is intentionally corpus-level. It should point at whatever searchable projection the host owns. It is not field-scoped syntax, and it does not bring back `Description CONTAINS "Carl"`.

Use `LIKE` for a field-scoped boolean string pattern when that belongs in the eligibility predicate:

```bxl
Description LIKE "%Carl%"
```

Use jq string helpers for compute-time string work:

```bxl
Description | contains("Carl")
```

Those helpers are valid BXL, but they are not valid in the `predicate` profile because a query planner cannot assume they are indexed or cheap.

## Invalid Predicate Examples

These fail before SQL compilation:

```bxl
words(Description) > 500
```

String transforms are compute-time helpers, not query predicates.

```bxl
Description | contains("Carl")
```

Lowercase jq string helpers remain valid BXL, but they are not in the pushdown subset.

```bxl
SUM("Line Item"[* ."Taxable"]."Line Total") > 10000
```

Aggregates over nested collections are outside query-time row eligibility.

```bxl
$new.Status = "Approved"
```

Mutation state is available to request-time `policy`, not query-time `predicate`.

```bxl
1 as $limit | Amount > $limit
```

Local jq bindings are not part of the query-shaped subset. Bind context before compiling the predicate.

## API

```ts
compileBxlPredicateToSql(expression, {
  schema,
  context,
  pathToSql,
  placeholder,
  ageToSql,
  matchesToSql,
  searchTextSql,
});
```

Options:

- `schema` resolves readable labels to canonical field names before SQL compilation.
- `context` binds `@User` and `@Env` values into SQL parameters.
- `pathToSql(path, usage)` maps a BXL field path to the host SQL expression.
- `placeholder(index, value)` customizes parameter placeholders. The default is PostgreSQL-style `$1`, `$2`, and so on.
- `ageToSql(value)` customizes lowercase `age(...)`. The default emits `AGE(value)`.
- `matchesToSql(query)` customizes corpus full-text search. The default emits a PostgreSQL `to_tsvector(...) @@ websearch_to_tsquery(...)` expression over `searchTextSql` or `"search_text"`.

The compiler returns `{ sql, params, source, canonicalSource }`. It never interpolates literal values into SQL text.
