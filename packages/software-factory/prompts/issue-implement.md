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

## 2. REUSE — decide what you are not building

The catalog is a library of work already done. Consult it **before** you
mock: a schema you adopt is a given the mockup designs around, and a schema
the mockup already fixed is one you can no longer adopt.

- **Enumerate the needs this issue implies, the card itself first.** The
  card you are building is need #1 — the catalog may already publish it, or
  one close enough to adopt. Then its fields, then any component or command.
  A list that starts at the fields has already decided the card is new.
- **Consult the catalog per need.** `catalog-reuse` has the query shapes and
  how to judge a hit — follow it rather than inventing a query.
- **Disposition every hit you get back.** Adopted, or refused naming the
  mismatched fields or the design rule it breaks. A hit you drop without
  saying why is indistinguishable from one you never saw.
- **Base-realm imports are not reuse.** `StringField`, `EmailField`,
  `ImageDef` and their siblings are the standard library. Never record one
  as a reuse decision.
- Record the outcome as a **Reuse decisions** table in
  `design/<card-slug>-NOTES.md` — one row per need, including the card
  itself: need → decision (`REFERENCE` / `REUSE-BLOCKED` / `GAP`) → module
  and name → wiring form (`adoptsFrom`, import + `contains`, `linksTo`).
  Wire every `REFERENCE` row in §4 rather than writing your own equivalent;
  only `GAP` rows are yours to build. A hand-built definition with no `GAP`
  row is an omission, not a choice — and a reasoned `GAP` or `REUSE-BLOCKED`
  is a correct outcome, not a failure.
- **If a gate blocks an adoption you want**, record `REUSE-BLOCKED` with the
  gate and its exact error and `post_update` the same — never quietly
  hand-build the thing instead.

## 3. DESIGN — HTML mockup before any schema

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

## 4. BUILD — translate the accepted mockup

- Write the card definition (`.gts`) with `isolated`, `embedded`, AND
  `fitted` templates that reproduce the accepted mockup. Design decisions
  were made in step 3 — this is a translation task. Use theme CSS variables
  (`var(--*)`) rather than hard-coded colors where a theme exists.
- Fields are an API other cards compose with: name them for consumers,
  and prefer FieldDefs for shapes that will recur.
- Write at least one sample card instance (`.json`) using the SAME sample
  data as the mockup.
- Write a Catalog Spec card (`Spec/<card-slug>.json`, adoptsFrom
  `@cardstack/base/spec#Spec`) linking the sample instances via
  `linkedExamples`, with its catalog-facing `title` and one-sentence
  `description` attributes populated (never left empty).

## 5. VERIFY

- `run_lint({ path })` each file you wrote; then `run_parse()`,
  `run_evaluate()`, and `run_instantiate()` for the whole realm.
- Fix what they report. **Do NOT write any `.test.gts` files** — tests
  belong to a separate hardening phase that runs later; this loop ships
  zero tests by design.

## 6. Done

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
