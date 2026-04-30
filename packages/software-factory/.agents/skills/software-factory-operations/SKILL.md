---
name: software-factory-operations
description: Use when implementing cards in a target realm through the factory execution loop — covers the tool-use workflow for searching, writing, testing, and updating issues via factory tools.
---

# Software Factory Operations

Use this skill when operating inside the factory execution loop. The factory agent edits **target-realm files in a local workspace directory** using its native filesystem tools (`Read` / `Write` / `Edit` / shell), and uses **executable tool functions** for everything else (search, lint, validation, project state, control flow). Target-realm files are pre-synced into the workspace and the loop handles target-realm sync between your turns. For other realm operations, use the available tools.

## Realm Roles

- **Source realm** (`packages/software-factory/realm`)
  Publishes shared modules, briefs, templates, and tracker schema. Never write to this realm.
- **Target realm** (user-specified, passed to `factory:go`)
  Receives all generated artifacts: Project, Issue, KnowledgeArticle, card definitions, card instances, Catalog Spec cards, and QUnit test files.

## Available Tools

The agent has these tools during the execution loop. Use them by name — they are provided via the LLM's native tool-use protocol.

### Reading and Searching

- **Reading target-realm files** — Use your native `Read` tool (or shell `cat` / `head` / `grep`) on files in the workspace directory. There is no `read_file` tool; the workspace dir is just a normal local directory.
- `read_transpiled({ path, realm? })` — Fetch the compiled JavaScript output of a `.gts` module. Use when an eval/instantiate error reports a line/column — those numbers reference the transpiled output, not your source.
- `realm_search({ 'realm-url', query })` — Search for cards using a structured query object (filter, sort, page). `realm-url` is required — pass the target realm URL when searching the realm you're implementing against. Use to check for existing cards, find duplicates, inspect project state.

### Writing Files

- **Writing target-realm files** — Use your native `Write` / `Edit` tools (or shell redirects) on files in the workspace directory. Path is whatever fits inside the workspace dir; the loop syncs the workspace to the realm between iterations. Always write clean idiomatic source — never compiled JSON blocks, base64-encoded content, or wire-format template arrays.
- For files in non-target realms (scratch, source, catalog, etc.) the agent has no local workspace — use `realm_write_file({ 'realm-url', path, content })` or `realm_read_file({ 'realm-url', path })` instead.

### Updating Project State

- `update_project({ path, attributes, relationships? })` — Update a Project card in the target realm. The tool's parameters include a dynamic JSON schema describing available fields — use it to know valid field names and types. The tool auto-constructs the JSON:API document with the correct `adoptsFrom`.
- `update_issue({ path, attributes, relationships? })` — Update an Issue card. Same structured interface with dynamic field schema in the tool parameters. **Note:** `description` is stripped — issue descriptions are immutable after creation. Use `add_comment` to add context.
- `add_comment({ path, body, author })` — Append a comment to an existing issue. Use this to record context, blocked reasons, validation failures, or any post-creation updates. Comments are append-only — they cannot be edited or deleted.
- `create_knowledge({ path, attributes, relationships? })` — Create or update a KnowledgeArticle card. Same structured interface with dynamic field schema in the tool parameters.
- `create_catalog_spec({ path, attributes, relationships? })` — Create a Catalog Spec card in the target realm's `Spec/` folder. Makes a card definition discoverable in the Boxel catalog. Same structured interface with dynamic field schema. The tool auto-constructs the document with `adoptsFrom` pointing to `https://cardstack.com/base/spec#Spec`.

### Running Host Commands

- `run_command({ command, commandInput? })` — Execute a host command on the realm server via the prerenderer. Commands run in browser context with full card runtime access (Loader, CardAPI, services). Use the specifier format `@cardstack/boxel-host/commands/<name>/default`.

**Example — generate JSON schema for a card type:**

