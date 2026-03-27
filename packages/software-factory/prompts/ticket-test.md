# Test Generation

You implemented the following files for ticket {{ticket.id}}:

{{#each implementedFiles}}

## {{path}} ({{realm}} realm)

```
{{content}}
```

{{/each}}

Now generate Playwright test specs that verify this implementation.

Tests must:

- Live in the test realm as test spec files
- Import from the test fixtures and use the factory test harness
- Verify that card instances render correctly (fitted, isolated, embedded views)
- Verify card-specific behavior, field values, and relationships
- Be runnable by the `run-realm-tests` tool

Return only `create_test` actions.
