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

1. Use search_realm and read_file to inspect existing realm state
2. Use write_file to create or update card definitions (.gts) in the target realm
3. Use write_file to create QUnit test files (.test.gts) co-located with card definitions — write tests BEFORE any sample instances or catalog specs. **Wrap every test in a QUnit `module(...)` block named after the card or feature under test** (e.g., `module('StickyNote', function (hooks) { ... test(...) ... })`). The TestRun card groups results by module name, so tests left at the top level all collapse into a single "default" bucket and become hard to read.
4. Create at least one sample card instance (.json) in the target realm
5. Create a Catalog Spec card in the Spec/ folder for the top-level card (adoptsFrom https://cardstack.com/base/spec#Spec), linking sample instances via linkedExamples
6. Call signal_done when all implementation and test files have been written

The validation pipeline runs tests automatically after `signal_done` — write tests, then signal done, and the orchestrator handles the rest. Do NOT set the issue status to "done" yourself — the orchestrator manages issue status transitions based on validation results.
