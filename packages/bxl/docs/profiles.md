# BXL Execution Profiles

BXL has one syntax and one semantic AST. A profile is not a second language; it is a validation contract for a specific execution surface. The profile exists so authors get parser-time errors when an expression asks for more power than that surface can safely provide.

```ts
type BxlProfile = 'compute' | 'policy' | 'predicate' | 'derive';
```

Use `compileBxl(expression, { target: 'ast', profile })` or `parseBxlAst(expression, { profile })` to collect `profileIssues`. Use `assertValidBxlProfile(ast, { profile })` when a caller should reject invalid expressions.

Function safety categories and profile call allow/deny lists live in one source module: `src/bxl/profiles/function-safety.ts`. Keep profile-specific function decisions there, then have validators and tooling consume that registry.

## `compute`

`compute` is the full browser/local BXL profile. It preserves the README contract: readable labels compile to canonical jq, Excel-compatible functions are available, jq paths and pipes remain valid, and the expression computes a value from the current JSON input.

Lazy FormulaJS extension functions are part of `compute` when the caller uses
an async runtime path (`runNativeJqAsync`, `prepareNativeJqAsync`, or
`prepareBoxelRuntimeAsync`). Sync evaluators only have the eager formula core
unless the host explicitly registers the lazy library.

Use it for:

- formula fields
- form validation
- visible-when rules
- defaults and autofill
- local transforms over a JSON snapshot

Allowed examples:

```bxl
IF("Tax Rate" > 0, ROUND(Subtotal * "Tax Rate" / 100, 2), 0)
```

```bxl
SUM("Line Item"[* ."Taxable"]."Line Total")
```

```bxl
LET(limit, 10000, Amount > limit)
```

```bxl
.lineItems | map(.quantity * .unitPrice)
```

```bxl
def markedUp(x): x * 1.2; markedUp(Amount)
```

Restrictions: only the global BXL sandbox applies. BXL still cannot do I/O, mutate shared state, open files, call the network, or escape runtime budgets.

Invalid examples:

```bxl
fetch("https://api.example.com")
```

Invalid in every profile. BXL never performs network I/O. Application code should fetch external data first, then pass the resulting JSON into BXL as input or context.

```bxl
readFile("/etc/passwd")
```

Invalid because BXL cannot open files.

```bxl
def loop: loop; loop
```

Invalid because the runtime budget must halt unbounded recursion. `compute` has no extra profile subset, but it is still inside the global BXL sandbox.

## `policy`

`policy` is for bounded request-time authorization decisions. It is the right profile for checks that run inside a server request, where fail-closed behavior matters more than expression power.

Use it for:

- write gates
- mutation transition checks
- field redaction decisions
- request-time authorization predicates

Allowed examples:

```bxl
when(changedTo(Status, "Approved"),
  require("Director" IN @User.Roles, "Approvals require Director clearance.")
)
```

```bxl
@User.ID = Record.OwnerID
```

```bxl
when(changed(Salary), require("HR" IN @User.Roles, "Only HR can change salary."))
```

```bxl
($new.Amount // 0) - ($old.Amount // 0) < 5000
```

```bxl
LET(isDirector, "Director" IN @User.Roles, require(isDirector, "Director required."))
```

Restrictions:

- no user-defined `def` helpers
- no explicit `reduce` or `foreach`
- no recursive descent
- no jq assignment operators
- no jq `try` / `catch`
- no jq `label` / `break`
- no jq format filters such as `@csv`
- no aggregate or collection-scanning calls such as `SUM`, `COUNT`,
  `AVERAGE`, `NPV`, `IRR`, `T_TEST`, `Z_TEST`, `IMSUM`, or `IMPRODUCT`
- no error-masking calls such as `IFERROR` or `ISERROR`
- no volatile calls such as `RAND`, `RANDBETWEEN`, `NOW`, or `TODAY`
- no control, side-effect, or runtime metadata calls such as `debug`, `stderr`, `halt`, or `builtins`

