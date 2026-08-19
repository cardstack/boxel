---
name: bxl-authoring
description: 'Use when writing or reviewing a BXL expression in a Boxel card — a computeVia built from expression(), the fx / jq tags, spreadsheet-formula fields, aggregations over linked or query-backed collections. Covers which tag to reach for, what the derive profile refuses outright, the silent traps (a stream where an aggregate was meant, jq interpolation in a plain string, & on a blank field, dates and "today"), and why an indexed computed can differ from the one the viewer sees. Activates on expression(, fx`…`, jq`…`, "BXL", "formula field", "computed field with Excel functions", "sum the linked cards".'
---

# Authoring BXL in a card

BXL is the workspace's expression language: readable spreadsheet syntax and Excel
formula libraries on top of a jq engine. In a card it drives `computeVia`.

```ts
import { expression, fx, jq } from '@cardstack/bxl';

export class Claim extends CardDef {
  @field paidAmount = contains(NumberField);
  @field reserveAmount = contains(NumberField);
  @field incurredAmount = contains(NumberField, {
    computeVia: expression(fx`ROUND((PaidAmount + ReserveAmount) * 100) / 100`),
  });
}
```

`@cardstack/bxl` is a platform module — the host serves it to card code, so the
bare specifier is the import. Only the package root is card-facing. `expression`
is the factory (`bxl` and `expr` are aliases); it compiles the source once when
the class body runs, then evaluates it against the card instance on each read.