```
run_command({
  command: "@cardstack/boxel-host/commands/get-card-type-schema/default",
  commandInput: {
    codeRef: {
      module: "https://realm.example/darkfactory",
      name: "Project"
    }
  }
})
```

Returns `{ status: "ready", result: "<serialized JsonCard with schema>" }`. Parse `result` as JSON to get the schema with `attributes` and `relationships` properties.

### Self-Validation (optional, no side effects)

All five tools are safe to call repeatedly mid-turn; none of them write a realm artifact. The orchestrator still runs the full validation pipeline (which persists the durable `TestRun` / `LintResult` / `ParseResult` / `EvalResult` / `InstantiateResult` cards) after `signal_done`, so calling any of these is optional.

- `run_lint({ path? })` — Run ESLint + Prettier (with `@cardstack/boxel` rules) and return an in-memory `RunLintResult` with `status`, `filesChecked`, `filesWithErrors`, `errorCount`, `warningCount`, `durationMs`, `lintableFiles`, and per-violation `{ rule, file, line, column, message, severity }`. Without `path`, lints every `.gts` / `.gjs` / `.ts` / `.js` file in the target realm. With `path` (realm-relative file path), lints **only that one file** — prefer this right after writing or editing a single file.
- `run_tests()` — Run the realm's QUnit suite and receive an in-memory result object `{ status, passedCount, failedCount, skippedCount, durationMs, testFiles, failures, errorMessage? }`. Use it when you want feedback before signalling done.
- `run_parse({ path? })` — Parse and type-check files in the target realm and return an in-memory `RunParseResult` with `status`, `filesChecked`, `filesWithErrors`, `errorCount`, `durationMs`, `parseableFiles`, and per-error `{ file, line, column, message }`. Without `path`, runs glint (ember-tsc) over every `.gts` / `.gjs` / `.ts` file in the realm AND validates every `.json` file listed as a Spec `linkedExample` (same discovery as the parse validation step). With `path` (realm-relative file path), parses **only that one file** — `.gts` / `.gjs` / `.ts` runs through glint; `.json` is parsed and checked for card document structure. The extension is required; `parseableFiles` entries are always returned in the `.json` / `.gts` / `.gjs` / `.ts` form, so you can feed any of them straight back into `path`. Prefer the single-file form right after writing or editing one file.
- `run_evaluate({ path? })` — Evaluate ESM modules (`.gts` / `.gjs` / `.ts` / `.js`) in the target realm via the prerenderer sandbox and return a `RunEvaluateResult` (status, module counts, per-failure `{ path, error, stackTrace? }`). Without `path`, evaluates every non-test evaluable module. With `path`, evaluates only that single realm-relative file — handy for a quick self-check right after writing one module. Test files (`*.test.*`) are rejected — the test runner validates those. When a failure reports a line/column, those numbers refer to the transpiled module — pair with `read_transpiled` to locate the offending source construct, then fix the `.gts` source (never copy transpiled patterns back into source).
- `run_instantiate({ path? })` — Instantiate card example instances in the target realm via the prerenderer sandbox and return a `RunInstantiateResult` (status, instance counts, per-failure `{ path, cardName, error, stackTrace? }`). Without `path`, searches the realm for Spec cards and instantiates every `linkedExample` on every card/app Spec; specs with no `linkedExamples` still get a bare instantiation to exercise the card class. With `path`, instantiates only that single realm-relative `.json` example file — its `meta.adoptsFrom` supplies the module + card name, and spec discovery is skipped entirely so you can self-check one instance in isolation. The `path` argument must end in `.json`. `instanceFiles` only contains real `.json` example paths (bare-instantiation fallbacks are filtered out) so any entry can be fed straight back into `path`. If a bare instantiation fails, its failure entry has `path: ''` and a populated `cardName` — identify the spec by `cardName` and do NOT pass the empty path back into `path`. When a failure reports a line/column, those numbers refer to the transpiled module — pair with `read_transpiled` to locate the offending source construct, then fix the `.gts` source (never copy transpiled patterns back into source).

