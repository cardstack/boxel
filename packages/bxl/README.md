<div align="center">

# BXL — Boxel Expression Language

**The language between data and code.**
Spreadsheet-style formulas over JSON. Paste-compatible with Excel. Sandboxed by construction. Small enough to live inside a JSON field — powerful enough to drive constraints, formulas, defaults, and workflow gates.

**Live site:** [**bxl.boxel.site**](https://bxl.boxel.site) &nbsp; · &nbsp; syntax reference, examples, docs — rendered

</div>

```bxl
"Line Item"[SKU = "BRAND-RED"]."Unit Price"          -- first-match predicate
SUM("Line Item"[* ."Taxable"]."Line Total")          -- SUMIF without the _BY
ROUND(Subtotal * "Tax Rate" / 100, 2) = "Tax Amount" -- paste from Excel, it runs
```

<div align="center">

**Looks like data** &nbsp; · &nbsp; serialized &nbsp; · &nbsp; diffable &nbsp; · &nbsp; catalog-shippable &nbsp; · &nbsp; reviewable &nbsp; · &nbsp; zero-setup

**Acts like code** &nbsp; · &nbsp; executes &nbsp; · &nbsp; typed &nbsp; · &nbsp; scoped &nbsp; · &nbsp; dependency-tracked &nbsp; · &nbsp; sandboxed

</div>

---

## What is BXL?

BXL is a small, safe expression language for computing over structured data. It's the formula bar your users already know, welded to jq's paths and pipelines, wrapped in a sandbox that refuses to do I/O.

**You author in BXL. The engine runs canonical jq, plus every Excel function you already know.** One evaluator, one AST, one canonical form — with a readable surface that reads like English when your schema has good display names.

```ts
evaluateBxl('ROUND(Subtotal * "Tax Rate" / 100, 2)', invoice, { schema });
// => 12.38
```

> The public API is intentionally unstable below 1.0: minor and patch versions may change syntax behavior. See [CHANGELOG.md](./CHANGELOG.md).

---

## Why BXL?

Every app has two kinds of logic. There's **code** — arbitrary, Turing-complete, deployed with seat belts loosened — and there's **data** — inert, schematized, shipped in configs and forms. Real applications need a third kind: something in between. Something a domain expert can author, git can diff, a catalog can ship, and a sandbox can trust.

BXL is that third kind, scoped deliberately. It's jq pipes plus Excel helpers — `SUM`, `ROUND`, `IF`, `VLOOKUP`, `XIRR` — plus familiar validator.js functions like `isEmail`, all evaluated against a JSON snapshot (the bare `.` is the current input, same as jq). It cannot fetch. It cannot write. It cannot call an LLM, open a file, or mutate shared state. Those four "cannots" are what let a platform embed BXL inside validation rules, computed fields, workflow gates, and query transforms without worrying that a schema author just drilled a hole into production.

If you've been stitching together Ajv + jq + Formula.js + a custom rule engine, BXL is what that stack looks like after it consolidates into a single dependency.

---

## Install

From npm:

```sh
npm install @cardstack/bxl
```

Releases go out under two dist-tags: `unstable`, published as changes land, and
`latest`, cut deliberately from one of those prereleases.
`npm install @cardstack/bxl@unstable` follows the former.

Inside this monorepo, depend on the workspace package instead:

```jsonc
// package.json
"dependencies": {
  "@cardstack/bxl": "workspace:*"
}
```

Requires Node `>=24`. The two forms differ in what they resolve to: the
published package serves compiled JavaScript with declarations, while the
workspace one serves the raw erasable TypeScript sources — Node runs those
directly via type stripping, and the host bundles them. Either way the imports
are the same. The default entry keeps heavyweight Formula.js dependencies in
lazy chunks; the `./linter` sub-entry gives editor tooling parser-only
diagnostics without the formula helpers.

---

## At a glance

The eight design decisions that make BXL feel the way it does:

- **Labels instead of paths** — `Subtotal + "Tax Amount"` beats `.subtotal + .taxAmount`. Labels resolve against a schema at compile time.
- **1-based rows** — `"Line Item"[#4]` is the fourth row. `[3]` remains the jq-native 0-based escape hatch.
- **Implicit iteration** — `"Line Item"."Line Total"` auto-materializes across the array. No `map` for the common case.
- **Two predicate shapes** — `[pred]` picks the first match (scalar). `[* .pred]` keeps every match (array) with explicit jq item scope. Predicate labels resolve against the row first and then the captured root, so `Book[Bidder = Intent.Bidder]` works without textual substitution.
- **One positional selector family** — `[#1]`, `[#first]`, `[#last]`, `[#last-1]`, `[#4..#last-3]`, `[#1, #2, #7..#9, #11]`, `[#odd]`, `[#even]`, `[#only]`. CSS inspired the readability; BXL keeps it all inside `[#...]`.
- **Paste Excel unchanged** — `=`, `<>`, `^`, `&`, leading `=` all work. `ROUND`, `SUM`, `IF`, `VLOOKUP` match Microsoft Excel exactly.
- **Source idioms are preserved** — `ROUND("Unit Price", 2)` is paste-compatible with Excel. `present(x)`, `when(p, q)`, `words(s)` are BXL-native. `isEmail(x)` and `isURL(x, options)` keep validator.js's familiar camelCase shape.
- **One sandbox, many surfaces** — the same language powers computed fields, form validation, visibility rules, workflow gates, access policies, and annotation targets.

The full reference with syntax-highlighted examples is at **[bxl.boxel.site](https://bxl.boxel.site)**, and in Markdown as [`docs/syntax-reference.md`](./docs/syntax-reference.md); the formal grammar lives in [`docs/grammar.ebnf`](./docs/grammar.ebnf).

## A tour of the syntax

One fixture, nine examples. Skim it to taste the language.

```ts
import { evaluateBxl } from '@cardstack/bxl';

// Schema: what fields exist, what humans call them.
const schema = {
  fields: [
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'taxRate', label: 'Tax Rate' },
    { key: 'taxAmount', label: 'Tax Amount' },
    { key: 'total', label: 'Total' },
    {
      key: 'lineItems',
      label: 'Line Item',
      kind: 'array',
      item: {
        fields: [
          { key: 'sku', label: 'SKU' },
          { key: 'quantity', label: 'Quantity' },
          { key: 'unitPrice', label: 'Unit Price' },
          { key: 'lineTotal', label: 'Line Total' },
          { key: 'taxable', label: 'Taxable' },
        ],
      },
    },
  ],
};

// Fixture: any JSON that matches the schema.
const invoice = {
  subtotal: 150,
  taxRate: 8.25,
  taxAmount: 12.38,
  total: 162.38,
  lineItems: [
    {
      sku: 'COPY-01',
      quantity: 1,
      unitPrice: 50,
      lineTotal: 50,
      taxable: true,
    },
    {
      sku: 'BRAND-RED',
      quantity: 5,
      unitPrice: 20,
      lineTotal: 100,
      taxable: false,
    },
  ],
};
```

```ts
// 1 · Labels replace paths
evaluateBxl('Subtotal + "Tax Amount"', invoice, { schema });
// => 162.38

// 2 · 1-based rows
evaluateBxl('"Line Item"[#2].SKU', invoice, { schema });
// => 'BRAND-RED'

// 3 · Implicit iteration — SUM across rows
evaluateBxl('SUM("Line Item"."Line Total")', invoice, { schema });
// => 150

// 4 · First-match predicate — the VLOOKUP shape
evaluateBxl('"Line Item"[SKU = "BRAND-RED"]."Unit Price"', invoice, { schema });
// => 20

// 5 · Filter-all predicate — the SUMIF shape
evaluateBxl('SUM("Line Item"[* ."Taxable"]."Line Total")', invoice, { schema });
// => 50  (only the taxable row)

// 6 · Positional selectors
evaluateBxl('"Line Item"[#first].SKU', invoice, { schema }); // => 'COPY-01'
evaluateBxl('"Line Item"[#last].Quantity', invoice, { schema }); // => 5
evaluateBxl('"Line Item"[#last-1]."Unit Price"', invoice, { schema }); // => 20

// 7 · Paste Excel unchanged
evaluateBxl(
  '=IF("Tax Rate" > 0, ROUND(Subtotal * "Tax Rate" / 100, 2), 0)',
  invoice,
  { schema },
);
// => 12.38

// 8 · Invariants — "if this applies, then this must hold"
evaluateBxl('when(Subtotal > 0, Total = Subtotal + "Tax Amount")', invoice, {
  schema,
});
// => true

// 9 · Presence — form-friendly vs Excel-strict
evaluateBxl('present("Tax Amount")', invoice, { schema }); // => true
evaluateBxl('NOT ISBLANK("Tax Amount")', invoice, { schema }); // => true (Excel semantics)
```

---

## Where BXL earns its keep

BXL is evaluated from eight distinct positions in a typical application. Each uses the same parser, the same dependency tracker, and the same sandbox — so a field constraint, a workflow gate, and a reactive predicate all share a vocabulary the author learns once.

| Position                 | What it does                   | Example                                                       |
| ------------------------ | ------------------------------ | ------------------------------------------------------------- |
| **Formula field**        | Computed value on a record     | `SUM("Line Item"."Line Total")`                               |
| **Constraint**           | Validation rule with a message | `"End Date" > "Start Date"`                                   |
| **Visible-when**         | Conditional field rendering    | `Status = "in-review"`                                        |
| **Autofill / default**   | Computed initial value         | `slugify(Title)`                                              |
| **Workflow gate**        | Advance condition              | `all(Steps[…]; Status = "done")`                              |
| **Notification trigger** | Fire when threshold crossed    | `"Budget Remaining" < 1000`                                   |
| **Reactive predicate**   | Watch-and-fire rule            | `age("Last Heartbeat") > DURATION("60s")`                     |
| **Query transform**      | Bulk derivation over an array  | <code>"Line Item" &#124; map(Quantity \* "Unit Price")</code> |

For server-scale lists, keep retrieval and processing separate: the host query language owns filtering, search relevance, ordering, and pagination; BXL processes the bounded JSON result that comes back. See [Query Then Process](./docs/query-then-process.md) for the pattern, including a Boxel query example, an illustrative PostgreSQL JSONB lowering, and a BXL process step using Excel functions.

### Where expressions live — three layers, one rule each

BXL is one of three layers where logic lives in a typical application. Each layer has different constraints, different audit characteristics, and different change cycles.

- **BXL expressions** — logic that is _data_: constraints, formulas, predicates, defaults, visibility, transforms. Stored as strings, shipped alongside records, editable at runtime without a redeploy.
- **Class methods and computed properties** — logic that is _code compiled with the type_: getters, `@computed` columns on an ORM model, derived fields declared on a class. Ships with the module; changes require a redeploy.
- **Application code with side effects** — controllers, handlers, services: writes, deletes, network calls, LLM invocations, external APIs. Full language power, attributable, auditable.

One-line rule: **BXL for logic-as-data · class methods for logic-as-type · application code for changes-to-the-world.** Derive-mode BXL never writes; Mutation BXL can describe a write-set, but only the host may authorize and commit it. Application code never embeds in records. When in doubt, ask _"could a stranger run this expression a million times against my data?"_ — if yes, it's BXL; if no, it's application code.

### User-defined helpers live inside the expression

An expression can open with its own named helpers — BXL inherits jq's `def`. Because user helpers aren't from Excel, they follow the lowercase convention (`UPPERCASE` stays reserved for paste-compatible Excel functions):

```bxl
def band(n): if n >= 90 then "high" elif n >= 70 then "medium" else "low" end;
def triple(x): x * 3;

{
  band:    band(.score),
  tripled: triple(.score),
  total:   SUM([.items[].price])
}
```

Call sites are indistinguishable from built-ins — `band(.score)` sits next to `SUM(...)` with no syntactic ceremony. Recursion works (`def fact: if . <= 1 then 1 else . * (. - 1 | fact) end`). There's no module system: a BXL expression is a self-contained, serializable piece of data, and helpers are scoped to the expression that defines them. If a helper earns its way into every record, lift it into the built-in library instead of duplicating the `def`.

See the [User-defined helpers](docs/syntax-reference.md#user-defined-helpers-def) section of the syntax reference for multi-arg and zero-arg forms.

---

## One example, many jobs

A single form definition typically exercises several of the 8 positions at once. Every BXL fragment below is just a string inside a standard data object — nothing special, no build step, diffable in code review, parseable without the evaluator.

```ts
// In a form definition:
export const donationForm = {
  name: 'Donation',
  fields: [
    { key: 'firstName', label: 'First Name', required: true },
    { key: 'lastName', label: 'Last Name', required: true },

    {
      key: 'email',
      label: 'Email',
      validate: [{ expr: 'isEmail(Email)', message: 'Must be a valid email' }],
    },
    {
      key: 'phone',
      label: 'Phone',
      validate: [
        {
          expr: 'isMobilePhone(Phone, "en-US", {strictMode:true})',
          message: 'Must be a valid US mobile number',
        },
      ],
    },
    {
      key: 'website',
      label: 'Website',
      validate: [
        {
          expr: 'isURL(Website, {require_protocol:true})',
          message: 'Website must include http:// or https://',
        },
      ],
    },

    {
      key: 'amount',
      label: 'Donation Amount',
      type: 'number',
      validate: [
        { expr: '"Donation Amount" > 0', message: 'Amount must be positive' },
      ],
    },

    // Visible-when: only show employer field for gifts over the match threshold
    {
      key: 'employer',
      label: 'Employer',
      visibleWhen: '"Donation Amount" >= 250',
    },

    // Conditional default: prefill matching program IF employer is filled
    {
      key: 'matchingProgram',
      label: 'Matching Program',
      visibleWhen: 'present(Employer)',
      defaultFrom: 'Employer."Matching Program"',
    },

    { key: 'recurring', label: 'Make Recurring', type: 'boolean' },
    { key: 'paymentMethod', label: 'Payment Method', visibleWhen: 'Recurring' },

    // Computed field: total annual gift via IF branching
    {
      key: 'totalAnnual',
      label: 'Total Annual Gift',
      computedVia: 'IF(Recurring, "Donation Amount" * 12, "Donation Amount")',
    },
  ],

  // Record-level constraints — run on save, cross-field
  constraints: [
    {
      expr: 'when(Recurring, present("Payment Method"))',
      message: 'Recurring donations require a payment method on file',
    },

    {
      expr: 'when(present("Matching Program"), "Donation Amount" >= "Matching Program"."Minimum")',
      message: 'Gift below employer matching minimum',
    },
  ],
};
```

Every expression above fires at a different point in the form's lifecycle, and each maps to one row of the 8-position grid:

- `isEmail(Email)` · `isMobilePhone(Phone, "en-US", {strictMode:true})` · `isURL(Website, {require_protocol:true})` · `"Donation Amount" > 0` → **constraint**, per-field on input
- `"Donation Amount" >= 250` · `present(Employer)` · `Recurring` → **visible-when**, recalculated as other fields change
- `Employer."Matching Program"` → **autofill / default**, applied on field focus or record load
- `IF(Recurring, "Donation Amount" * 12, "Donation Amount")` → **formula field**, recomputed on every change
- `when(Recurring, present("Payment Method"))` and the matching-minimum rule → **record-level constraint**, run on save with cross-field access

Same string language everywhere. Each slot in the object is a plain string; the compiler parses them with the same grammar, resolves labels against the same schema, and evaluates them in the same sandbox. The container object's shape (`fields[].validate[]`, `fields[].visibleWhen`, etc.) is up to your framework — BXL is agnostic to that; it only parses the expression strings inside.

### Using BXL inside Boxel

In Boxel realms, import the compute factory and syntax tags from the uploaded
bundle, then assign the returned function to `computeVia`:

```ts
import { expression, fx, jq } from '../bxl';

@field subtotal = contains(NumberField, {
  computeVia: expression(fx`SUM("Line Item".Amount)`),
});

@field slug = contains(StringField, {
  computeVia: expression(jq`.title | ascii_downcase`),
});

@field tax = contains(NumberField, {
  computeVia: expression('ROUND(Subtotal * TaxRate / 100, 2)'),
});
```

No tag and `fx` both mean readable BXL. `jq` means plain jq. `{ as:
SomeFieldDef }` is optional, but useful when a structured result should be
materialized as a more specific FieldDef subclass for Boxel rendering, e.g.
`contains(RegularStatusField, { computeVia: expression(..., { as:
IcuStatusField }) })`. See [syntax modes](./docs/syntax-modes.md) for the
short version of the rules.

`expression()` validates the source against the `derive` execution profile
when the factory is constructed. That keeps Boxel `computeVia` deterministic:
volatile calls (`NOW`, `RAND`, `now`), request/mutation context (`@User`,
`$new`, `$old`), authored jq `try` / `catch`, `def`, `error`, and runtime
metadata helpers are rejected before the field can run. `evaluateBxl` remains
the full compute surface for ad-hoc tooling unless you explicitly ask for a
profile.

### Linked cards, cycles, and bounded references

A card graph is legitimately cyclic — a Claim links to a Policy whose
query-backed `claims` contains that same Claim — while jq's data model is
JSON: acyclic by construction. `expression()` bridges the two by handing the
program a **lazy, cycle-guarded view** of the card:

- **Path access is lazy.** `.claims[0].paidAmount` reads the fields it
  names, plus each traversed card's `id` — the cycle guard consults it —
  and nothing else on the graph is touched or computed.
- **Re-entry clips to a bounded reference.** When a walk reaches a value
  already on its own traversal path, it reads as `{ id }` instead of
  recursing — the same clip the platform's `queryableValue` applies when
  it builds search docs. Cards clip by object identity _and_ by id, since
  query resolution can hand back a fresh instance of a visited card;
  ordinary JSON clips by identity alone, so an `id` value that happens to
  equal a card's never masks data. So from a Policy, `.claims[0].policy`
  is `{ id: <the policy's own id> }`: its `.id` is reachable, every other
  field on it reads as `null`.
- **Structural operations see fields.** `unique`, `group_by`, `==`, `keys`,
  `to_entries`, `tojson` enumerate a card's field map on demand, with
  cycles clipped as above — two distinct claims stay distinct, and
  serializing across a cycle terminates with the bounded reference
  embedded where the walk looped. This enumeration is deliberately
  broader than `queryableValue`'s search-doc walk (which skips
  query-backed fields): it reads every field — computeds and query-backed
  inverses included, through live field reads — because those are exactly
  what BXL aggregation formulas consume.
- **Sibling references materialize fully.** The clip applies only to true
  re-entry along one path. Two claims sharing a customer each read that
  customer in full — a diamond is not a cycle.
- **Backstops.** Graphs nested deeper than 256 hops fail fast with a clear
  error, and materialization hops count toward the runtime step/time
  budget, so no expression can churn unboundedly no matter the shape of
  the graph.

Program outputs are plain values from the raw graph — an expression that
returns `.claims` hands back the real linked instances, not the lazy view.

---

## Comparisons & inspirations

BXL doesn't invent much. It pulls ideas from eight expression languages that were already solving pieces of the same problem, and adds a readable surface that lets them coexist in one runtime.

Credit and attribution below; pick whichever section describes the language you already know.

### 1 · Excel · paste-compatible where it matters

The "XL" in BXL is earned. 300+ Excel helpers — sourced from [Formula.js](https://github.com/formulajs/formulajs) (MIT) and wired into the jq runtime as native functions — ship with matching Microsoft Excel semantics. Paste `=IF(…)` from a spreadsheet and it runs unchanged. Current row is the bare `.` (a lone dot, same as jq) instead of `A1`; columns are field names instead of column letters. Larger FormulaJS families, including statistical distributions, Bessel functions, financial formulas, and engineering helpers, lazy-load in async runtimes only when an expression references them. Validator.js functions such as `isEmail`, `isURL`, and `isUUID` follow the same lazy-loading model while preserving validator.js's familiar call shape.

```
Excel:  =ROUND(B2 * C2 / 100, 2)
BXL:    ROUND(Subtotal * "Tax Rate" / 100, 2)
```

BXL intentionally does not implement Excel database functions (`DAVERAGE`, `DCOUNT`, `DSUM`, …), grid-reference functions (`ROW`, `COLUMN`, `SUBTOTAL`, `AGGREGATE`), matrix helpers (`MMULT`, `MUNIT`), or regression array functions (`LINEST`, `LOGEST`, `GROWTH`, `TREND`). Those assume a spreadsheet grid, criteria ranges, or array-returning analysis shapes that don't translate cleanly onto JSON. Everything that does translate is either eager or available as a lazy async extension.

### 2 · jq · every valid jq is valid BXL

[jq-tools](https://github.com/alexxander/jq-tools) (MIT) is the actual runtime. BXL compiles to canonical jq before execution; the evaluator doesn't know or care whether you wrote `.lineItems[0].sku` or `"Line Item"[#1].SKU`. The Excel helpers are added as regular jq functions via jq's native extension mechanism — no parser fork, no runtime fork.

```
jq:   .lineItems | map(select(.taxable)) | map(.lineTotal) | add
BXL:  SUM("Line Item"[* ."Taxable"]."Line Total")
```

If you already know jq, you already know BXL. If you don't, every pipeline jq supports still works — BXL just gives you a readable shortcut when a schema is available.

**One rule about labels and pipes.** At the top level, readable labels (`"Line Item"`, `"Bill To".Name`, `Subtotal`) resolve against the root record. Inside a predicate or item-producing pipe stage (`map`, `select`, `sort_by`, `any`, `all`), a readable label resolves against the current item first and falls back to the captured root. Thus `Book[Bidder = Intent.Bidder]` and `Book[all] | map({ bidder: Bidder, requested: Intent.Bidder })` are both root-safe. jq-native `.sku` still explicitly means the current item, and `$root` remains available in hand-written jq.

When a schema-known object or array item is followed by an unknown member, compilation fails with `ReadableSyntaxError` instead of emitting a path that silently returns `null`. At evaluation time, input keys that differ from schema keys only by casing produce an `input-key-casing-mismatch` warning in the result.

### 3 · XPath · tree paths with predicates

XPath normalized a compact notation for walking typed trees: dot-separated names for fields, brackets for predicates, and concise positional navigation. BXL borrows the mental model and drops the axis specifiers (`/`, `//`, `@`) — there's no need for them on JSON.

```
XPath:  /invoice/lineItem[sku='BRAND-RED']/unitPrice
BXL:    "Line Item"[SKU = "BRAND-RED"]."Unit Price"
```

### 4 · XQuery · a small debt to FLWOR thinking

XQuery (W3C) showed that a query grammar can grow into a full expression language — let-bindings, conditionals, sequence composition, and data reshape — without bolting on a separate scripting layer. BXL stays smaller (no FLWOR keywords, no XML schema types, no modules) but adopts the same premise: one language should cover computation _and_ reshape, not just lookup.

FLWOR is XQuery's five-clause expression: **F**or (iterate) · **L**et (bind) · **W**here (filter) · **O**rder by (sort) · **R**eturn (shape).

**Filter and aggregate:**

```xquery
XQuery:  sum(for $li in $invoice/lineItem
             where $li/taxable = "true"
             return $li/lineTotal)
```

```bxl
BXL:     SUM("Line Item"[* ."Taxable"]."Line Total")
```

Four lines of FLWOR compress into one BXL expression. FLWOR is more explicit about each step; BXL is more compact because implicit iteration and predicate-indexed arrays do the work silently.

**Reshape into a new data shape:**

```xquery
XQuery:
<summary id="{$inv/@id}">
  <customer>{ $inv/billTo/name/text() }</customer>
  <subtotal>{ sum($inv/lineItem/lineTotal) }</subtotal>
  <top-items>{
    for $li in $inv/lineItem                          (: F · for each line item :)
    let $total := $li/lineTotal                       (: L · let :)
    where $total > 0                                  (: W · where positive :)
    order by $total descending                        (: O · order by (desc) :)
    return <item sku="{$li/@sku}" total="{$total}"/>  (: R · return shape :)
  }</top-items>
</summary>
```

```bxl
BXL (jq, plus SUM from the Excel layer):
. as $inv |                                       # bind root (XQuery's $inv)
{
  id:         $inv.id,
  customer:   $inv.billTo.name,
  subtotal:   SUM([$inv.lineItem[].lineTotal]),
  top_items:  [ $inv.lineItem[]                   # F · for each line item
                | .lineTotal as $total            # L · let
                | select($total > 0)              # W · where positive
                | {sku: .sku, total: $total} ]    # R · return shape
              | sort_by(.total) | reverse         # O · order by (desc)
}
```

This port is almost entirely jq — `. as $inv | {...}`, `.lineItem[]`, `as $total`, `select`, `sort_by` are all stock jq; only `SUM(...)` is borrowed from BXL's Excel layer (pure jq would write `add` instead). BXL inherits jq's `#` line comments and `as $var` bindings, so each FLWOR clause has a line-for-line twin. Iteration and `return` sit inside the `[ ... ]` comprehension; `order by` applies to the collected list after. (Readable Excel-style labels like `"Line Item"` are available too — see §2 — but this example stays in jq flavor for XQuery parity.)

XQuery constructs XML trees element-by-element, with templating inline. BXL constructs JSON objects with native object-literal syntax. Different output shapes, same premise: one language for both querying and reshaping. (Note the convention from §2: readable labels at the top level, jq-native `.path` inside pipe stages like `map`, `select`, and `sort_by`.)

### 5 · Schematron · the validation-rule shape, newly relevant

Schematron (ISO/IEC 19757-3) is the standard for rule-based tree validation: match a pattern, assert a condition, emit a message. Unlike grammar-based validators like XSD, Schematron checks _relationships between values_ — "if this, then that" — using XPath expressions against the document tree.

It's been quietly important since 2006, and it's back in focus because of how LLMs change the shape of incoming data. As generative tooling produces more loosely-structured documents — free-text forms filled in by an agent, invoice JSON pulled from a receipt OCR, a draft contract authored by a model — validation moves later in the pipeline. A fixed schema catches missing fields; a rule language catches _things that should be true but aren't_.

BXL's validation surface reuses Schematron's shape — a rule is a boolean expression with an attached message — but the rules sit inline in form schemas and data-model definitions rather than a separate XML document.

```xml
Schematron:  <assert test="total = sum(lineItem/lineTotal)">Total mismatch</assert>
```

```ts
BXL:         { expr: 'Total = SUM("Line Item"."Line Total")',
               message: 'Total mismatch' }
```

Same pattern, JSON-native, runs in the same sandbox as your formulas.

### 6 · CSS · selector readability, not selector syntax

BXL still owes CSS a debt, but it is now conceptual rather than grammatical. CSS proved that position-oriented collection access can be readable. BXL keeps that spirit, but collapses everything into one positional selector family inside brackets instead of preserving CSS pseudo-class spellings.

```
CSS:  tr:first-child, tr:last-child, tr:nth-child(2n+1)
BXL:  "Line Item"[#first], "Line Item"[#last], "Line Item"[#odd], "Line Item"[#1, #2, #7..#9, #11]
```

That's most of the debt. CSS is otherwise a different _kind_ of language — a styling rule engine that runs against the DOM to produce rendered boxes, not a general expression language:

- `calc()`, `clamp()`, `attr()` compute values, but only CSS-legal typed values (lengths, numbers, colors) for layout. You can't propagate the result into business logic.
- `:invalid`, `:required`, `:user-invalid` _react_ to validation state defined in HTML attributes or JavaScript; CSS doesn't author the rules.
- `var(--x, fallback)` + the cascade resolve a property by lookup-with-fallback, not by expression-level branching.
- `counter()` and `:has()` walk the tree for rendering; they don't aggregate values in any arithmetic sense.

CSS is genuinely sandboxed — it can't fetch, mutate, or call arbitrary code, and the web depends on that — but "sandboxed styling rules" isn't the same category as "sandboxed expression language." BXL borrows the readability lesson, not the pseudo-class grammar.

### 7 · JSONata · the closest living peer

[JSONata](https://jsonata.org) (MIT, IBM + community) is a full expression language over JSON, built for the same job BXL is aimed at: embed in config, evaluate sandboxed, transform and validate data. It's widely used in low-code platforms — node-RED, OpenEPCIS, several integration tools. If you've already picked JSONata and it's working, most of this README's pitch is already solved for you.

```
JSONata:  $sum(lineItems[taxable].lineTotal)
BXL:      SUM("Line Item"[* ."Taxable"]."Line Total")
```

The differences, honestly:

- **JSONata** has its own evaluator, its own path grammar, and its own function library. BXL has jq underneath and Formula.js wired in, which means `VLOOKUP`, `XIRR`, `ROMAN`, and 300+ other Excel helpers use Excel semantics; heavier FormulaJS families auto-load on async runtime paths.
- **JSONata** uses raw key paths (`lineItems.lineTotal`); BXL resolves quoted display-name labels (`"Line Item"."Line Total"`) against a schema.
- **JSONata** doesn't accept pasted Excel formulas; BXL does.

Pick JSONata when your authors are engineers and your data is already JSON-shaped. Pick BXL when your authors think in Excel formulas and display names, and when the data-processing pipe story matters (because jq is right there).

### 8 · CEL · policy-language credentials

[CEL (Common Expression Language)](https://cel.dev) is Google's sandboxed embeddable expression language. Apache-2.0, production-deployed in Kubernetes admission control, Google Cloud IAM conditions, Firebase Security Rules, AIP policies, Envoy's RBAC filter — roughly "the sandbox expression language of record" in cloud infrastructure. Syntax reads JS-ish; semantics are strictly sandboxed.

```
CEL:  has(request.auth.claims.role) && request.auth.claims.role == "admin"
BXL:  NOT ISBLANK(Request.Auth.Claims.Role) and Request.Auth.Claims.Role = "admin"
```

(CEL's `has()` tests whether a field is _set_ — null-only. BXL's exact match is `NOT ISBLANK(x)`. BXL's `present(x)` is stricter — null _or_ empty string — which is usually what you want on a form, not on an auth claim.)

CEL is stronger than BXL at pure policy and authorization — its type system is designed for predicate evaluation and its tooling is mature. BXL is stronger at the spreadsheet side of the house (Excel paste, formula helpers, the VLOOKUP-shape predicate). The two share a philosophical parent: a tiny, safe, embeddable DSL beats a general-purpose sandbox every time.

Different readership. If you're building an authorization layer, look at CEL first. If you're building a business app with computed fields and validation rules near the user, BXL is closer.

---

### Plain JavaScript · the baseline

For the common case — map / filter / reduce over an array — BXL is a shorter spelling. For everything else, BXL adds validation with attached messages, a sandbox, and serializability as data.

```js
invoice.lineItems
  .filter((li) => li.taxable)
  .reduce((sum, li) => sum + li.lineTotal, 0);
```

```bxl
SUM("Line Item"[* ."Taxable"]."Line Total")
```

Both answer the same question. The JS version has `fetch` and `process.env` in scope and runs inside your server bundle; the BXL version refuses I/O by construction and serializes as data. Different tools for different distances from user-authored input — neither replaces the other.

### Coverage across common jobs

Each language above is strong at one or two of the jobs a typical business app needs — validation, computed fields, data processing, conditional defaults, storage as data. No single one covers the whole set.

| Role                                  | Excel | jq  | XPath | XQuery | Schematron | CSS | JSONata | CEL | JS  | BXL |
| ------------------------------------- | :---: | :-: | :---: | :----: | :--------: | :-: | :-----: | :-: | :-: | :-: |
| Validation rules + messages           |  🟡   | ⚪  |  ⚪   |   ⚪   |     🟢     |  —  |   ⚪    | 🟢  | 🟡  | 🟢  |
| Computed / formula fields             |  🟢   | 🟡  |  🟡   |   🟡   |     —      | ⚪  |   🟢    | 🟡  | 🟡  | 🟢  |
| Data processing / aggregation         |  ⚪   | 🟢  |  🟡   |   🟢   |     —      |  —  |   🟢    | 🟡  | 🟡  | 🟢  |
| Streaming over huge inputs            |  ⚪   | 🟢  |  🟡   |   🟢   |     ⚪     |  —  |   ⚪    | ⚪  | 🟡  | 🟡  |
| Descendant + ancestor tree nav        |   —   | 🟡  |  🟢   |   🟢   |     🟢     | 🟡  |   🟡    |  —  | ⚪  | 🟡  |
| User-defined functions / recursion    |  🟡   | 🟢  |  ⚪   |   🟢   |     —      |  —  |   🟡    | ⚪  | 🟢  | 🟢  |
| Modules / code reuse across files     |  ⚪   | 🟡  |   —   |   🟢   |     🟡     | 🟡  |   ⚪    | ⚪  | 🟢  |  —  |
| Conditional defaults                  |  🟡   | 🟡  |  🟡   |   🟡   |     —      | 🟡  |   🟡    | 🟡  | 🟡  | 🟢  |
| Sandbox by default (no I/O)           |  🟢   | 🟢  |  🟢   |   🟡   |     🟢     | 🟢  |   🟢    | 🟢  |  —  | 🟢  |
| Readable to non-engineers             |  🟢   |  —  |   —   |   —    |     —      | ⚪  |   ⚪    | ⚪  |  —  | 🟢  |
| Paste from spreadsheet                |  🟢   |  —  |   —   |   —    |     —      |  —  |    —    |  —  |  —  | 🟢  |
| Works on JSON natively                |   —   | 🟢  |   —   |   —    |     —      |  —  |   🟢    | 🟡  | 🟢  | 🟢  |
| Embeds in JSON as data (serializable) |  🟡   | 🟢  |  🟡   |   🟡   |     ⚪     | 🟡  |   🟢    | 🟢  | ⚪  | 🟢  |
| One language across every job         |  ⚪   | 🟡  |  ⚪   |   🟡   |     —      |  —  |   🟡    | 🟡  | 🟢  | 🟢  |

🟢 strong &nbsp;·&nbsp; 🟡 ok / partial &nbsp;·&nbsp; ⚪ weak &nbsp;·&nbsp; — none

BXL didn't invent any row. It's the smallest language that covers the everyday-business rows at once — validation, computed fields, data processing, defaults, readability, paste-from-spreadsheet — by composing the wins of the ones that came before. User-defined functions coexist with the Excel layer: `def score_band(n): ...; score_band(91)` sits next to `SUM(...)` in the same expression, so custom helpers feel like first-class BXL calls. The XPath-family specialties (ancestor axes, upward tree walking) stay specialties: BXL traverses _down_ into nested data via jq's `..`, but it doesn't carry a `parent::` axis. Streaming over huge inputs inherits what jq offers (lazy enough in practice, but not BXL-level streaming), and there is no module system — BXL is one expression, not a programming environment.

For a typical business record — invoices, offers, contracts, forms, tickets, events, reports — the common rows in that table are real daily requirements. BXL covers them with one parser, one evaluator, and one sandbox.

---

## Security model

BXL is a **data sandbox**, not an OS sandbox. Expressions compute over a supplied JSON snapshot and return values. They do not escape.

### What BXL will never do

Not warnings. Enforced by the evaluator at parse or at runtime:

- **No side effects.** Even Mutation BXL returns an inert write plan; it does not commit writes, deletes, or messages.
- **No network.** No `fetch`, no external APIs, no URLs opened.
- **No LLM calls.** Those live in your application code, one layer up.
- **No unbounded loops.** Op budget + wall-clock ceiling → `#LIMIT!` error.
- **No closures or shared state.** Same input, same data, same result — always.
- **No direct storage mutation.** BXL reads a snapshot and returns a value or plan; trusted application code authorizes and commits it.

These six guarantees are what let the platform embed BXL inside Guides, workflows, notifications, and queries without worrying that a schema author just drilled a hole into production.

### Runtime knobs

- **Budgets on by default** — step count, output count, output bytes, wall-clock. Hosts tighten via `runtimeLimits`.
- **Deterministic** — no clock or random unless the host injects them.
- **Worker-safe** — for hard memory ceilings or non-cooperative cancellation, run BXL in a Worker or isolate and terminate from the host.

See [`docs/profiles.md`](./docs/profiles.md) for the per-profile execution contract.

---

## Execution profiles

BXL is deliberately expressive. In the full language you can use readable field labels, jq paths and pipes, Excel functions, local bindings, conditionals, user-defined helpers, and jq's collection operators. That is the right contract for formulas, transforms, and local computation over a JSON snapshot.

The objection is also fair: a language that can do all of that should not be accepted unchanged in every execution surface. A query planner cannot run arbitrary string transforms. A request-time authorization check should not run a custom recursive helper. A write/index-time derivation should produce stable facts, not depend on unbounded runtime behavior.

Profiles are the practical answer. BXL stays one language and one AST, but hosts can validate a strict subset for the place where the expression will run. The full language remains available where full computation is appropriate; narrower profiles reject expressions that exceed their execution contract before they become runtime surprises.

| Profile         | Intent                                   | Typical use                                                                                  | What the subset protects                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compute`       | Full browser/local value computation     | formulas, transforms, UI validation, query transforms                                        | Preserves the current BXL contract: readable jq plus Excel helpers and validator.js functions, including lazy extensions on async runtime paths.                                                                                                                      |
| `policy`        | Bounded request-time authorization       | write gates, field redaction decisions                                                       | Keeps request checks deterministic and fail-closed; allows bounded scalar helpers but rejects aggregate and collection-scanning calls.                                                                                                                                |
| `authorization` | Bounded relationship-graph authorization | OpenFGA-semantic rewrites, BXL authorization capability rules                                | Extends `policy` only with compiler-lowered graph forms such as `direct`, `userset`, `userset_from`, and `except`.                                                                                                                                                    |
| `predicate`     | Query-time boolean filtering             | row-level read filters, search constraints                                                   | Requires a query-shaped boolean predicate; rejects transforms, runtime-only helpers, validator.js functions, and non-lowerable FormulaJS calls unless a host explicitly lowers them.                                                                                  |
| `derive`        | Headless write/index-time computation    | `computeVia`, denormalized fields, search facets                                             | Allows deterministic record-local Excel/jq computation, including lazy extensions and aggregation, while rejecting request context and volatile runtime behavior.                                                                                                     |
| `mutation`      | Bounded single-Card DML planning         | `updateCard` tool calls, streaming edits, atomic field changes, and collection rearrangement | Resolves readable, schema-known locations against one loaded Card or Field and produces a pure mutation plan; enforces exact-one versus explicit bulk intent while keeping authorization, persistence, network access, and cross-document search outside the profile. |

Boxel `computeVia` belongs in `derive`, not `compute`: it often needs aggregation over nested record data, but it runs in a headless write/index-time environment where the result should not depend on the current user, request, wall clock, or runtime metadata. The `bxl()` / `expression()` factory enforces this profile when it constructs a compute function. In particular, unrestricted `prepareBxl()` accepts jq `def`, while `bxl()` / `expression()` rejects it with `derive-def-banned`; use a built-in helper when the same computation must run as `computeVia`.

Profile violations are parser diagnostics:

```ts
const ast = compileBxl('words(Description) > 500', {
  target: 'ast',
  profile: 'predicate',
  schema,
});

ast.profileIssues[0]?.code;
// => 'predicate-call-banned'
```

For predicate-profile expressions, the compiler can also emit a parameterized SQL fragment:

```ts
const sql = compileBxlPredicateToSql(
  'Status IN ["Active", "Pending"] and Department IN @User.Departments',
  {
    schema,
    context: { User: { Departments: ['Finance', 'Legal'] } },
    pathToSql(path) {
      return `data #>> '{${path.parts.join(',')}}'`;
    },
  },
);

sql.params;
// ['Active', 'Pending', 'Finance', 'Legal']
```

This is how BXL avoids becoming "one language that does too much." The language is broad; each execution profile is intentionally small. See [`docs/profiles.md`](./docs/profiles.md) for the detailed profile contracts and examples.

---

## Authorization: who may do what?

BXL includes a synchronous, host-neutral, decision-only authorization kernel. It
answers one deliberately small question:

> May this Party invoke this Capability on this Resource?

That maps application abilities—commands and mutations such as
`PerformAppAction`, `MakeMove`, `GrantApp`, or `Publish`—onto
relationship-backed capabilities.
The kernel returns allow or refuse. The host still validates command input,
applies mutations, chooses field projections, records receipts, and performs
external effects.

BXL Authorization uses four nouns:

| Noun       | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| Resource   | The concrete thing on which an operation would be invoked.       |
| Party      | A person, device, service, team, or other actor.                 |
| Seat       | A relationship-backed role the Party occupies for that Resource. |
| Capability | A named command or mutation the Party may invoke.                |

Policy rules are ordinary bounded BXL expressions:

```bxl
Seat.Owner or Seat.Admin
(Seat.Judge and Seat.PanelMember) or Seat.Chair
via(Resource.Project; Capability.Edit)
```

The public document format is `bxl-authorization/1`. Prepare a document and a finite
relationship snapshot once, then reuse the result for synchronous decisions
and symmetric enumeration:

```ts
import { prepareBxlAuthorizationSafe } from '@cardstack/bxl';

const prepared = prepareBxlAuthorizationSafe(document, snapshot);
if (!prepared.ok) throw new Error(prepared.error.message);

const decision = prepared.value.checkCapability({
  party: 'service:fulfillment-bot',
  capability: 'PerformAppAction',
  resource: 'connected-app:fulfillment-bot',
});

const capabilities = prepared.value.listCapabilities({
  party: 'service:fulfillment-bot',
  resource: 'connected-app:fulfillment-bot',
});
```

Resource links can delegate capabilities with `via(...)`. Seats may be held by
nested Party groups; the kernel expands those usersets synchronously, so the
authored rule remains `Seat.PanelMember` rather than exposing a recursion
function. Changing the relationship snapshot changes the resulting decisions
the next time the immutable policy is prepared.

The relationship algebra follows the Zanzibar family and is tested against a
pinned [OpenFGA](https://openfga.dev/) semantic corpus: 1,227 Check,
ListObjects, and ListUsers assertions pass with zero skipped or unsupported
cases. The production engine is BXL-native synchronous TypeScript. It does not
ship an OpenFGA server, WASM runtime, DSL parser, CEL runtime, storage adapter,
or network client.

Start with [`docs/authorization.md`](./docs/authorization.md), then run the
generalized examples with `pnpm example:authorization`. Runtime architecture,
OpenFGA source citations, licensing, and merge gates are in
[`src/authorization/README.md`](./src/authorization/README.md).

---

## Mutation: change Cards without rewriting them

`Profile.mutation` is BXL's DML for schema-known Card and Field
models. It transforms the loaded Card Store model—not raw JSON:API—and produces
a typed write plan for the host to validate, authorize, and commit.

```bxl-mutation
Title = "Final";
"Line Item"[SKU = "COPY-03"].Quantity += 1;
"Line Item"[* Taxable].Discount += 0.05;
insert_item_after(
  { id: "details", title: "Details" },
  Section[ID = "overview"]
);
move_item_before(
  Section[ID = "summary"],
  Section[ID = "round-one"]
);
```

Ordinary `[predicate]` mutations require exactly one match. `[* predicate]` is
the single visible opt-in to bulk assignment, transformation, or deletion.
Loaded `linksTo` and `linksToMany` fields use the same syntax; schema-directed
planning lowers their changes to relationship-edge operations without asking
the author to reproduce JSON:API relationship objects.

The same plan can come from readable streaming statements or structured JSON
tool calls. The planner is pure: it returns the output snapshot, concrete
paths, affected count, per-statement plans, and semantic intents without
performing persistence.

```ts
import { prepareBxlMutation } from '@cardstack/bxl/mutation';

const prepared = prepareBxlMutation(
  '"Line Item"[SKU = "COPY-03"].Quantity += 1;',
  {
    targetKind: 'card',
    schema: invoiceMutationSchema,
  },
);

const plan = prepared.plan(loadedInvoice, {
  programId: 'assistant:call_123',
  returning: ['affected', 'paths', 'changes'],
});
```

Realm cards can use the single-Card adapter when they want to plan and apply a
mutation directly to their live Card Store-backed model. It mirrors the
`computeVia: bxl(...)` call shape, but returns the full plan after writing its
granular intents through Card/Field setters:

```ts
import { updateViaBxl } from 'https://example.test/bxl/bxl.ts';

const incrementCopyQuantity = updateViaBxl(
  '"Line Item"[SKU = "COPY-03"].Quantity += 1;',
);

const plan = incrementCopyQuantity.call(invoice, {
  programId: 'assistant:call_123',
});
```

The Realm bundle derives schema from `getFields(invoice)` and resolves
`card("…")` through `getStore(invoice)`, so Card authors do not maintain a
second mutation schema or pass the Card Store manually. Contained inserts are
materialized as their natural Field class; moves preserve live object
identity; `linksTo`/`linksToMany` operations keep real loaded Card instances.
Collection keys in `reorder_by(Bookings, Booking ID, order)` resolve against a
Booking item, and inherited Card Info relationships remain root-readable—for
example, `Theme = card(id)` plans against the concrete `cardInfo.theme` path.
The adapter changes one resident Card model only. Host code still owns durable
idempotency, permission checks, revision tokens, network persistence, and
cross-Card transactions.

Server-side tools that hold canonical `.json` card source instead of a loaded
Card can use the separate immutable source adapter. It derives the same
mutation schema from Boxel's loaderless `Definition` graph, projects authored
attributes and dotted relationship keys into the loaded-shaped planner model,
then lowers validated scalar, contained-collection, and relationship intents
back into a clone of the original source document:

```ts
import {
  mutateBxlCardSource,
  mutationSchemaForCardSource,
} from '@cardstack/bxl/mutation';

const schema = await mutationSchemaForCardSource(definition, {
  lookupDefinition: (codeRef) => definitionLookup.lookupDefinition(codeRef),
});

const { document, plan } = mutateBxlCardSource(
  clonedSourceDocument,
  `.cardInfo.name = "C#";
   .image = "https://cdn.example.test/csharp.svg";
   .cardInfo.theme = card("https://example.test/themes/dark");`,
  {
    schema,
    syntax: 'solidified',
    programId: toolCallId,
    targetId: cloneFrom,
    resolveReference: (reference) => resolveAgainstSource(reference),
    formatReference: (cardId) => formatForTarget(cardId),
    resolveCard: (cardId) =>
      validatedCardIds.has(cardId) ? { id: cardId } : undefined,
    serializeContainedValue({ path }) {
      // Required when a new contained value has a polymorphic FieldDef that
      // cannot be inferred from plain JSON (for example Spec.containedExamples).
      if (path[0] === 'containedExamples') {
        return { meta: { adoptsFrom: selectedFieldRef } };
      }
    },
  },
);
```

The source adapter does not expose raw `attributes` or `relationships` paths
to mutation authors. Logical `.cardInfo.theme` is persisted as
`data.relationships["cardInfo.theme"].links.self`; scalar paths such as
`.cardInfo.name` and `.image` land under `data.attributes`. Collection inserts,
deletes, moves, and reorders update attributes together with Boxel's two
per-item metadata encodings (`meta.fields.fieldName[index]` for composite
values and `meta.fields["fieldName.index"]` for primitive overrides), recursive
nested `fields`, and dotted relationship indexes. Existing sidecars move or
copy with their values. New polymorphic values use `serializeContainedValue`
to provide their source-relative `adoptsFrom` and any nested relationships;
the adapter fails closed when an existing polymorphic collection would
otherwise lose that type. The input document is never mutated, and a detached
plan is rejected when its projected source snapshot is stale.

Computed Fields remain addressable so generated mutation programs do not fail
when they mention derived Card Info or other computed values. A write targeting
one is an intentional no-op: its expression is not evaluated, it produces no
intent, and its statement reports `affected: 0`. Query-backed and otherwise
read-only Fields still fail closed. Relationship reference interpretation stays
with the host callbacks: `resolveReference` may expand source-relative links
while leaving portable RRI values such as `@catalog/...` opaque, and
`formatReference` may serialize each logical Card ID as an RRI, a source-relative
link, or an absolute URL.

Use `prepareBxlMutationOperations(operations, options)` for the equivalent
`bxl-mutation-ops/1` JSON tool-call encoding, and
`createBxlMutationStatementStream()` to frame arbitrary token chunks without
ever emitting a partial statement. Start with the
[usage guide](./docs/mutation-language-guide.md) and
[profile contract](./docs/mutation-profile.md), then run all semantic fixtures
with `pnpm example:mutation` and the realm-shaped subset with
`pnpm example:mutation:realm`.

---

## Built on open-source foundations

BXL is a thin, opinionated layer on proven foundations.

- **[jq-tools](https://github.com/alexxander/jq-tools)** (MIT) — the complete jq interpreter in TypeScript. Lives in `src/jqtools/` — tokenizer, parser, evaluator, filter registry. We've added deterministic ordering and a budget-aware runtime state.
- **[Formula.js](https://github.com/formulajs/formulajs)** (MIT) — Excel formulas in JavaScript. Curated subset in `src/formulajs/`, narrowed to the 300+ helpers that make sense on JSON. Cell-grid and regression array families stay out; statistical, Bessel, financial, and heavier engineering families are lazy async extensions (see `docs/formulas.md`).
- **[validator.js](https://github.com/validatorjs/validator.js)** (MIT) — string validator functions. BXL imports it lazily and keeps the upstream function names and option shapes where they make sense for boolean validation.
- **[OpenFGA](https://github.com/openfga/openfga)** (Apache-2.0) — the
  authorization conformance reference. BXL pins its semantic test corpus and
  adapts the recursive userset resolver from a cited commit; OpenFGA is not the
  production execution engine.

Our own work — the readable-syntax compiler, linter, formatter, sandbox, and registry — lives in `src/bxl/`. Full attribution in [NOTICE.md](./NOTICE.md).

---

## API

```ts
import {
  evaluateBxl, // readable BXL → JSON value (full runtime)
  compileBxl, // readable BXL → canonical jq source (no evaluation)
  compileBxlPredicateToSql, // predicate-profile BXL → parameterized SQL
  lintBxl, // parser-only diagnostics (no formula helpers, no evaluator)
  solidifyBxl, // normalize fuzzy input to Solid BXL (one-liner, canonical)
  expandBxl, // wrap at pipes / multi-arg calls for readability
  collapseBxl, // round-trip back to single-line canonical
  bxlToJq, // strip BXL sugar, emit pure jq
  jqToBxl, // upgrade jq source to readable BXL

  // BXL Authorization — Resource · Party · Seat · Capability authoring
  prepareBxlAuthorizationSafe,

  // Low-level compatibility IR and semantic-conformance adapter
  compileAuthorizationGraph,
  prepareAuthorizationGraphSafe,

  // Boxel realm authoring — factory + tagged templates that read well
  // inside @field decorators (see "Authoring inside Boxel" below)
  expression, // factory: returns a function bound to `this` (the card)
  expr, // alias of expression
  bxl, // alias of expression
  jq, // tagged template — plain jq (preserves `\(...)`)
  fx, // tagged template — Excel-like readable BXL
} from '@cardstack/bxl';
```

Every function takes an optional `{ schema, runtimeLimits }` options object. Sub-entries in [`package.json`](./package.json) `exports` let consumers pick exactly what they need — the linter-only bundle omits formula helpers for editor and CI tooling:

```
@cardstack/bxl                 — full runtime + helpers
@cardstack/bxl/compiler        — parser + compiler only
@cardstack/bxl/linter          — parser-only diagnostics
@cardstack/bxl/runtime         — jq evaluator + helpers
@cardstack/bxl/runtime-bare    — jq-core evaluator, no spreadsheet helpers
@cardstack/bxl/syntax/textmate — TextMate grammar for editors
```

Every public symbol carries JSDoc in `src/index.ts`.

New authorization code should use `prepareBxlAuthorizationSafe` and the
`bxl-authorization/1` model described in the dedicated
[authorization section](#authorization-who-may-do-what). The older
`bxl-authorization-ir/1` model is the private compatibility IR documented in
[`docs/authorization-kernel-ir.md`](./docs/authorization-kernel-ir.md).

`runtime-bare` is intentionally a capability subset, not a second spelling of the full runtime. Calls such as `AND(...)`, `ROUND(...)`, or `DATE(...)` report that the spreadsheet formula library is absent and point to `@cardstack/bxl/runtime`. jq collection operators such as `map`, `select`, array `+`, and pipes remain available.

Some names that read like BXL functions are jq operations instead: use `[Rows[] | select(predicate)]` for `FILTER`, `Rows | map(expression)` for `MAP`, `array + [value]` for append, and `left + right` for array concatenation (`CONCAT(...)` is also available for text). Use the `null` literal to construct a blank and `ISBLANK(value)` to test one. `DATE(...)` and `DAYS(...)` are implemented; `SECOND(...)` extracts a time component, while `SECONDS(...)` is not a defined duration helper.

---

## Authoring inside Boxel

`evaluateBxl` is the right entry for ad-hoc evaluation, but Boxel realms author expressions inside `@field` decorators where each compute runs against a card instance. The `expression` factory prepares the expression once, binds evaluation to `this` (the card), memoizes repeated reads within a compute cycle, and post-processes the raw value:

```ts
import { expression, fx, jq } from '@cardstack/bxl';

class HospitalPatient extends CardDef {
  @field severity = contains(StringField);
  @field admissionDate = contains(StringField);

  // Plain string — readable BXL syntax. PascalCase identifiers fall
  // back to camelCase field paths when no schema is provided.
  @field admissionState = contains(StringField, {
    computeVia: expression(
      'if .dischargeDate then "discharged" elif .admissionDate then "admitted" else "pending" end',
    ),
  });

  // fx`…` — Excel-like, explicit at the call site.
  @field annualizedHourly = contains(NumberField, {
    computeVia: expression(fx`ROUND(Salary / 2080, 2)`),
  });

  // jq`…` — plain jq with `\(...)` interpolation surviving the
  // string-escape gotcha.
  @field bloodPressureLabel = contains(StringField, {
    computeVia: expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`),
  });
}
```

### When to use which tag

| Source                          | Use                                | Why                                                                                                                                              |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'.severity'`                   | plain jq, but plain string is fine | The compiler runs readable-syntax by default; lowercase paths are inert.                                                                         |
| `'Severity'`                    | plain string                       | PascalCase fallback resolves bare identifiers to `.camelCase` field paths.                                                                       |
| `fx\`ROUND(Salary / 2080, 2)\`` | `fx`                               | Marks the source as Excel-like at the call site. Same compilation as a plain string today, but explicit when other tags appear in the same file. |
| `jq\`"\(.foo)/\(.bar)"\``       | `jq`                               | Backticks preserve `\(…)` interpolation — a regular JS string silently drops the backslash, then the runtime never sees the interpolation.       |
| Pure jq with no PascalCase      | `jq`                               | Skips the readable-syntax compile step when the compute function is constructed.                                                                 |

Other authoring helpers worth knowing:

- `expression(source, { as: SomeFieldDef })` — for `contains(BaseField, …)` / `containsMany(BaseField, …)` computeds whose output should materialize as a subclass instance.
- `expression(source).bxl` exposes the prepared `source`, `compiledSource`, `warnings`, `deps`, and memoization mode so a host runtime can inspect dependency metadata without reparsing.
- `expression(source, { memoize: false })` disables per-instance computeVia memoization for the rare expression that must re-run on every access. The default memoization mode is microtask-scoped; Boxel can call `beginBxlComputeCycle()` around a render/index pass to make the cache boundary explicit.
- Excel error sentinels (`#N/A`, `#DIV/0!`, `#VALUE!`, …) raised inside the compute are caught at the factory boundary and surfaced as `null` instead of crashing the indexer.
- The runtime tolerates null/undefined operands on `-`, `*`, `/`, `%` — the result propagates as `null` rather than throwing. Iterating null yields an empty stream.

For the canonical reference on jq vs fx vs plain-string mode, see [`docs/syntax-modes.md`](./docs/syntax-modes.md). When a CardDef threads inputs into a child FieldDef via `{ as: ... }` materialization, [`docs/realm-composition.md`](./docs/realm-composition.md) is the canonical reference. The Boxel-flavored suite in [`tests/boxel/`](./tests/boxel/) locks each null-tolerance and factory rule to the exact behavior a card runtime depends on.

---

## Docs

- **[bxl.boxel.site](https://bxl.boxel.site)** — live site with the syntax reference rendered, syntax-highlighted, and searchable
- [`docs/syntax-reference.md`](./docs/syntax-reference.md) — the same reference in Markdown, for GitHub browsing and plain-text viewers
- [`docs/grammar.ebnf`](./docs/grammar.ebnf) — formal grammar
- [`docs/syntax-modes.md`](./docs/syntax-modes.md) — jq vs fx vs plain-string call-site modes
- [`docs/profiles.md`](./docs/profiles.md) — profile contracts for restricted execution surfaces
- [`docs/formulas.md`](./docs/formulas.md) — Excel helper matrix (implemented, BXL-only, via jq, won't add)
- [`docs/browser-runtime.md`](./docs/browser-runtime.md) — browser runtime patterns, worker usage, errors
- [`docs/mutation-profile.md`](./docs/mutation-profile.md) — the Card-native write planner's contract
- [`docs/authorization.md`](./docs/authorization.md) — relationship authorization from first principles, with synchronous APIs, domain models, and security boundaries
- [`src/authorization/README.md`](./src/authorization/README.md) — runtime architecture, Boxel integration lifecycle, OpenFGA/Zanzibar provenance, and merge gates
- [`docs/realm-collaboration-use-cases.md`](./docs/realm-collaboration-use-cases.md) — gateway admission, transition, event, clock, and ledger patterns
- [`docs/README.md`](./docs/README.md) — index of the full documentation set

---

## Development

```sh
pnpm test              # every suite under tests/unit, tests/smoke, tests/boxel
pnpm test tests/boxel  # one directory
pnpm lint              # lint:js (ESLint + prettier) and lint:types (tsc --noEmit)
pnpm verify:package    # pack the npm artifact and check it from outside the repo
```

Development needs no build. The sources are erasable TypeScript with `.ts`
import specifiers: Node runs them directly and the host bundles them, so
nothing here is generated and no `dist/` can go stale. A suite is a standalone
entry point, so `node tests/unit/linter-cli.ts` runs exactly one.

Publishing does need a build, because an installed package sits inside
`node_modules` where Node refuses to strip types. `pnpm build` emits JavaScript
and declarations into `dist/`, which `publishConfig.exports` points the
published package at — see [`scripts/build.ts`](./scripts/build.ts). The
version lives in two places, `package.json` and `VERSION` in `src/index.ts`;
`pnpm exec node scripts/set-version.ts <version>` sets both.

### Releasing

Merging to main publishes a prerelease under the `unstable` dist-tag. The
version comes from the merged PR's title: a conventional-commit prefix
(`feat:` minor, `fix:` / `perf:` / `refactor:` patch, a `!` or a
`BREAKING CHANGE:` footer major), and prefixes that describe no consumer-visible
change (`chore:`, `docs:`, `test:`, …) publish nothing. Neither does a merge
that leaves everything the tarball ships untouched, whatever its title —
`scripts/compute-release.ts` holds both rules, and `scripts/release-prefixes.json`
is the prefix list the pre-merge title check reads too.

Cutting a stable release is a separate, manual act: run the `bxl publish`
workflow with `confirm = promote`. It strips the `-unstable.<n>` suffix, closes
out the CHANGELOG's `[Unreleased]` section under the new version, and publishes
that version under `latest` — so keep `[Unreleased]` current as changes land.

### Layout

```
src/
├── jqtools/    jq runtime (parser, evaluator, sandbox) — derived from jq-tools
├── formulajs/  Excel formulas — derived from Formula.js
└── bxl/        Readable syntax, linter, formatter, bridge, registry — ours
```

Strict layering: `jqtools/` and `formulajs/` do not import each other or `bxl/`. `bxl/` imports both as needed.

### Conventions

Any parser or compiler change carries a regression test under `tests/unit/`
(`tests/unit/compiler-bug-regressions.ts` shows the pattern), plus a matching
note in `docs/grammar.ebnf` when the public surface shifts.

Helper naming: UPPERCASE names are reserved for real Excel functions,
lowercase names are for jq/BXL-native helpers, and preserved upstream APIs
such as validator.js keep their established casing — see
[`docs/formulas.md`](./docs/formulas.md#naming-convention).

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright © Cardstack Foundation and contributors.
