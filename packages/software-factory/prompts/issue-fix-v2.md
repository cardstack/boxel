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

You previously invoked the following tools. Use these results to inform your fix.

{{#each toolResults}}

## {{tool}} (exit code: {{exitCode}})

```{{outputFormat}}
{{output}}
```

{{/each}}
{{/if}}

# Instructions

This is a **bug fix on an existing card**, not a new build. The card and its
design already exist and shipped; something is broken. Your job is to find the
root cause and fix it with the smallest change that resolves the defect —
**not** to redesign the card.

**Do NOT run a design round.** No HTML mockups, no `screenshot_html`, no
design critique. The look is already decided; you are correcting behavior.
Preserve the existing templates, theme, fields, and sample data except for
what the bug requires you to change.

**Live-blog as you go.** The operator watches this run on a live run-log card.
Call `post_update` at every meaningful moment — the root cause once you find
it, the fix and why it works, recovering from a failed check. First person,
concrete, 1–3 sentences. Never work silently for more than a few minutes.

## 1. Reproduce & locate

- Read the issue above: the symptom, any error message, and the repro path.
- `Read` the offending `.gts` (and any card it composes with or links to).
  The error usually names the surface — an isolated/embedded/fitted template,
  a computed field, or a query. A `Cannot read properties of undefined`
  crash is almost always a template or computed reading a field that can be
  null/absent for the failing instance.
- `read_skill` only the skills the fix actually touches (the failing
  template/format, the field type involved) — skip the general design skills.

## 2. Diagnose the root cause

- State the actual cause, not just the symptom: which value is undefined,
  on which code path, for which instance shape. Confirm it against the code
  you read — don't guess. `post_update` the root cause.

## 3. Fix minimally

- Make the smallest change that resolves it: guard the undefined access,
  correct the field/query, fix the computed. Keep every unrelated line intact.
- If the bug is that a sample instance is missing data the card needs, fix the
  instance — but do not restyle the card.
- Only add a Spec or new instance if the issue explicitly calls for one.

## 4. Verify

- `run_lint({ path })` each file you changed; then `run_parse()`,
  `run_evaluate()`, and `run_instantiate()` for the whole realm. Fix what
  they report.
- **Do NOT write any `.test.gts` files** — tests belong to a separate phase.

## 5. Done

- Call `signal_done` (factory MCP tool). The orchestrator validates
  parse/lint/eval/instantiate automatically. Do NOT set the issue status
  yourself.

## After you finish (v3 render gate)

The orchestrator will screenshot the affected card (a real host render) and a
verifier agent will judge the fix against the PIXELS — the defect only counts
as fixed when the surface it broke renders correctly with real content. Make
sure the instance that exposed the bug now renders cleanly.
