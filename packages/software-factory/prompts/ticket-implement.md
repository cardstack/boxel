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

# Current Ticket

ID: {{ticket.id}}
Summary: {{ticket.summary}}
Status: {{ticket.status}}
Priority: {{ticket.priority}}

Description:
{{ticket.description}}

{{#if ticket.checklist}}
Checklist:
{{#each ticket.checklist}}
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

Implement this ticket:

1. Use search_realm and read_file to inspect existing realm state
2. Use write_file to create or update card definitions (.gts) and/or card instances (.json) in the target realm
3. Create a Catalog Spec card in the Spec/ folder for the top-level card (adoptsFrom https://cardstack.com/base/spec#Spec)
4. Create at least one sample card instance and link it from the Catalog Spec via linkedExamples
5. Use write_file to create Playwright test specs (.spec.ts) in the target realm's `Tests/` folder. Tests MUST navigate to card instances in the browser (page.goto) and assert on rendered DOM content using data-test-* selectors. API-only tests (request.get) are not sufficient — they miss compilation errors, broken imports, and template bugs.
6. Call signal_done when all implementation and test files have been written

Start with the smallest working implementation, then add the test.
