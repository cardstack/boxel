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

Implement this ticket. Return actions that:

1. Create or update card definitions (.gts) and/or card instances (.json) in the target realm
2. Create test specs (.spec.ts) in the target realm's `Tests/` folder that verify your implementation
3. Use `invoke_tool` actions to inspect existing realm state before creating files

Start with the smallest working implementation, then add the test.