Bounded scalar FormulaJS helpers remain allowed in `policy`, including lazy
extension functions such as `PMT`, `NORM_DIST`, `BESSELI`, and `BIN2DEC`.

Representative diagnostic:

```text
policy-aggregate-banned: Profile.policy is for bounded request-time authorization decisions and does not allow aggregate call SUM.
```

Invalid examples:

```bxl
SUM("Line Item"[* ."Taxable"]."Line Total") > 10000
```

Invalid because aggregate calls are not allowed in request-time authorization decisions.

```bxl
def isHr: "HR" IN @User.Roles; isHr
```

Invalid because `policy` does not allow user-defined helpers.

```bxl
try @User.Role catch "Guest"
```

Invalid because request-time authorization should fail closed instead of masking expression errors with jq `try` / `catch`.

```bxl
NPV(0.1, [100, 200]) > 0
```

Invalid because `NPV` scans a collection of cash flows, so it is classified as
an aggregate call for request-time authorization.

## `predicate`

`predicate` is for query-time boolean filtering. It is intentionally narrower than `policy`: it must reduce to a predicate that a query planner can understand. The public name is about intent, not implementation. A caller may translate this profile to SQL or another query language.

Use it for:

- row-level read filters
- search constraints
- list/search authorization filters

Allowed examples:

```bxl
OwnerID = @User.ID or Department IN @User.Departments
```

```bxl
Status = "Active"
```

```bxl
Status = "Active" and Department = @User.Department
```

```bxl
"Admin" IN @User.Roles or Department IN @User.Departments
```

```bxl
Tags | overlaps(@User.Clearances)
```

```bxl
Status IN ["Active", "Pending"]
```

```bxl
matches('"jwt verify" OR "token verification" -oauth')
```

```bxl
Amount // 0 >= 1000
```

```bxl
Amount + Tax > 1000
```

```bxl
Status LIKE "Act%"
```

`LIKE` uses SQL pattern wildcards inside the string. `"Act%"` means starts with `Act`, `"%ive"` means ends with `ive`, and `"%ct%"` means contains `ct`.

Restrictions:

- no user-defined `def` helpers
- no explicit `reduce` or `foreach`
- no recursive descent
- no jq assignment operators
- no jq `try` / `catch`
- no jq `label` / `break`
- no jq format filters such as `@csv`
- no local `as` bindings
- no iterator, slice, or dynamic-index paths
- only query-shaped operators: `and`, `or`, equality, inequality, comparison, arithmetic value expressions, `IN`, `BETWEEN`, `LIKE`, `IS`, and null coalescing
- only allowlisted calls such as `IN`, `overlaps`, `age`, `present`, `matches`, `between`, `like`, and `not`
- no mutation state contexts such as `$new` or `$old`

Excel and FormulaJS helpers, including lazy extension helpers such as `PMT`,
`NORM_DIST`, `BESSELI`, and `BIN2DEC`, are not valid in `predicate` unless a
future host-specific query planner explicitly adds a lowerable form for them.

Representative diagnostic:

```text
predicate-call-banned: Profile.predicate must compile to a query-time boolean predicate and cannot use call words.
```

Invalid examples:

```bxl
words(Description) > 500
```

Invalid because `words` is a runtime string helper, not a query predicate.

```bxl
1 as $limit | Amount > $limit
```

Invalid because local jq bindings are outside the query-shaped subset. Bind context before compiling the predicate instead.

```bxl
Description | contains("Carl")
```

Invalid in `predicate` because lowercase jq string helpers are compute-time functions, not guaranteed indexed query predicates. Use `Description LIKE "%Carl%"` for a field-scoped boolean string pattern, or `matches("Carl")` for corpus-level full-text search when the host planner supports it.

```bxl
PMT(0.08 / 12, 60, 25000, 0, 0) < 0
```

Invalid in `predicate` because FormulaJS financial math is not a query-shaped
operator that the portable SQL compiler can lower.

### SQL compilation

