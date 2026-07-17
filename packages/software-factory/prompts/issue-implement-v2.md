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

## 1. Ground yourself (context before code)

- `Read` / `Glob` the workspace; `Bash` + `boxel search --realm <target-realm-url>` for cards already in the target realm.
- Call `list_skills`, then `read_skill` the skills this issue actually touches
  (design, fitted formats, theming, file fields, queries — whatever applies).
  Read precedent: if a similar card exists in the workspace, read its `.gts`.

## 2. DESIGN — HTML mockup before any schema

- Write `design/<card-slug>.html`: a plain HTML+CSS mockup of the card with
  **hard-coded, realistic sample copy** (real names, real numbers — never
  lorem ipsum). Show every surface that matters on one page: the isolated
  view (mobile width), the fitted tiles (badge / strip / card), and an
  embedded list row.
- Call `screenshot_html({ path: "design/<card-slug>.html" })`, then `Read`
  the returned PNG and **critique it**: name concrete defects (hierarchy,
  wrapping, spacing, color, copy) against the design language in the
  Knowledge section. Revise the HTML and re-screenshot. Do at least one
  full crit-and-revise pass; stop when you would show it to a designer.

## 3. BUILD — translate the accepted mockup

- Write the card definition (`.gts`) with `isolated`, `embedded`, AND
  `fitted` templates that reproduce the accepted mockup. Design decisions
  were made in step 2 — this is a translation task. Use theme CSS variables
  (`var(--*)`) rather than hard-coded colors where a theme exists.
- Fields are an API other cards compose with: name them for consumers,
  and prefer FieldDefs for shapes that will recur.
- Write at least one sample card instance (`.json`) using the SAME sample
  data as the mockup.
- Write a Catalog Spec card (`Spec/<card-slug>.json`, adoptsFrom
  `https://cardstack.com/base/spec#Spec`) linking the sample instances via
  `linkedExamples`, with its catalog-facing `title` and one-sentence
  `description` attributes populated (never left empty).

## 4. VERIFY

- `run_lint({ path })` each file you wrote; then `run_parse()`,
  `run_evaluate()`, and `run_instantiate()` for the whole realm.
- Fix what they report. **Do NOT write any `.test.gts` files** — tests
  belong to a separate hardening phase that runs later; this loop ships
  zero tests by design.

## 5. Done

- Call `signal_done` (factory MCP tool). The orchestrator validates
  parse/lint/eval/instantiate automatically. Do NOT set the issue status
  yourself. Calling `signal_done` without the design artifacts, the card,
  an instance, and a Spec is a failure.
