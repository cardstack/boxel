# Project

{{project.objective}}

# Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}

Description:
{{issue.description}}

# Previous Attempt (iteration {{iteration}})

In the previous iteration, you made the following tool calls:

{{#each previousActions}}

## {{type}}: {{path}} ({{realm}} realm)

```
{{content}}
```

{{/each}}

# Validation Results

The orchestrator ran validation after your previous attempt. There were failures.

{{#if validationContext}}
{{validationContext}}
{{else}}
All validation steps passed.
{{/if}}

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

Fix the validation failures shown above. You have the same tools available. You can:

- Use **`Read`** / **`Glob`** to inspect the current state of your implementation
- Use **`Write`** or **`Edit`** to update implementation or test files
- Use **`Bash`** + `boxel search` to check what cards exist in the realm
- If a lint violation is in your code, fix the code to pass lint
- If the test expectation is wrong, fix the test
- If the implementation is wrong, fix the implementation

When done, call **`signal_done`** (factory MCP tool).
