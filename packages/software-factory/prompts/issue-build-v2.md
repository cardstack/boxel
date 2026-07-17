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

## 2. BUILD — translate the accepted mockup

- Write the card definition (`.gts`) with `isolated`, `embedded`, AND
  `fitted` templates reproducing the accepted mockup. Use theme CSS
  variables (`var(--*)`) per the notes' token mapping.
- Fields are an API other cards compose with: name them for consumers,
  prefer FieldDefs for shapes that recur (the notes name them).
- Write sample card instances (`.json`) using the SAME sample data as the
  mockup.
- Write a Catalog Spec card (`Spec/<card-slug>.json`, adoptsFrom
  `https://cardstack.com/base/spec#Spec`) linking sample instances via
  `linkedExamples`, with `title` and one-sentence `description` populated.

## 3. VERIFY

- `run_lint({ path })` each file; then `run_parse()`, `run_evaluate()`,
  `run_instantiate()` for the whole realm. Fix what they report.
- **Do NOT write any `.test.gts` files** — tests belong to a later
  hardening phase.

## 4. Done

- Call `signal_done`. The orchestrator validates automatically. Calling it
  without the card, an instance, and a Spec is a failure.

## After you finish (v3 render gate)

The orchestrator will screenshot the cards you shipped (real host
renders) and a verifier agent will judge every acceptance criterion
against the PIXELS — a criterion only passes on a visible, working
affordance. "The command class exists" fails. So: every capability the
issue promises must be reachable through something the user can SEE
(a button, a populated list, a rendered value), and your sample
instances must make each surface render with real content, never an
empty state.