The compiler entry `compileBxlPredicateToSql()` validates the `predicate` profile, resolves readable labels, binds context values as parameters, and emits a SQL fragment.

```ts
const result = compileBxlPredicateToSql(
  'Department IN @User.Departments and matches("security review")',
  {
    schema,
    context: { User: { Departments: ['Finance', 'Legal'] } },
    pathToSql(path) {
      return `data #>> '{${path.parts.join(',')}}'`;
    },
  },
);

result.sql;
// ((data #>> '{department}') IN ($1, $2)) AND ...

result.params;
// ['Finance', 'Legal', 'security review']
```

See [`predicate-sql.md`](./predicate-sql.md) for the detailed SQL compiler contract and the pushdown sweet spots that remain in the profile.

## `derive`

`derive` is for deterministic headless write/index-time computation. It is the right profile for Boxel `computedVia` and other derived values that the platform may store, index, cache, or reuse on a later read path.

Unlike `predicate`, `derive` is allowed to compute values. Record-local aggregation is a primary use case. The important boundary is determinism: a derived value should come from the record snapshot, not from the current user, request, wall clock, runtime metadata, or an unbounded custom program.

Deterministic lazy FormulaJS helpers are allowed in `derive`, including
collection-scanning helpers such as `NPV` when the derived value is based only
on the record snapshot. Use an async runtime path if the expression may need a
lazy extension library.

Use it for:

- `computedVia`
- denormalized fields
- search facets
- cached derived fields
- index-time facts used by later queries

Allowed examples:

```bxl
Department
```

```bxl
[Department, Status]
```

```bxl
{"department": Department, "status": Status}
```

```bxl
if Status = "Active" then Department else null end
```

```bxl
Department = "Finance" and Status = "Active"
```

```bxl
SUM("Line Item"[* ."Taxable"]."Line Total")
```

```bxl
LET(total, SUM("Line Item"."Line Total"), total > 10000)
```

```bxl
IFERROR(Amount, 0)
```

```bxl
NPV(0.1, CashFlows)
```

Restrictions:

- no user-defined `def` helpers
- no explicit `reduce` or `foreach`
- no recursive descent
- no jq assignment operators
- no jq `try` / `catch`
- no jq `label` / `break`
- no jq format filters such as `@csv`
- no request, actor, mutation, or environment contexts such as `@User`, `@Env`, `$new`, or `$old`
- no volatile calls such as `RAND`, `RANDBETWEEN`, `NOW`, or `TODAY`
- no control, side-effect, or runtime metadata calls such as `debug`, `stderr`, `halt`, or `builtins`
- record-local arrays, filters, `LET`, Excel helpers, arithmetic, object/array shaping, and aggregate calls are allowed

Representative diagnostic:

```text
derive-call-banned: Profile.derive is for deterministic write/index-time computation and cannot use call RAND: volatile calls are not stable write-time derivations.
```

Invalid examples:

```bxl
RAND()
```

Invalid because a headless derived value must be stable across reindexing.

```bxl
@User.ID
```

Invalid because derived values should not depend on the current actor.

```bxl
debug
```

Invalid because runtime control, side-effect, and metadata helpers are outside the derivation contract.

## Attachments are not profiles

Attachments describe where an expression is used: `readAccess`, `fieldAccess`, `writeAccess`, `visibleWhen`, `constraint`, and so on. Profiles describe the execution contract. Keep those concepts separate.

For example, a `readAccess` attachment may use `predicate` when it is applied to a query, while a field-level `readAccess` attachment may use `policy` when it is evaluated post-fetch. Both are access-control use cases, but they run under different constraints.

## Storage and projection

Profiles validate the canonical AST. Human-readable display names are resolved before storage, so executable BXL should be stored with canonical field names, not display labels.

```bxl
SUM("Line Item"[* ."Taxable"]."Line Total")
```

stores as canonical field-key source:

```jq
SUM([.lineItems[] | select(.taxable).lineTotal])
```

The editor can reverse-project canonical field names back into current display labels without coupling security or query behavior to UI copy.
