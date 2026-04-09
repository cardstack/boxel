# Test Generation

You implemented the following files for issue {{issue.id}}:

{{#each implementedFiles}}

## {{path}} ({{realm}} realm)

```
{{content}}
```

{{/each}}

Now generate QUnit test files that verify this implementation.

Tests must:

- Be co-located with the card definition as `{card-name}.test.gts`
- Export a `runTests()` function that registers QUnit modules and tests
- Verify that card instances render correctly (fitted, isolated, embedded views)
- Verify card-specific behavior, field values, and relationships
- Keep all test data in browser memory — no external realm writes

Use write_file to create test files, then call signal_done.