### Control Flow

- `signal_done()` — Signal that the current issue is complete. Call this only after all implementation and test files have been written.
- `request_clarification({ message })` — Signal that you cannot proceed and need human input. Describe what is blocking.

### Important: Issue Descriptions Are Immutable

**Never modify an issue's `description` field after creation.** The description captures the original intent of the issue. If you need to add context — blocked reasons, progress notes, clarification requests, or any post-creation information — use `add_comment` instead. The `update_issue` tool strips `description` changes automatically.

## Required Flow

1. **Inspect before writing.** Use `realm_search` (with the target realm URL as `realm-url`) plus your native `Read` / `Grep` / shell tools on the workspace dir to understand what already exists before creating or modifying files.
2. **Write card definitions** (`.gts`) using your native `Write` tool into the workspace.
3. **Write `.test.gts` test files** co-located with card definitions, using your native `Write` tool. Every issue must have at least one test file. **Write tests immediately after the card definition, before any instances or catalog specs.**
4. **Write card instances** (`.json`) using your native `Write` tool. Place them in a folder named after the card type (e.g., `StickyNote/welcome-note.json`).
5. **Write a Catalog Spec card** (`Spec/<card-name>.json`) for each top-level card defined in the brief. Link sample instances via `linkedExamples`.
6. **(Optional) Call `run_tests()`** to self-validate before signalling done. This returns test results in-memory without writing any realm artifacts. Iterating on your own work with `run_tests` is faster than round-tripping through the orchestrator pipeline.
7. **Call `signal_done()`** when all implementation and test files are written. The orchestrator runs the full validation pipeline (which persists a `TestRun` card, among other artifacts) automatically after this.
8. **If tests fail**, the orchestrator feeds failure details back. Use your native `Read` / `Edit` tools on the workspace to inspect and fix implementation or test files. Call `signal_done()` again.
9. **Record progress** via `add_comment` — append notes, blocked reasons, or context to the issue. Never modify the issue description.

## Target Realm Artifact Structure

```
target-realm/
├── card-name.gts                    # Card definition
├── card-name.test.gts               # QUnit test (co-located)
├── CardName/
│   └── sample-instance.json         # Card instance
├── Spec/
│   └── card-name.json               # Catalog Spec card
├── Validations/
│   ├── test_issue-slug-1.json       # TestRun card (test results)
│   └── lint_issue-slug-1.json       # Lint result card
├── Projects/
│   └── project-name.json            # Project card
├── Issues/
│   └── issue-slug.json              # Issue card
└── Knowledge Articles/
    └── article-name.json            # KnowledgeArticle card
```

## Debugging Runtime Evaluation Errors

Eval-step and instantiate-step validation failures surface line/column
references that point to the **transpiled** JavaScript output, not the
`.gts` source you wrote. The realm compiles `.gts` to JS before execution
and runtime errors reference the compiled output.

When a validation error contains text like
`(error occurred in '/.../sticky-note.gts' @ line 66 : column 32)`, the
line number is for the transpiled module. Call
`read_transpiled({ path: 'sticky-note.gts' })` and read the
reported line to see what compiled construct raised the error — then
reason back to the `.gts` source construct that produced it.

For example, `" is not a valid character within attribute names: (error occurred in '/.../sticky-note.gts' @ line 66 : column 32)`
typically points inside a `precompileTemplate(...)` block in the
transpiled output. The actual fault in the source is often in a CSS
comment or a template expression — line 66 in your `.gts` source is
unrelated. Reading the transpiled line is what connects the error back
to the source.

### The transpiled output is for DEBUGGING ONLY — never for implementation

**Scope of this tool:** `read_transpiled` is only for
investigating **runtime errors in `.gts` modules you have already
written** — when an eval or instantiate validation failure points to
a line/column in the transpiled output and you need to map that
coordinate back to your source. It is not for learning how to write
cards, not for understanding Boxel patterns, and not a general
reference.

