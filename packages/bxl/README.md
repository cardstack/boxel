<div align="center">

# BXL — Boxel Expression Language

**The language between data and code.**
Spreadsheet-style formulas over JSON. Paste-compatible with Excel. Sandboxed by construction. Small enough to live inside a JSON field — powerful enough to drive constraints, formulas, defaults, and workflow gates.

**Live site:** [**bxl.boxel.site**](https://bxl.boxel.site) &nbsp; · &nbsp; syntax reference, examples, docs — rendered

</div>

```bxl
"Line Item"[SKU = "BRAND-RED"]."Unit Price"          -- first-match predicate
SUM("Line Item"[*Taxable]."Line Total")              -- SUMIF without the _BY
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

> **Status: pre-release** (`0.1.0-dev.0`). First tagged release will be `0.1.0`. The public API is intentionally unstable below 1.0 — see [RELEASE-PLAN.md](./RELEASE-PLAN.md).

---

## Why BXL?

Every app has two kinds of logic. There's **code** — arbitrary, Turing-complete, deployed with seat belts loosened — and there's **data** — inert, schematized, shipped in configs and forms. Real applications need a third kind: something in between. Something a domain expert can author, git can diff, a catalog can ship, and a sandbox can trust.

BXL is that third kind, scoped deliberately. It's jq pipes plus Excel helpers — `SUM`, `ROUND`, `IF`, `VLOOKUP`, `XIRR` — evaluated against a JSON snapshot (the bare `.` is the current input, same as jq). It cannot fetch. It cannot write. It cannot call an LLM, open a file, or mutate shared state. Those four "cannots" are what let a platform embed BXL inside validation rules, computed fields, workflow gates, and query transforms without worrying that a schema author just drilled a hole into production.

If you've been stitching together Ajv + jq + Formula.js + a custom rule engine, BXL is what that stack looks like after it consolidates into a single dependency.

---

## Install

```sh
npm install @cardstack/bxl
```

Requires Node `>=18.17`. Zero runtime dependencies in the default bundle; the linter-only bundle strips formula helpers for editor tooling.

---

## At a glance

The eight design decisions that make BXL feel the way it does:

- **Labels instead of paths** — `Subtotal + "Tax Amount"` beats `.subtotal + .taxAmount`. Labels resolve against a schema at compile time.
- **1-based rows** — `"Line Item"[#4]` is the fourth row. `[3]` remains the jq-native 0-based escape hatch.
- **Implicit iteration** — `"Line Item"."Line Total"` auto-materializes across the array. No `map` for the common case.
- **Two predicate shapes** — `[pred]` picks the first match (scalar). `[*pred]` keeps every match (array). Replaces `VLOOKUP` / `SUMIF` without a separate builtin.
- **Structural pseudo-classes** — `:first`, `:last`, `:nth(N)`, `:nth-last(N)`, `:odd`, `:even`, `:only`, `:empty`, `:not(…)`. CSS for your data.
- **Paste Excel unchanged** — `=`, `<>`, `^`, `&`, leading `=` all work. `ROUND`, `SUM`, `IF`, `VLOOKUP` match Microsoft Excel exactly.
- **UPPERCASE is a promise, lowercase is a contribution** — `ROUND(x; 2)` is paste-compatible with Excel. `present(x)`, `when(p; q)`, `words(s)` are BXL-native.
- **One sandbox, many surfaces** — the same language powers computed fields, form validation, visibility rules, workflow gates, access policies, and annotation targets.

The full reference with syntax-highlighted examples is at **[bxl.boxel.site](https://bxl.boxel.site)** (also shipped as [`docs/syntax-reference.html`](./docs/syntax-reference.html) and [`docs/syntax-reference.md`](./docs/syntax-reference.md)); the formal grammar lives in [`docs/grammar.ebnf`](./docs/grammar.ebnf).

---

## A tour of the syntax

One fixture, nine examples. Skim it to taste the language.

```ts
import { evaluateBxl } from '@cardstack/bxl';

// Schema: what fields exist, what humans call them.
const schema = {
  fields: [
    { key: 'subtotal',  label: 'Subtotal' },
    { key: 'taxRate',   label: 'Tax Rate' },
    { key: 'taxAmount', label: 'Tax Amount' },
    { key: 'total',     label: 'Total' },
    {
      key: 'lineItems', label: 'Line Item', kind: 'array',
      item: { fields: [
        { key: 'sku',       label: 'SKU' },
        { key: 'quantity',  label: 'Quantity' },
        { key: 'unitPrice', label: 'Unit Price' },
        { key: 'lineTotal', label: 'Line Total' },
        { key: 'taxable',   label: 'Taxable' },
      ] },
    },
  ],
};

// Fixture: any JSON that matches the schema.
const invoice = {
  subtotal: 150, taxRate: 8.25, taxAmount: 12.38, total: 162.38,
  lineItems: [
    { sku: 'COPY-01',   quantity: 1, unitPrice: 50,  lineTotal: 50,  taxable: true  },
    { sku: 'BRAND-RED', quantity: 5, unitPrice: 20,  lineTotal: 100, taxable: false },
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
evaluateBxl('SUM("Line Item"[*Taxable]."Line Total")', invoice, { schema });
// => 50  (only the taxable row)

// 6 · Structural pseudo-classes
evaluateBxl('"Line Item":first.SKU',           invoice, { schema }); // => 'COPY-01'
evaluateBxl('"Line Item":last.Quantity',       invoice, { schema }); // => 5
evaluateBxl('"Line Item":nth(2)."Unit Price"', invoice, { schema }); // => 20

// 7 · Paste Excel unchanged
evaluateBxl(
  '=IF("Tax Rate" > 0, ROUND(Subtotal * "Tax Rate" / 100, 2), 0)',
  invoice, { schema },
);
// => 12.38

// 8 · Invariants — "if this applies, then this must hold"
evaluateBxl(
  'when(Subtotal > 0, Total = Subtotal + "Tax Amount")',
  invoice, { schema },
);
// => true

// 9 · Presence — form-friendly vs Excel-strict
evaluateBxl('present("Tax Amount")',     invoice, { schema }); // => true
evaluateBxl('NOT ISBLANK("Tax Amount")', invoice, { schema }); // => true (Excel semantics)
```

---

## Where BXL earns its keep

BXL is evaluated from eight distinct positions in a typical application. Each uses the same parser, the same dependency tracker, and the same sandbox — so a field constraint, a workflow gate, and a reactive predicate all share a vocabulary the author learns once.

| Position                | What it does                      | Example                                                 |
| ----------------------- | --------------------------------- | ------------------------------------------------------- |
| **Formula field**       | Computed value on a record        | `SUM("Line Item"."Line Total")`                         |
| **Constraint**          | Validation rule with a message    | `"End Date" > "Start Date"`                             |
| **Visible-when**        | Conditional field rendering       | `Status = "in-review"`                                  |
| **Autofill / default**  | Computed initial value            | `slugify(Title)`                                        |
| **Workflow gate**       | Advance condition                 | `all(Steps[…]; Status = "done")`                        |
| **Notification trigger**| Fire when threshold crossed       | `"Budget Remaining" < 1000`                             |
| **Reactive predicate**  | Watch-and-fire rule               | `age("Last Heartbeat") > DURATION("60s")`               |
| **Query transform**     | Bulk derivation over an array     | <code>"Line Item" &#124; map(Quantity * "Unit Price")</code> |

### Where expressions live — three layers, one rule each

BXL is one of three layers where logic lives in a typical application. Each layer has different constraints, different audit characteristics, and different change cycles.

- **BXL expressions** — logic that is *data*: constraints, formulas, predicates, defaults, visibility, transforms. Stored as strings, shipped alongside records, editable at runtime without a redeploy.
- **Class methods and computed properties** — logic that is *code compiled with the type*: getters, `@computed` columns on an ORM model, derived fields declared on a class. Ships with the module; changes require a redeploy.
- **Application code with side effects** — controllers, handlers, services: writes, deletes, network calls, LLM invocations, external APIs. Full language power, attributable, auditable.

One-line rule: **BXL for logic-as-data · class methods for logic-as-type · application code for changes-to-the-world.** BXL never writes. Application code never embeds in records. When in doubt, ask *"could a stranger run this expression a million times against my data?"* — if yes, it's BXL; if no, it's application code.

---

## One example, many jobs

A single form definition typically exercises several of the 8 positions at once. Every BXL fragment below is just a string inside a standard data object — nothing special, no build step, diffable in code review, parseable without the evaluator.

```ts
// In a form definition:
export const donationForm = {
  name: 'Donation',
  fields: [
    { key: 'firstName', label: 'First Name', required: true },
    { key: 'lastName',  label: 'Last Name',  required: true },

    { key: 'email', label: 'Email',
      validate: [
        { expr: 'Email CONTAINS "@"',
          message: 'Must be a valid email' },
      ],
    },

    { key: 'amount', label: 'Donation Amount', type: 'number',
      validate: [
        { expr: '"Donation Amount" > 0',
          message: 'Amount must be positive' },
      ],
    },

    // Visible-when: only show employer field for gifts over the match threshold
    { key: 'employer', label: 'Employer',
      visibleWhen: '"Donation Amount" >= 250' },

    // Conditional default: prefill matching program IF employer is filled
    { key: 'matchingProgram', label: 'Matching Program',
      visibleWhen: 'present(Employer)',
      defaultFrom:  'Employer."Matching Program"' },

    { key: 'recurring',     label: 'Make Recurring',  type: 'boolean' },
    { key: 'paymentMethod', label: 'Payment Method',
      visibleWhen: 'Recurring' },

    // Computed field: total annual gift via IF branching
    { key: 'totalAnnual', label: 'Total Annual Gift',
      computedVia: 'IF(Recurring, "Donation Amount" * 12, "Donation Amount")' },
  ],

  // Record-level constraints — run on save, cross-field
  constraints: [
    { expr: 'when(Recurring, present("Payment Method"))',
      message: 'Recurring donations require a payment method on file' },

    { expr: 'when(present("Matching Program"), "Donation Amount" >= "Matching Program"."Minimum")',
      message: 'Gift below employer matching minimum' },
  ],
};
```

Every expression above fires at a different point in the form's lifecycle, and each maps to one row of the 8-position grid:

- `Email CONTAINS "@"` · `"Donation Amount" > 0` → **constraint**, per-field on input
- `"Donation Amount" >= 250` · `present(Employer)` · `Recurring` → **visible-when**, recalculated as other fields change
- `Employer."Matching Program"` → **autofill / default**, applied on field focus or record load
- `IF(Recurring, "Donation Amount" * 12, "Donation Amount")` → **formula field**, recomputed on every change
- `when(Recurring, present("Payment Method"))` and the matching-minimum rule → **record-level constraint**, run on save with cross-field access

Same string language everywhere. Each slot in the object is a plain string; the compiler parses them with the same grammar, resolves labels against the same schema, and evaluates them in the same sandbox. The container object's shape (`fields[].validate[]`, `fields[].visibleWhen`, etc.) is up to your framework — BXL is agnostic to that; it only parses the expression strings inside.

---

## Comparisons & inspirations

BXL doesn't invent much. It pulls ideas from eight expression languages that were already solving pieces of the same problem, and adds a readable surface that lets them coexist in one runtime.

Credit and attribution below; pick whichever section describes the language you already know.

### 1 · Excel · paste-compatible where it matters

The "XL" in BXL is earned. 300+ Excel helpers — sourced from [Formula.js](https://github.com/formulajs/formulajs) (MIT) and wired into the jq runtime as native functions — ship with matching Microsoft Excel semantics. Paste `=IF(…)` from a spreadsheet and it runs unchanged. Current row is the bare `.` (a lone dot, same as jq) instead of `A1`; columns are field names instead of column letters.

```
Excel:  =ROUND(B2 * C2 / 100, 2)
BXL:    ROUND(Subtotal * "Tax Rate" / 100, 2)
```

BXL skips Excel's cell-grid functions (`OFFSET`, `INDIRECT`, `DAVERAGE`), most statistical distributions, and Bessel / regression array functions — they don't translate onto JSON. Everything that does translate is in.

### 2 · jq · every valid jq is valid BXL

[jq-tools](https://github.com/alexxander/jq-tools) (MIT) is the actual runtime. BXL compiles to canonical jq before execution; the evaluator doesn't know or care whether you wrote `.lineItems[0].sku` or `"Line Item"[#1].SKU`. The Excel helpers are added as regular jq functions via jq's native extension mechanism — no parser fork, no runtime fork.

```
jq:   .lineItems | map(select(.taxable)) | map(.lineTotal) | add
BXL:  SUM("Line Item"[*Taxable]."Line Total")
```

If you already know jq, you already know BXL. If you don't, every pipeline jq supports still works — BXL just gives you a readable shortcut when a schema is available.

**One rule about labels and pipes.** BXL's readable labels (`"Line Item"`, `"Bill To".Name`, `Subtotal`) resolve against the root record at compile time. Inside a pipe stage — `map`, `select`, `sort_by`, `any`, `all`, `reduce`, `foreach` — the context is the *current item*, addressed by jq-native paths (`.sku`, `.lineTotal`). Readable labels on the top level, `.path` inside pipes. Same convention jq users already follow, just with an optional schema-aware layer on top.

### 3 · XPath · tree paths with predicates

XPath normalized a compact notation for walking typed trees: dot-separated names for fields, brackets for predicates, helpers for position (`last()`, `position()`). BXL borrows the mental model and drops the axis specifiers (`/`, `//`, `@`) — there's no need for them on JSON.

```
XPath:  /invoice/lineItem[sku='BRAND-RED']/unitPrice
BXL:    "Line Item"[SKU = "BRAND-RED"]."Unit Price"
```

### 4 · XQuery · a small debt to FLWOR thinking

XQuery (W3C) showed that a query grammar can grow into a full expression language — let-bindings, conditionals, sequence composition, and data reshape — without bolting on a separate scripting layer. BXL stays smaller (no FLWOR keywords, no XML schema types, no modules) but adopts the same premise: one language should cover computation *and* reshape, not just lookup.

**Filter and aggregate:**

```xquery
XQuery:  sum(for $li in $invoice/lineItem
             where $li/taxable = "true"
             return $li/lineTotal)
```
```bxl
BXL:     SUM("Line Item"[*Taxable]."Line Total")
```

Four lines of FLWOR compress into one BXL expression. FLWOR is more explicit about each step; BXL is more compact because implicit iteration and predicate-indexed arrays do the work silently.

**Reshape into a new data shape:**

```xquery
XQuery:
<summary id="{$inv/@id}">
  <customer>{ $inv/billTo/name/text() }</customer>
  <subtotal>{ sum($inv/lineItem/lineTotal) }</subtotal>
  <top-items>{
    for $li in $inv/lineItem
    order by $li/lineTotal descending
    return <item sku="{$li/@sku}" total="{$li/lineTotal}"/>
  }</top-items>
</summary>
```
```bxl
BXL:
{
  id:         Id,
  customer:   "Bill To".Name,
  subtotal:   SUM("Line Item"."Line Total"),
  top_items:  "Line Item"[all]
              | sort_by(.lineTotal) | reverse
              | map({sku: .sku, total: .lineTotal})
}
```

XQuery constructs XML trees element-by-element, with templating inline. BXL constructs JSON objects with native object-literal syntax. Different output shapes, same premise: one language for both querying and reshaping. (Note the convention from §2: readable labels at the top level, jq-native `.path` inside pipe stages like `map` and `sort_by`.)

### 5 · Schematron · the validation-rule shape, newly relevant

Schematron (ISO/IEC 19757-3) is the standard for rule-based tree validation: match a pattern, assert a condition, emit a message. Unlike grammar-based validators like XSD, Schematron checks *relationships between values* — "if this, then that" — using XPath expressions against the document tree.

It's been quietly important since 2006, and it's back in focus because of how LLMs change the shape of incoming data. As generative tooling produces more loosely-structured documents — free-text forms filled in by an agent, invoice JSON pulled from a receipt OCR, a draft contract authored by a model — validation moves later in the pipeline. A fixed schema catches missing fields; a rule language catches *things that should be true but aren't*.

BXL's validation surface reuses Schematron's shape — a rule is a boolean expression with an attached message — but the rules sit inline in form schemas and data-model definitions rather than a separate XML document.

```xml
Schematron:  <assert test="total = sum(lineItem/lineTotal)">Total mismatch</assert>
```
```ts
BXL:         { expr: 'Total = SUM("Line Item"."Line Total")',
               message: 'Total mismatch' }
```

Same pattern, JSON-native, runs in the same sandbox as your formulas.

### 6 · CSS · a pseudo-class notation worth borrowing

BXL's debt to CSS is narrow and specific: the selector pseudo-class vocabulary. `:first-child`, `:nth-of-type(2n)`, `:not(.hidden)` — CSS shipped a compact, readable notation for addressing positions in a collection, and BXL lifts it verbatim and points it at array indexes instead of DOM nodes.

```
CSS:  tr:first-child, tr:nth-child(2n+1), li:not(.done)
BXL:  "Line Item":first,  "Line Item":odd,  Task:not([Done])
```

That's most of the debt. CSS is otherwise a different *kind* of language — a styling rule engine that runs against the DOM to produce rendered boxes, not a general expression language:

- `calc()`, `clamp()`, `attr()` compute values, but only CSS-legal typed values (lengths, numbers, colors) for layout. You can't propagate the result into business logic.
- `:invalid`, `:required`, `:user-invalid` *react* to validation state defined in HTML attributes or JavaScript; CSS doesn't author the rules.
- `var(--x, fallback)` + the cascade resolve a property by lookup-with-fallback, not by expression-level branching.
- `counter()` and `:has()` walk the tree for rendering; they don't aggregate values in any arithmetic sense.

CSS is genuinely sandboxed — it can't fetch, mutate, or call arbitrary code, and the web depends on that — but "sandboxed styling rules" isn't the same category as "sandboxed expression language." BXL borrows the position-addressing notation because it's a good notation, not because CSS solves BXL's problem.

### 7 · JSONata · the closest living peer

[JSONata](https://jsonata.org) (MIT, IBM + community) is a full expression language over JSON, built for the same job BXL is aimed at: embed in config, evaluate sandboxed, transform and validate data. It's widely used in low-code platforms — node-RED, OpenEPCIS, several integration tools. If you've already picked JSONata and it's working, most of this README's pitch is already solved for you.

```
JSONata:  $sum(lineItems[taxable].lineTotal)
BXL:      SUM("Line Item"[*Taxable]."Line Total")
```

The differences, honestly:

- **JSONata** has its own evaluator, its own path grammar, and its own function library. BXL has jq underneath and Formula.js wired in, which means `VLOOKUP`, `XIRR`, `ROMAN`, and 300+ other Excel helpers work out of the box with Excel semantics.
- **JSONata** uses raw key paths (`lineItems.lineTotal`); BXL resolves quoted display-name labels (`"Line Item"."Line Total"`) against a schema.
- **JSONata** doesn't accept pasted Excel formulas; BXL does.

Pick JSONata when your authors are engineers and your data is already JSON-shaped. Pick BXL when your authors think in Excel formulas and display names, and when the data-processing pipe story matters (because jq is right there).

### 8 · CEL · policy-language credentials

[CEL (Common Expression Language)](https://cel.dev) is Google's sandboxed embeddable expression language. Apache-2.0, production-deployed in Kubernetes admission control, Google Cloud IAM conditions, Firebase Security Rules, AIP policies, Envoy's RBAC filter — roughly "the sandbox expression language of record" in cloud infrastructure. Syntax reads JS-ish; semantics are strictly sandboxed.

```
CEL:  has(request.auth.claims.role) && request.auth.claims.role == "admin"
BXL:  NOT ISBLANK(Request.Auth.Claims.Role) and Request.Auth.Claims.Role = "admin"
```

(CEL's `has()` tests whether a field is *set* — null-only. BXL's exact match is `NOT ISBLANK(x)`. BXL's `present(x)` is stricter — null *or* empty string — which is usually what you want on a form, not on an auth claim.)

CEL is stronger than BXL at pure policy and authorization — its type system is designed for predicate evaluation and its tooling is mature. BXL is stronger at the spreadsheet side of the house (Excel paste, formula helpers, the VLOOKUP-shape predicate). The two share a philosophical parent: a tiny, safe, embeddable DSL beats a general-purpose sandbox every time.

Different readership. If you're building an authorization layer, look at CEL first. If you're building a business app with computed fields and validation rules near the user, BXL is closer.

---

### Plain JavaScript · the baseline

For the common case — map / filter / reduce over an array — BXL is a shorter spelling. For everything else, BXL adds validation with attached messages, a sandbox, and serializability as data.

```js
invoice.lineItems
  .filter(li => li.taxable)
  .reduce((sum, li) => sum + li.lineTotal, 0);
```
```bxl
SUM("Line Item"[*Taxable]."Line Total")
```

Both answer the same question. The JS version has `fetch` and `process.env` in scope and runs inside your server bundle; the BXL version refuses I/O by construction and serializes as data. Different tools for different distances from user-authored input — neither replaces the other.

### Coverage across common jobs

Each language above is strong at one or two of the jobs a typical business app needs — validation, computed fields, data processing, conditional defaults, storage as data. No single one covers the whole set.

| Role                                  | Excel | jq | XPath | XQuery | Schematron | CSS | JSONata | CEL | JS | BXL |
| ------------------------------------- | :---: | :-: | :---: | :----: | :--------: | :-: | :-----: | :-: | :-: | :-: |
| Validation rules + messages           |  🟡  | ⚪ |  ⚪  |   ⚪   |    🟢     |  — |   ⚪   | 🟢 | 🟡 | 🟢 |
| Computed / formula fields             |  🟢  | 🟡 |  🟡  |   🟡   |     —     | ⚪ |   🟢   | 🟡 | 🟡 | 🟢 |
| Data processing / aggregation         |  ⚪  | 🟢 |  🟡  |   🟢   |     —     |  — |   🟢   | 🟡 | 🟡 | 🟢 |
| Conditional defaults                  |  🟡  | 🟡 |  🟡  |   🟡   |     —     | 🟡 |   🟡   | 🟡 | 🟡 | 🟢 |
| Sandbox by default (no I/O)           |  🟢  | 🟢 |  🟢  |   🟡   |    🟢     | 🟢 |   🟢   | 🟢 |  — | 🟢 |
| Readable to non-engineers             |  🟢  |  — |   —  |    —   |     —     | ⚪ |   ⚪   | ⚪ |  — | 🟢 |
| Paste from spreadsheet                |  🟢  |  — |   —  |    —   |     —     |  — |    —   |  — |  — | 🟢 |
| Works on JSON natively                |   —  | 🟢 |   —  |    —   |     —     |  — |   🟢   | 🟡 | 🟢 | 🟢 |
| Embeds in JSON as data (serializable) |  🟡  | 🟢 |  🟡  |   🟡   |    ⚪    | 🟡 |   🟢   | 🟢 | ⚪ | 🟢 |
| One language across every job         |  ⚪  | 🟡 |  ⚪  |   🟡   |     —     |  — |   🟡   | 🟡 | 🟢 | 🟢 |

🟢 strong &nbsp;·&nbsp; 🟡 ok / partial &nbsp;·&nbsp; ⚪ weak &nbsp;·&nbsp; — none

BXL didn't invent any row. It's the smallest language that covers all of them at once, because it explicitly composes the wins of the ones that came before.

For a typical business record — invoices, offers, contracts, forms, tickets, events, reports — every row in that table is a real requirement. BXL covers all of them with one parser, one evaluator, and one sandbox, because it explicitly composes the wins of the languages that came before.

---

## Security model

BXL is a **data sandbox**, not an OS sandbox. Expressions compute over a supplied JSON snapshot and return values. They do not escape.

### What BXL will never do

Not warnings. Enforced by the evaluator at parse or at runtime:

- **No side effects.** No writes, no deletes, no messages sent.
- **No network.** No `fetch`, no external APIs, no URLs opened.
- **No LLM calls.** Those live in your application code, one layer up.
- **No unbounded loops.** Op budget + wall-clock ceiling → `#LIMIT!` error.
- **No closures or shared state.** Same input, same data, same result — always.
- **No direct data mutation.** BXL reads; your application code writes.

These six guarantees are what let the platform embed BXL inside Guides, workflows, notifications, and queries without worrying that a schema author just drilled a hole into production.

### Runtime knobs

- **Budgets on by default** — step count, output count, output bytes, wall-clock. Hosts tighten via `runtimeLimits`.
- **Deterministic** — no clock or random unless the host injects them.
- **Worker-safe** — for hard memory ceilings or non-cooperative cancellation, run BXL in a Worker or isolate and terminate from the host.

See [`docs/sandbox.md`](./docs/sandbox.md) for the full threat model and contract.

---

## Built on two open-source giants

BXL is a thin, opinionated layer on proven foundations.

- **[jq-tools](https://github.com/alexxander/jq-tools)** (MIT) — the complete jq interpreter in TypeScript. Lives in `src/jqtools/` — tokenizer, parser, evaluator, filter registry. We've added deterministic ordering and a budget-aware runtime state.
- **[Formula.js](https://github.com/formulajs/formulajs)** (MIT) — Excel formulas in JavaScript. Curated subset in `src/formulajs/`, narrowed to the 300+ helpers that make sense on JSON (we dropped cell-grid, distribution, regression, and Bessel families — see `docs/formulas.md`).

Our own work — the readable-syntax compiler, linter, formatter, sandbox, and registry — lives in `src/bxl/`. Full attribution in [NOTICE.md](./NOTICE.md).

---

## API

```ts
import {
  evaluateBxl,      // readable BXL → JSON value (full runtime)
  compileBxl,       // readable BXL → canonical jq source (no evaluation)
  lintBxl,          // parser-only diagnostics (no formula helpers, no evaluator)
  solidifyBxl,      // normalize fuzzy input to Solid BXL (one-liner, canonical)
  expandBxl,        // wrap at pipes / multi-arg calls for readability
  collapseBxl,      // round-trip back to single-line canonical
  bxlToJq,          // strip BXL sugar, emit pure jq
  jqToBxl,          // upgrade jq source to readable BXL
} from '@cardstack/bxl';
```

Every function takes an optional `{ schema, runtimeLimits }` options object. Sub-entries in [`package.json`](./package.json) `exports` let consumers pick exactly what they need — the linter-only bundle omits formula helpers for editor and CI tooling:

```
@cardstack/bxl                 — full runtime + helpers
@cardstack/bxl/compiler        — parser + compiler only
@cardstack/bxl/linter          — parser-only diagnostics
@cardstack/bxl/runtime         — jq evaluator + helpers
@cardstack/bxl/runtime-bare    — jq evaluator, no helpers
@cardstack/bxl/syntax/textmate — TextMate grammar for editors
```

Full API reference in [`docs/api.md`](./docs/api.md).

---

## CLI

```sh
npm install --global @cardstack/bxl

bxl compile  '"Line Item"[#1].SKU'
bxl eval     '"Line Item":first.SKU'  --input invoice.json --schema invoice.schema.json
bxl lint     'IF(Subtotal = 0, "empty", Subtotal)'
bxl solidify 'subtotal * tax rate'
```

One-shot pipes too: `echo '{"n":42}' | bxl eval 'n * 2'` prints `84`.

---

## Docs

- **[bxl.boxel.site](https://bxl.boxel.site)** — live site with the syntax reference rendered, syntax-highlighted, and searchable
- [`docs/syntax-reference.html`](./docs/syntax-reference.html) — the same reference as a standalone HTML file (open locally in a browser)
- [`docs/syntax-reference.md`](./docs/syntax-reference.md) — same reference in Markdown, for GitHub browsing and plain-text viewers
- [`docs/grammar.ebnf`](./docs/grammar.ebnf) — formal grammar
- [`docs/sandbox.md`](./docs/sandbox.md) — sandbox contract and threat model
- [`docs/excel-compatibility.md`](./docs/excel-compatibility.md) — what pasted Excel formulas support
- [`docs/formulas.md`](./docs/formulas.md) — Excel helper matrix (implemented, BXL-only, via jq, won't add)
- [`docs/api.md`](./docs/api.md) — TypeScript API and option defaults

---

## Development

```sh
npm install
npm test           # tests/unit/ + tests/smoke/ — 489+ cases
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/
```

### Layout

```
src/
├── jqtools/    jq runtime (parser, evaluator, sandbox) — derived from jq-tools
├── formulajs/  Excel formulas — derived from Formula.js
└── bxl/        Readable syntax, linter, formatter, bridge, registry — ours
```

Strict layering: `jqtools/` and `formulajs/` do not import each other or `bxl/`. `bxl/` imports both as needed.

### Contributing

Issues and PRs welcome. Add a regression test under `tests/unit/` for any parser/compiler change (see `tests/unit/compiler-bug-regressions.ts` for the pattern) and a matching note in `docs/grammar.ebnf` if the public surface shifts. UPPERCASE helper names are reserved for real Excel functions — see [`docs/formulas.md`](./docs/formulas.md#naming-convention).

Security reports: please email `security@boxel.ai` rather than filing a public issue.

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright © Cardstack Foundation and contributors.
