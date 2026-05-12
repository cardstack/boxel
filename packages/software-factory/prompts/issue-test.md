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
- **Wrap every `test(...)` inside a QUnit `module('<card-or-feature-name>', function (hooks) { ... })` block.** The TestRun card's UI groups results by module name, so tests registered at the top level collapse into a single "default" bucket and become hard to read at a glance.
- Verify that card instances render correctly (fitted, isolated, embedded views)
- Verify card-specific behavior, field values, and relationships
- Keep all test data in browser memory — no external realm writes

Call **`Write`** to create the test files in the workspace, then call **`signal_done`** (factory MCP tool).
