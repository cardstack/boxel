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
- The notes' **Reuse decisions** table is part of that contract. Every
  `REFERENCE` row is a module you import rather than a definition you
  write; only `GAP` rows are yours to build.

## 2. BUILD — translate the accepted mockup

- **Wire the `REFERENCE` rows first.** Adopt (`adoptsFrom`), import +
  `contains`, or `linksTo` exactly as the row's `Wiring` column says,
  before writing anything of your own. Hand-writing an equivalent of a row
  the design turn adopted silently discards a decision already made — if a
  row genuinely cannot be wired, say so with `post_update` and record the
  gate's error; do not substitute.
- Write the card definition (`.gts`) with `isolated`, `embedded`, AND
  `fitted` templates reproducing the accepted mockup. Use theme CSS
  variables (`var(--*)`) per the notes' token mapping.
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

- Self-audit the contract before signalling: every `REFERENCE` row appears
  as a real import in the `.gts`, and every definition you wrote by hand
  corresponds to a `GAP` row. A mismatch either way is a defect — fix it,
  or `post_update` why the row could not be honoured.
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
