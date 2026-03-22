# Project

{{project.objective}}

# Current Ticket

ID: {{ticket.id}}
Summary: {{ticket.summary}}

Description:
{{ticket.description}}

# Previous Attempt (iteration {{iteration}})

You previously produced the following actions for this ticket:

{{#each previousActions}}

## {{type}}: {{path}} ({{realm}} realm)

```
{{content}}
```

{{/each}}

# Test Results

The orchestrator applied your actions and ran tests. They failed.

Status: {{testResults.status}}
Passed: {{testResults.passedCount}}
Failed: {{testResults.failedCount}}
Duration: {{testResults.durationMs}}ms

{{#each testResults.failures}}

## Failure: {{testName}}

```
{{error}}
```

{{#if stackTrace}}
Stack trace:

```
{{stackTrace}}
```

{{/if}}
{{/each}}

{{#if toolResults}}

# Tool Results From Previous Iteration

{{#each toolResults}}

## {{tool}} (exit code: {{exitCode}})

```json
{{output}}
```

{{/each}}
{{/if}}

# Instructions

Fix the failing tests. You may:

- Update implementation files (use `update_file` actions)
- Update test specs (use `update_test` actions)
- Invoke tools to inspect current realm state
- If the test expectation is wrong, fix the test
- If the implementation is wrong, fix the implementation

Return the actions needed to make all tests pass.
