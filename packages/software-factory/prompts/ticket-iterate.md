# Project

{{project.objective}}

# Current Ticket

ID: {{ticket.id}}
Summary: {{ticket.summary}}

Description:
{{ticket.description}}

# Previous Attempt (iteration {{iteration}})

In the previous iteration, you made the following tool calls:

{{#each previousActions}}

## {{type}}: {{path}} ({{realm}} realm)

```
{{content}}
```

{{/each}}

# Test Results

The orchestrator ran tests after your previous attempt. They failed.

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

```{{outputFormat}}
{{output}}
```

{{/each}}
{{/if}}

# Instructions

Fix the failing tests. You have the same tools available. You can:

- Use read_file to inspect the current state of your implementation
- Use write_file to update implementation or test files
- Use search_realm to check what cards exist
- If the test expectation is wrong, fix the test
- If the implementation is wrong, fix the implementation

When done, call signal_done.