The rest of this skill is the decision layer and the trap list. For the full
syntax surface — labels, row selectors, predicates, the Excel function matrix —
read [bxl.boxel.site](https://bxl.boxel.site).

## 1. Which tag

| Source contains                             | Reach for       | Why                                                    |
| ------------------------------------------- | --------------- | ------------------------------------------------------ |
| `\(…)` jq interpolation                     | `` jq`…` ``     | A plain string drops the backslash — see trap 4        |
| Excel functions (`ROUND`, `IFS`, `SUM`)     | `` fx`…` ``     | Readable-syntax compilation, explicit at the call site |
| Bare PascalCase field labels (`PaidAmount`) | `` fx`…` ``     | The compiler resolves them to `.paidAmount`            |
| Pure jq (`.claims \| length`)               | `` jq`…` ``     | Skips the readable-syntax compile step                 |
| Quoted multi-word labels (`"Line Item"`)    | `fx` + `schema` | Label resolution needs the schema — see trap 3         |

A plain string compiles exactly like `` fx`…` ``. Prefer a tag: it tells the next
reader which dialect they are in, and it is the only form that survives `\(…)`.

Mixing dialects inside one source is fine — `` fx`IF(.status == "Open", 1, 0)` ``
and `` fx`if Status == "Open" then 1 else 0 end` `` both work. Case is the
dispatch: `IF(cond, t, f)` is the Excel function, `if cond then … end` is the jq
construct.

## 2. The `derive` profile — what a computed may not do

`expression()` validates against the `derive` profile **when the field is
defined**, so a violation throws while the card module loads rather than
producing a wrong value. The diagnostic names the rule:

```text
computeVia expression violates the derive profile:
derive-call-banned: Profile.derive is for deterministic write/index-time
computation and cannot use call TODAY: volatile calls are not stable write-time
derivations.
```

Refused: volatile calls (`TODAY`, `NOW`, `RAND`, `RANDBETWEEN`) · request,
actor and mutation context (`@User`, `@Env`, `$new`, `$old`) · user-defined
`def` helpers · jq `try` / `catch` · `error` · `label` / `break` · assignment
(`=`, `|=`) · recursive descent (`..`) · format filters (`@csv`) · control and
side-effect calls (`debug`, `env`, `input`, `stderr`, `halt`) · runtime metadata
(`builtins`, `modulemeta`).

Allowed and useful: `IFERROR` / `IFNA` · optional access (`.a?`) · aggregates
(`SUM`, `AVERAGE`, `COUNT`, `NPV`) · validator helpers (`isEmail`) · `LET` ·
bindings (`. as $x | …`) · explicit folds (`reduce`, `foreach`) · structural ops
(`keys`, `to_entries`, `group_by`, `unique`, `tojson`).

The boundary is determinism: a derived value comes from the record snapshot, not
from the clock, the viewer, or the request. It is computed once server-side and
stored in the search doc, so anything ambient would bake one viewer's answer in
for everyone.

## 3. An aggregate needs a collected array, not a stream

**The single most expensive trap.** jq function arguments are streams, so
navigating into an array field and handing that straight to an aggregate calls
the aggregate once *per element* — and the field receives an array of per-element
results instead of one number. Nothing errors.

```ts
// WRONG — compiles to SUM(.claims[].paid); with two claims the field gets [10, 5]
computeVia: expression(fx`SUM(Claims[].Paid)`);

// RIGHT — collect first, then aggregate: 15
computeVia: expression(fx`SUM([Claims[].Paid])`);

// RIGHT — the jq spelling, with a fallback for the empty case
computeVia: expression(jq`[.claims[] | .paidAmount] | add // 0`);
```

Same for `AVERAGE`, `COUNT`, `MAX`, `MIN`, `SUMIF`. The rule: if the expression
contains `[]` or an iterating path, the aggregate's argument must be wrapped in
`[…]`.

Passing a `schema` is the other way to get this right — with field metadata, the
compiler collects implicitly, so `SUM("Line Item"."Line Total")` compiles to
`SUM([.lineItems[].lineTotal])`. Without a schema, quoted multi-word labels fail
loudly (`Cannot index string with string`) and bare PascalCase falls back to a
single-word camelCase path. A card gets no schema unless the expression passes
one.

Check the compiled jq when in doubt — the factory exposes it:

```ts
expression(fx`SUM([Claims[].Paid])`).bxl;
// { source, compiledSource: 'SUM([.claims[].paid])', warnings, deps, memoize }
```

## 4. `\(…)` in a plain string is silently inert

A JS string literal and an untagged template both drop the backslash before `(`,
so the runtime never sees the interpolation and the field renders the literal
text `(.bpSystolic)/(.bpDiastolic)`. No lint pass in a realm flags this.

```ts
// WRONG — yields "(.bpSystolic)/(.bpDiastolic)"
computeVia: expression('"\(.bpSystolic)/\(.bpDiastolic)"');

// RIGHT — the tag passes the raw source through
computeVia: expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`);
```

## 5. Blank inputs: what propagates, what absorbs

Missing and null operands are tolerated rather than fatal, which means a wrong
answer is quiet. The model, for a card whose numeric fields are unset:

| Expression                            | Result  | Reason                                      |
| ------------------------------------- | ------- | ------------------------------------------- |
| `` fx`Paid + Reserve` ``              | `null`  | null propagates through arithmetic          |
| `` fx`Paid + 5` ``                    | `5`     | a null addend contributes nothing           |
| `` fx`SUM(Paid, Reserve)` ``          | `0`     | aggregates skip blanks, Excel-style         |
| `` fx`ROUND(Paid + Reserve)` ``       | `0`     | `ROUND` absorbs null (and error sentinels)  |
| `` fx`Premium / 0` ``                 | `null`  | division by zero yields null, not `#DIV/0!` |
| `` jq`[.claims[] \| .paid] \| add` `` | `null`  | `add` over an empty array is null           |
| `` jq`.name \| startswith("a")` ``    | `false` | string predicates on null are false         |

Guard with `//`, the jq alternative operator: `(Paid // 0) + (Reserve // 0)`,
`add // 0`. Because division by zero produces null rather than an error,
`IFERROR` does **not** rescue it — guard the divisor instead.

**`&` renders a blank operand as the text `null`.** `` fx`Name & " (" & Tier &
")"` `` on a card with no tier yields `Acme (null)`. Write
`` fx`Name & " (" & (Tier // "") & ")"` ``, or use `CONCAT` / `TEXTJOIN`, which
drop blanks.

## 6. Excel error sentinels never crash the card

Sentinels (`#N/A`, `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`) are raised
as values inside evaluation and caught at the factory boundary, which returns
`null`. A failing formula leaves one blank field; it does not fail the card or
the realm's index pass.

Catch them deliberately when a fallback reads better than a blank:
`` fx`IFERROR(VLOOKUP(Sku, Rows, 2, FALSE), "unlisted")` ``,
`` fx`IFNA(NA(), "none")` ``. An `AVERAGE` over an empty collection raises
`#DIV/0!` and therefore lands as null.

## 7. Linked cards, query-backed inverses, and staleness

Paths traverse links, including several hops: `` jq`.policy.customer.name` ``
reads across two `linksTo` edges, and a missing hop anywhere yields null.

A query-backed `linksToMany` — the inverse side, derived from a filter rather
than stored on the card — behaves differently from a stored link, and this is
the part worth understanding before you aggregate over one:

- It resolves against the **live index at visit time**. On a realm's first index
  pass the index is still empty, so aggregates over the inverse bake in their
  empty-set values; the next visit of the aggregating card converges them.
- Only stored edges drive invalidation. Writing a `Claim` reindexes that claim;
  the `Policy` whose inverse contains it keeps the aggregate from its last visit
  until something revisits the policy. Aggregates over an inverse are eventually
  consistent by design.
- The browser resolves the inverse live during render, so the number a viewer
  sees can be the converged one while the indexed value — the one search filters
  and sorts on — is still from the last visit.

Guidance: aggregate over query-backed inverses for display and reporting; do not
treat such a field as a promptly-correct index-time fact, and do not build a
filter or sort that depends on it being current. When the aggregate must be
index-accurate, put the edge on the aggregating card (a stored `linksToMany`)
so a write to either side invalidates it.

## 8. Cyclic card graphs are safe but clipped

Card graphs are legitimately cyclic (a claim links to its policy, the policy's
inverse contains the claim); jq's data model is not. Re-entering a card already
on the traversal path yields a bounded `{ id }` reference — the same clip a
search doc applies — so `` jq`[.claims[] | .policy.id]` `` reads one id per
claim, and the policy's other fields read null from that direction. Structural operations
(`unique`, `tojson`, `==`) terminate and stay field-aware, comparing cards by
their materialized values.

Two consequences for data modeling:

- Read a value from the near side of a cycle, not by walking back across it. A
  claim reaching `.policy.annualPremium` is fine; a policy reaching
  `.claims[].policy.annualPremium` gets null.
- A computed whose program enumerates its own card (`tojson`, `keys`, `unique`
  over `.`) re-enters the field it is producing. That in-flight read is blank —
  the spreadsheet circular-reference surface — so the value comes out as if the
  field were empty rather than recursing.

## 9. Dates: serials are safe, "today" is not available

Indexing evaluates computeds server-side; a browser evaluates them in the
viewer's zone. Date functions are anchored so that they answer the same in
either place: `DATE`, `EDATE`, `EOMONTH`, `WEEKDAY`, `DATEVALUE`, `YEARFRAC`,
`DAYS`, `NETWORKDAYS` and friends give one answer across host zones. Serial
arithmetic and explicit Y/M/D construction are the safe idioms.

`TODAY` and `NOW` are not available in a computed at all — the `derive` profile
refuses them, because an indexed value computed once from the clock is wrong for
every later read. So:

- Compute the **fact**: a due-date serial, a span between two stored dates, a
  boolean over stored dates.
- Render the **relative phrase** in the component, where the viewer's clock and
  zone are the right ones. A computed that yields "3 days overdue" is a trap; one
  that yields the due-date serial and lets the template phrase it is not.
- If a card genuinely needs a local-time value, it belongs in the rendering
  layer. Anything indexed is computed once, server-side, for all viewers.

## 10. Memoization is per-instance and microtask-scoped

`expression()` caches its result per card instance until the current microtask
ends, which collapses the repeated synchronous reads a serialization or search
pass makes. Glimmer flushes re-renders synchronously at the end of an action, so
an action that **reads a formula and then writes one of that formula's inputs in
the same burst** paints once with the cached value. It heals on the next change
to that card. Write-only actions never see it.

Pass `memoize: false` for a formula an action reads before writing its inputs:

```ts
@field statusPanel = contains(PanelField, {
  computeVia: expression(jq`{ label: .status }`, {
    as: PanelField,
    memoize: false,
  }),
});
```

## 11. `{ as: FieldDef }` for structured output

An expression yields plain JSON. When the field's type is a `FieldDef`, pass
`as` so the value is rebuilt as an instance the serializer can identify — object
keys map to the field def's `@field` names, nested `contains` values materialize
as their own field-def instances, and each element of an array output gets the
same treatment. Scalars and null pass through untouched.

```ts
export class RiskBandField extends FieldDef {
  @field label = contains(StringField);
  @field score = contains(NumberField);
  @field flags = containsMany(StringField);
}

@field riskBand = contains(RiskBandField, {
  computeVia: expression(
    jq`{
      label: (if .lossRatio >= 0.8 then "High" else "Low" end),
      score: ((.lossRatio * 100) | round),
      flags: (if .lossRatio >= 0.8 then ["review"] else [] end)
    }`,
    { as: RiskBandField },
  ),
});

// containsMany — one materialized instance per element
@field claimBands = containsMany(RiskBandField, {
  computeVia: expression(
    jq`[.claims[] | { label: .severityBand, score: .paidAmount }]`,
    { as: RiskBandField },
  ),
});
```

Without `as`, a structured value reaches the serializer as an anonymous object
and fails to identify.

## Reviewing a card's BXL

1. Every aggregate's argument is wrapped in `[…]`.
2. Every `\(…)` source is `` jq`…` ``-tagged.
3. Every divisor and every `&` operand that can be blank is guarded.
4. No formula reads the clock; date output is a serial or a span, not a phrase.
5. Aggregates over query-backed inverses are display values, not filter or sort
   keys.
6. Structured output has `{ as: … }`.
7. A field whose indexed value is deliberately allowed to lag says so in a
   comment at the field.

## Where these rules are pinned

In `cardstack/boxel`, the behavior above is locked down by tests, which are the
place to check a detail or add a case:

- `packages/bxl/tests/boxel/authoring-skill-claims.ts` — this skill's own drift
  guard: for each claim above it asserts the snippet still appears in this file
  and still behaves as described. Editing an example here means editing that
  suite too.
- `packages/host/tests/helpers/cards/bxl-tracking.ts` — the worked example this
  skill draws on: an insurance domain exercising all three tags, linked and
  query-backed traversal, null tolerance, sentinels, and `{ as: … }`.
- `packages/host/tests/integration/bxl-expression-test.gts` — the factory on
  real cards, including the memoization contract.
- `packages/host/tests/integration/bxl-platform-module-test.gts` — the platform
  module end to end, and the query-backed first-pass/converge contract.
- `packages/host/tests/integration/bxl-cyclic-graph-test.gts` — the `{ id }`
  clip and structural operations across a cycle.
- `packages/bxl/tests/boxel/` — null tolerance, tag dispatch, the `\(…)`
  preservation rule, sentinel catching, and `as` materialization over plain
  objects.
- `packages/bxl/docs/` — `syntax-modes.md` (call-site modes), `profiles.md`
  (the `derive` contract), `formulas.md` (the Excel matrix),
  `realm-composition.md` (threading inputs into child field defs).

## Adjacent skills

- Query-backed `linksToMany` and inbound-reference lookups — `boxel-patterns`,
  pattern `automate-linked-to-me-lookup`.
- Field types, formats, and templates — `boxel`; silent-failure traps outside
  BXL — `boxel-workspace-cardinal-rules`.
- Why a card failed to index or holds broken links — `indexing-errors`.

The engine itself — the compiler, the jq runtime, the formula libraries, the
mutation and authorization profiles — is documented in `packages/bxl/docs/` and
is not this skill's subject.

The glossary's **bxl** and `computeVia: expression(...)` entries name
`library-bxl` and `extension-libs/bxl/` as their reference targets; this skill is
that reference.
