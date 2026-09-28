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

# Instructions — BUILD TURN

This is the **build half** of a phase-split issue. The design turn already
produced accepted mockups and notes under `design/` (you may remember making
them — this session is forked from that turn). Design decisions are MADE;
this is a translation task. Do not redesign, do not re-screenshot mockups.

**Live-blog as you go.** Call `post_update` when you start each file, on any
non-obvious translation decision, and when recovering from a failed check.

## 1. Load the contract

- `Read` `design/<card-slug>-NOTES.md` and the accepted `design/<card-slug>.html`
  (+ its PNG). These are authoritative — follow them exactly.
{{#if enableCatalogReuse}}
- The notes' **Reuse decisions** table is part of that contract. Every
  `REFERENCE` row is a module you import rather than a definition you
  write; every `EXTEND` row is a module you adopt as a base and specialize
  with the fields the row names; `GAP` and `REUSE-BLOCKED` rows are the ones
  you build yourself.
{{/if}}
- The notes' **Base types** block is also binding, and it **overrides any
  field type named in the issue body** — the design turn resolved each need
  to its most specific base-realm type, and that is the decision. The one
  exception is an entry marked `type-fixed:`, where the issue's type stands.
  Reverting a `Base types` line to what the issue text said is a defect.

## 2. BUILD — translate the accepted mockup

{{#if enableCatalogReuse}}
- **Wire the `REFERENCE` and `EXTEND` rows first.** Adopt (`adoptsFrom` /
  `extends`), import + `contains`, or `linksTo` exactly as the row's
  `Wiring` column says, before writing anything of your own. An `EXTEND`
  row means you subclass the named module and add only the fields the row
  lists — not re-declare the ones it already supplies. Hand-writing an
  equivalent of a row the design turn adopted silently discards a decision
  already made — if a row genuinely cannot be wired, say so with
  `post_update` and record the gate's error; do not substitute.
{{/if}}
- Write the card definition (`.gts`) with `isolated`, `embedded`, AND
  `fitted` templates reproducing the accepted mockup.
- **Style through the project Theme.** Link it — set `cardInfo.theme` on
  your sample instances to the Theme the design-foundation turn resolved
  (its id is in the brand guide) — and write every template value as
  `var(--*)` per the notes' theme-variable mapping. **No color, font-family
  or spacing literal belongs in a template**: a literal is a value the Theme
  cannot reach, so swapping the Theme silently leaves it behind. If the
  mockup needs a value the Theme has no variable for, `post_update` the gap
  and use the nearest Theme variable rather than inventing a local constant.
- Fields are an API other cards compose with: name them for consumers,
  prefer FieldDefs for shapes that recur (the notes name them).
- Write sample card instances (`.json`) using the SAME sample data as the
  mockup.
- Write a Catalog Spec card (`Spec/<card-slug>.json`, adoptsFrom
  `@cardstack/base/spec#Spec`) linking sample instances via
  `linkedExamples`, with `title` and one-sentence `description` populated.

## 3. VERIFY

- `run_lint({ path })` each file; then `run_parse()`, `run_evaluate()`,
  `run_instantiate()` for the whole realm. Fix what they report.
- **Fix with `Edit`, not `Write`.** Once a file exists, every fix is a
  surgical search/replace `Edit` on the failing lines — re-emitting the
  whole file costs 1–2 minutes of generation per attempt and is the main
  reason build turns run long. Failures in files you didn't write this
  turn are pre-existing: note them via `post_update` and move on.
- **Do NOT write any `.test.gts` files** — tests belong to a later
  hardening phase.

## 4. Done

- Self-audit the contract before signalling:
{{#if enableCatalogReuse}}
  - every `REFERENCE` row appears as a real import in the `.gts`, and every
    `EXTEND` row as a real `extends` of the named module;
  - every definition you wrote by hand corresponds to a `GAP` or
    `REUSE-BLOCKED` row;
{{/if}}
  - every `Base types` line is the type the field actually has;
  - `cardInfo.theme` is set, and the templates carry no color, font-family
    or spacing literal.

  A mismatch on any of these is a defect — fix it, or `post_update` why the
  row could not be honoured.
- Call `signal_done`. The orchestrator validates automatically. Calling it
  without the card, an instance, and a Spec is a failure.

## After you finish (render gate)

The orchestrator will screenshot the cards you shipped (real host
renders) and a verifier agent will judge every acceptance criterion
against the PIXELS — a criterion only passes on a visible, working
affordance. "The command class exists" fails. So: every capability the
issue promises must be reachable through something the user can SEE
(a button, a populated list, a rendered value), and your sample
instances must make each surface render with real content, never an
empty state.
