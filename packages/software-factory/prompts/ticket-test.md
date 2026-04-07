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

- Live in the target realm's `Tests/` folder as `Tests/{ticket-slug}.spec.ts`
- Import from the test fixtures and use the factory test harness
- Verify that card instances render correctly (fitted, isolated, embedded views)
- Verify card-specific behavior, field values, and relationships
- Be runnable by the `run-realm-tests` tool

Use write_file to create test files, then call signal_done.
