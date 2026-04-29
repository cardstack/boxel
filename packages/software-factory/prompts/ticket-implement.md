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

Implement this issue in this order:

1. Inspect existing target-realm state with `Read` / `Glob` / `Grep` on
   the workspace; use `npx boxel search` for cross-realm context.
2. Write card definitions (`.gts`) directly into the workspace with
   `Write` / `Edit`.
3. Write QUnit test files (`.test.gts`) co-located with card
   definitions — write tests BEFORE any sample instances or catalog
   specs. **Wrap every test in a QUnit `module(...)` block** named
   after the card or feature under test (e.g.,
   `module('StickyNote', function (hooks) { ... test(...) ... })`).
   The TestRun card groups results by module name; tests left at the
   top level all collapse into a single "default" bucket.
4. Create at least one sample card instance (`.json`) in the
   workspace.
5. Create a Catalog Spec card in the `Spec/` folder for the top-level
   card (`adoptsFrom: https://cardstack.com/base/spec#Spec`), linking
   sample instances via `linkedExamples`.
6. End your turn when all files are written. The orchestrator runs
   validation and either marks the issue done or feeds failures back
   to you in the next iteration. Do NOT set the issue status yourself.
