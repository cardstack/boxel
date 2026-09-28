# Project

{{project.objective}}

{{#if project.successCriteria}}
Success criteria:
{{#each project.successCriteria}}
- {{.}}
{{/each}}
{{/if}}

# Knowledge

{{#each knowledge}}

## {{title}}

{{content}}
{{/each}}

# Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}
Status: {{issue.status}}
Priority: {{issue.priority}}

Description:
{{issue.description}}

{{#if issue.checklist}}
Checklist:
{{#each issue.checklist}}
- [ ] {{.}}
{{/each}}
{{/if}}

{{#if toolResults}}

# Tool Results

You previously invoked the following tools. Use these results to inform your implementation.

{{#each toolResults}}

## {{tool}} (exit code: {{exitCode}})

```{{outputFormat}}
{{output}}
```

{{/each}}
{{/if}}

# Instructions

You are building a **user-facing card**. A card is judged by how it looks and
reads in its formats, and by how cleanly other cards can compose with it —
not by ceremony. Work design-first, in this order:

**Live-blog as you go.** The operator watches this run on a live run-log
card. Call `post_update` at every meaningful moment — kicking off a design,
what a critique round found (name the defects), a decision and its tradeoff,
starting to translate the mockup to code, recovering from a failed check.
First person, concrete, 1–3 sentences, social-media energy. This commentary
channel is as important as the artifacts: it steers orchestration during the
run and is the record after it. Never work silently for more than a few
minutes.

## 1. Ground yourself (context before code)

- `Read` / `Glob` the workspace; `Bash` + `boxel search --realm <target-realm-url>` for cards already in the target realm, and the catalog realm for work already done (§2).
- Call `list_skills`, then `read_skill` the skills this issue actually touches
  (design, fitted formats, theming, file fields, queries — whatever applies).
  Read precedent: if a similar card exists in the workspace, read its `.gts`.

{{#if enableCatalogReuse}}
## 2. REUSE — decide what you are not building

The catalog is a library of work already done. Consult it **before** you
mock: a schema you adopt is a given the mockup designs around, and a schema
the mockup already fixed is one you can no longer adopt.

- **Enumerate the needs this issue implies, the card itself first.** The
  card you are building is need #1 — the catalog may already publish it, or
  one close enough to adopt or extend. Then its fields, then the components
  it renders through, then any command it invokes. A list that starts at the
  fields has already decided the card is new.
- **Consult the catalog per need.** `catalog-reuse` has the query shapes and
  how to judge a hit — follow it rather than inventing a query.
- **Search all four block kinds.** `field` and `card` are the ones that come
  to mind; `component` and `command` are reuse units too, and the catalog
  publishes them in quantity. A kind you never searched is a kind you cannot
  report on.
- **Keep what you searched, not only what you found** — the realms and paths
  queried, and the result count for each. A count of zero for a tree that
  ought to be populated (`cards/`, `fields/`) means your *view* of the
  catalog is partial, not that the catalog is empty: `post_update` it and
  record it as a `CAVEAT:` in the notes. A confident "nearest match" drawn
  from an incomplete index is worse than no conclusion, because nothing
  downstream can tell the two apart.
- **Disposition every hit you get back.** Adopted, extended, or refused
  naming the mismatched fields or the design rule it breaks. A hit you drop
  without saying why is indistinguishable from one you never saw.
- **A near miss is something to extend, not something to refuse.** When a
  catalog block has the right shape and is missing a few fields, `EXTEND` it
  and add them. Reserve `REUSE-BLOCKED` for a candidate you genuinely cannot
  build on.
- **Presentation is a weak reason to refuse.** Colors, spacing and type that
  do not match the family are a theming delta, and theming closes it — adopt
  and theme. Refuse on presentation only when the *structure* is wrong: it
  renders a fundamentally different affordance than this card needs.
- **The factory composes; it does not install.** `catalog-reuse` rule 5 says
  never hand-copy a Listing — reuse it whole through `install` or `remix`.
  That rule is written for a person furnishing a workspace, and it is **out of
  scope here**: this factory builds new cards from a brief, so a Listing is
  read as *precedent and parts* — the definitions inside it are reusable
  through the wiring forms below, the bundle itself is not installed. Do not
  record `install` or `remix` as a wiring form, and do not treat a matching
  Listing as a reason to stop building. If a Listing answers the brief so
  completely that building is obviously wasted, say so via `post_update` and
  let a human decide — that is a question about the brief, not a reuse
  decision you can take.
- **Base-realm imports are not reuse.** `StringField`, `EmailField`,
  `ImageDef` and their siblings are the standard library. Never record one
  as a reuse decision — §3 owns them instead.
- **A base type you inherit through an adoption is still not a reuse row.**
  When you `EXTEND` or adopt a catalog block, the fields it brings with it are
  already covered by that block's row — the adoption is the decision, and
  listing an inherited `EmailField` separately double-counts it and puts a
  base-realm module in a table that is supposed to mean "a catalog block was
  considered". Name the inherited fields in the adopting row's `Wiring`
  instead, and record the type itself in `Base types` marked `inherited`.
- Record the outcome as a **Reuse decisions** table in
  `design/<card-slug>-NOTES.md`, under a `searched:` line giving the paths
  queried and their per-kind spec counts (plus a `CAVEAT:` line if any count
  looked partial). One row per need, including the card itself:
  need → kind (`card` / `field` / `component` / `command`) → decision
  (`REFERENCE` / `EXTEND` / `REUSE-BLOCKED` / `GAP`) → module and name →
  wiring form (`adoptsFrom` or `extends`, import + `contains`, `linksTo`).
  The decisions are told apart by cause: `REFERENCE` (the catalog has it —
  wire it in as-is), `EXTEND` (a near miss with the right shape — subclass
  it and name the fields you add), `REUSE-BLOCKED` (a candidate exists but
  cannot be used or extended — name it and the blocking mechanism, then
  build it yourself), `GAP` (the catalog has nothing — build it yourself).
  The last two both end in building it yourself; never record both for one
  need. Wire every `REFERENCE` and `EXTEND` row in §5 rather than writing
  your own equivalent. **All four kinds must appear** — as a decision row,
  or as one explicit `GAP` row saying nothing in that kind fitted; a kind
  with no row is indistinguishable from one never searched. Every definition
  you hand-build carries a row — `GAP` or `REUSE-BLOCKED`, either is a
  correct outcome with a real reason. A hand-built definition with no row at
  all is the omission.
- **If a gate blocks an adoption you want**, record `REUSE-BLOCKED` with the
  gate and its exact error and `post_update` the same — never quietly
  hand-build the thing instead.

{{/if}}

## 3. BASE TYPES — resolve each need to its most specific type

Reuse asks *whose definition*. This asks *which standard-library type*, and
it is a separate question you must answer before the mockup fixes a schema.

- Pick the **most specific base-realm type that fits** each need —
  `EmailField` over `StringField` for an email address, `PhoneNumberField`
  for a phone number, `UrlField` for a link, and likewise `DateField`,
  `BooleanField`, `EnumField`, `AddressField`, `AmountWithCurrency`,
  `ColorField`, `CountryField`. A specific type carries validation and a real
  editor; a string merely holds the same characters.
- **The issue body's field list states intent, not prescription.** An issue
  that says `email` (StringField) is naming the *need*; you are the step that
  resolves it to a type. Choose the more specific type over what the issue
  text names, unless that entry is marked `type-fixed:` — which means the
  concrete type is load-bearing and must survive.
- **A type you inherit from an adopted block still gets a line here**, marked
  `inherited` and naming the block it comes from — you did not choose it, but
  the build turn must know not to re-declare it.
- Record these as a **Base types** block in the notes, *not* in the Reuse
  decisions table — keeping them apart is what lets that table mean "a
  catalog block was considered". A row whose module starts with
  `https://cardstack.com/base/` is a defect **even when the type arrived
  through an adoption**; check the table against that rule before asserting
  compliance in the notes:

  ```
  Base types
  - email → EmailField  [inherited from PersonBase — do not re-declare]
  - phone → PhoneNumberField (PersonBase declares StringField; narrowed here)
  - joinedOn → DateField  [type-fixed: per issue]
  ```

## 4. DESIGN — HTML mockup before any schema

- Write `design/<card-slug>.html`: **ONE page** — a plain HTML+CSS mockup of
  the card with **hard-coded, realistic sample copy** (real names, real
  numbers — never lorem ipsum). Put every surface on that one page, labeled:
  the isolated view (mobile width; add a wide variant section if the card
  prefers wide format), the fitted tiles (badge / strip / card), and an
  embedded list row. One file, one screenshot, one crit pass covers
  everything — do NOT write a separate HTML file per surface.
- Call `screenshot_html({ path: "design/<card-slug>.html" })`, then `Read`
  the returned PNG and **critique it**: name concrete defects (hierarchy,
  wrapping, spacing, color, copy) against the design language in the
  Knowledge section. Revise the HTML and re-screenshot. Do at least one
  full crit-and-revise pass; stop when you would show it to a designer.

## 5. BUILD — translate the accepted mockup

- Write the card definition (`.gts`) with `isolated`, `embedded`, AND
  `fitted` templates that reproduce the accepted mockup. Design decisions
  were made in step 4 — this is a translation task.
- **Style through the project Theme.** Set `cardInfo.theme` on your sample
  instances to the Theme the design-foundation turn resolved (its id is in
  the brand guide), and write every template value as `var(--*)` per the
  notes' theme-variable mapping. No color, font-family or spacing literal
  belongs in a template — a literal is a value the Theme cannot reach, so
  swapping the Theme silently leaves it behind.
- Fields are an API other cards compose with: name them for consumers,
  and prefer FieldDefs for shapes that will recur.
- Write at least one sample card instance (`.json`) using the SAME sample
  data as the mockup.
- Write a Catalog Spec card (`Spec/<card-slug>.json`, adoptsFrom
  `@cardstack/base/spec#Spec`) linking the sample instances via
  `linkedExamples`, with its catalog-facing `title` and one-sentence
  `description` attributes populated (never left empty).

## 6. VERIFY

- `run_lint({ path })` each file you wrote; then `run_parse()`,
  `run_evaluate()`, and `run_instantiate()` for the whole realm.
- Fix what they report. **Do NOT write any `.test.gts` files** — tests
  belong to a separate hardening phase that runs later; this loop ships
  zero tests by design.

## 7. Done

- Call `signal_done` (factory MCP tool). The orchestrator validates
  parse/lint/eval/instantiate automatically. Do NOT set the issue status
  yourself. Calling `signal_done` without the design artifacts, the card,
  an instance, and a Spec is a failure.

## After you finish (render gate)

The orchestrator will screenshot the cards you shipped (real host
renders) and a verifier agent will judge every acceptance criterion
against the PIXELS — a criterion only passes on a visible, working
affordance. "The command class exists" fails. So: every capability the
issue promises must be reachable through something the user can SEE
(a button, a populated list, a rendered value), and your sample
instances must make each surface render with real content, never an
empty state.