- **Do not copy patterns, imports, or shapes from the transpiled
  output into your `.gts` source.** The transpiler emits artifacts
  like `setComponentTemplate(...)`, `precompileTemplate(...)`, wire-format
  template arrays, base64 CSS imports (`./file.gts.CiAg...`), and other
  compiler internals. None of those belong in source code.
- **Do not write `.gts` that "looks like" the compiled JS.** Always
  write clean, idiomatic Ember / `<template>`-tag / CardDef / FieldDef
  source. If you find yourself tempted to hand-write a
  `setComponentTemplate(...)` call or a wire-format template, stop —
  you're modeling the wrong layer.
- **Always edit the `.gts` source, never the transpiled output.** The
  realm regenerates the transpiled JS on every write, so any edit
  there is silently discarded.
- **When in doubt, favor idiomatic card development practices.** The
  `boxel-development` skill and existing cards in the target realm are
  the right references — not what the compiler happens to emit.

Use `read_transpiled` the way a developer uses a source map:
to translate a runtime line number back to a source construct in the
code **you wrote**, then close the transpiled view and fix the source
idiomatically.

## Writing QUnit Card Tests

Test files are `.test.gts` files co-located with card definitions in the target realm. Each test file exports a `runTests()` function that registers QUnit modules and tests.

### Example Test

```typescript
// sticky-note.test.gts — co-located with sticky-note.gts
import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./sticky-note', import.meta.url).href;

export function runTests() {
  module('StickyNote', function (hooks) {
    setupCardTest(hooks);

    test('renders title in fitted view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = await loader.import(cardModuleUrl);
      let note = new StickyNote({ title: 'Test Note', body: 'Hello' });
      await renderCard(loader, note, 'fitted');
      assert.dom('[data-test-title]').hasText('Test Note');
    });
  });
}
```

### Key Points

- Tests are `.test.gts` files co-located with the card definition (e.g., `sticky-note.gts` and `sticky-note.test.gts`)
- Each test file must export a `runTests()` function
- Use `import.meta.url` to resolve card definitions relative to the test file — never hardcode realm URLs
- Use `setupCardTest(hooks)` for rendering context, then `renderCard(loader, card, format)` for DOM assertions
- No external realm writes during tests — all test data lives in browser memory
- Use `data-test-*` attributes for DOM selectors when testing rendered output
- Use QUnit assertions: `assert.dom()`, `assert.strictEqual()`, `assert.ok()`
- **Never use `QUnit.skip()` or `QUnit.todo()`.** All tests must actually execute. Skipped/todo tests are flagged as `skipped` in the TestRun card and treated as a failure when no tests actually ran. The orchestrator will reject a TestRun where every test is skipped.

## Important Rules

- **Never write to the source realm.** All generated artifacts go to the target realm (i.e., the workspace dir, which the loop syncs to the realm).
- **Edit the workspace for target-realm files.** Target-realm files live in a local workspace directory — use your native `Read` / `Write` / `Edit` / shell tools on them. The loop handles target-realm sync between turns. For any other realm operation, use the available tools.
- **Realm-server tools require `realm-url`.** `realm_search` / `realm_read_file` / `realm_write_file` / `realm_delete_file` / `realm_lint_file` all take an explicit `realm-url`. The realm-mutating ones (`realm_write_file` / `realm_delete_file`) are reserved for non-target realms; for the target realm, edit the workspace.
- **Write source code, not compiled output.** When writing `.gts` files, write clean idiomatic source — never compiled JSON blocks or base64-encoded content.
- **Use absolute `adoptsFrom.module` URLs** when referencing definitions that live in a different realm (e.g., the source realm's tracker schema).
- **Start small and iterate.** Write the smallest working implementation first, then add the test. If tests fail, read the failure output carefully before making targeted fixes.
