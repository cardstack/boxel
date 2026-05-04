---
name: software-factory-operations
description: Use when implementing cards in a target realm through the factory execution loop — covers the tool-use workflow for searching, writing, testing, and updating issues via factory tools.
---

# Software Factory Operations

Use this skill when operating inside the factory execution loop. Workspace
files (card definitions, instances, tests) live in a **local workspace
mirror of the target realm** that the orchestrator syncs back to the realm
between iterations. Realm-side operations (search, host commands, runtime
validators) and control signals are **factory tools** the agent invokes
directly.

## Realm Roles

- **Source realm** (`packages/software-factory/realm`)
  Publishes shared modules, briefs, templates, and tracker schema. Never write to this realm.
- **Target realm** (user-specified, passed to `factory:go`)
  Receives all generated artifacts: Project, Issue, KnowledgeArticle, card definitions, card instances, Catalog Spec cards, and QUnit test files.

## Tool Surfaces

Two surfaces are available, depending on which agent backend is running.
The system prompt makes the concrete mapping explicit; this skill describes
the operations.

### Workspace files (local mirror of target realm)

These files live in the workspace directory and are synced to the realm
by the orchestrator. Use the workspace fs surface for them — and only
for them:

- Card definitions: `*.gts` files
- Card tests: `*.test.gts` files
- Content card instances under `<CardType>/<id>.json` (the user data
  the cards represent — e.g. `StickyNote/note-1.json`)

Tooling per backend:

- **Claude backend:** use the **native** `Read`, `Write`, `Edit`,
  `Glob`, `Grep`, and `Bash` tools. The SDK query's `cwd` is the
  workspace, so realm-relative paths resolve directly. `Bash` is
  available for safe shell helpers (`ls`, `find`, `cat`, read-only
  `boxel` CLI commands like `boxel status` / `boxel history`).
- **OpenRouter backend:** use the factory `read_file({ path, realm? })`
  / `write_file({ path, content, realm? })` tools — same realm-relative
  paths.

Inspect before writing. Read or grep the file you plan to change, and
glob for sibling files (e.g. existing card definitions in the same
directory) before creating new ones.

### Tracker-schema cards — always use the structured factory tools

**Critical:** Project, Issue, KnowledgeArticle, Spec, and issue comments
have dedicated factory tools that enforce schema and invariants. **Do
not** create or update them by writing the underlying `.json` directly
(via native `Write` on the Claude backend, or via `write_file` on
OpenRouter) — going around the structured tools produces malformed
cards or silently violates invariants the orchestrator depends on.

| File / artifact                       | Use this tool         |
| ------------------------------------- | --------------------- |
| `Projects/<slug>.json`                | `update_project`      |
| `Issues/<slug>.json`                  | `update_issue`        |
| `Knowledge Articles/<slug>.json`      | `create_knowledge`    |
| `Spec/<slug>.json`                    | `create_catalog_spec` |
| Append a comment to an existing issue | `add_comment`         |

These tools auto-construct the JSON:API document with the correct
`adoptsFrom`, do read-patch-write merging that preserves attributes
you did not pass, and (for issues) enforce that `description` stays
immutable and that the agent only proposes the legal status
transitions (`blocked` / `backlog`).

### Realm-side reads (factory tools)

These always go through factory tools regardless of backend — they
reach the realm runtime, enforce schema and immutability invariants,
or drive control flow.

- Fetch the **transpiled** JavaScript for a `.gts` module — used only when an eval/instantiate error reports a line/column number, since those numbers reference the transpiled output, not your `.gts` source.
  - **Claude backend:** run `boxel read-transpiled <realm-relative-path> --realm <target-realm-url>` via `Bash`. The `.gts` extension is optional. Pipe through `sed -n '<line>p'` (or wrap with `awk`) when you want to inspect a single line.
  - **OpenRouter backend:** call the factory `fetch_transpiled_module({ path, realm? })` tool with the same realm-relative path.
- Search the target realm for cards using a structured query object (filter, sort, page). Use this to check for existing cards, find duplicates, or inspect project state.
  - **Claude backend:** run `boxel search --realm <target-realm-url> --query '<json>' --json` via `Bash`. **Quoting:** single-quote the entire JSON object so the shell does not expand or split it; keep all keys and string values double-quoted inside. Example: `boxel search --realm https://realms.example/h/p/ --query '{"filter":{"type":{"module":"https://cardstack.com/base/spec","name":"Spec"}}}' --json`. Pipe through `jq` if you want a focused projection.
  - **OpenRouter backend:** call the factory `search_realm({ query, realm? })` tool with the same structured query object — no shell quoting concerns.

### Updating Project State

- `update_project({ path, attributes, relationships? })` — Update a Project card in the target realm. The tool's parameters include a dynamic JSON schema describing available fields — use it to know valid field names and types. The tool auto-constructs the JSON:API document with the correct `adoptsFrom`.
- `update_issue({ path, attributes, relationships? })` — Update an Issue card. Same structured interface with dynamic field schema in the tool parameters. **Note:** `description` is stripped — issue descriptions are immutable after creation. Use `add_comment` to add context.
- `add_comment({ path, body, author })` — Append a comment to an existing issue. Use this to record context, blocked reasons, validation failures, or any post-creation updates. Comments are append-only — they cannot be edited or deleted.
- `create_knowledge({ path, attributes, relationships? })` — Create or update a KnowledgeArticle card. Same structured interface with dynamic field schema in the tool parameters.
- `create_catalog_spec({ path, attributes, relationships? })` — Create a Catalog Spec card in the target realm's `Spec/` folder. Makes a card definition discoverable in the Boxel catalog. Same structured interface with dynamic field schema. The tool auto-constructs the document with `adoptsFrom` pointing to `https://cardstack.com/base/spec#Spec`.

### Running Host Commands

You do not need to invoke Boxel host commands from the agent — the
orchestrator pre-loads the card-type schemas you need and bakes them
into the structured update tools' parameter schemas. If a future
workflow does need a host command, the OpenRouter backend exposes
`run_command({ command, commandInput? })` and the Claude backend
should shell out via Bash to `boxel run-command <specifier> --realm <url>
--input '<json>' --json`.

### Self-Validation (optional, no side effects)

All five tools are safe to call repeatedly mid-turn; none of them write a realm artifact. The orchestrator still runs the full validation pipeline (which persists the durable `TestRun` / `LintResult` / `ParseResult` / `EvalResult` / `InstantiateResult` cards) after `signal_done`, so calling any of these is optional.

- `run_lint({ path? })` — Run ESLint + Prettier (with `@cardstack/boxel` rules) and return an in-memory `RunLintResult` with `status`, `filesChecked`, `filesWithErrors`, `errorCount`, `warningCount`, `durationMs`, `lintableFiles`, and per-violation `{ rule, file, line, column, message, severity }`. Without `path`, lints every `.gts` / `.gjs` / `.ts` / `.js` file in the target realm. With `path` (realm-relative file path), lints **only that one file** — prefer this right after writing or editing a single file.
- `run_tests()` — Run the realm's QUnit suite and receive an in-memory result object `{ status, passedCount, failedCount, skippedCount, durationMs, testFiles, failures, errorMessage? }`. Use it when you want feedback before signalling done.
- `run_parse({ path? })` — Parse and type-check files in the target realm and return an in-memory `RunParseResult` with `status`, `filesChecked`, `filesWithErrors`, `errorCount`, `durationMs`, `parseableFiles`, and per-error `{ file, line, column, message }`. Without `path`, runs glint (ember-tsc) over every `.gts` / `.gjs` / `.ts` file in the realm AND validates every `.json` file listed as a Spec `linkedExample` (same discovery as the parse validation step). With `path` (realm-relative file path), parses **only that one file** — `.gts` / `.gjs` / `.ts` runs through glint; `.json` is parsed and checked for card document structure. The extension is required; `parseableFiles` entries are always returned in the `.json` / `.gts` / `.gjs` / `.ts` form, so you can feed any of them straight back into `path`. Prefer the single-file form right after writing or editing one file.
- `run_evaluate({ path? })` — Evaluate ESM modules (`.gts` / `.gjs` / `.ts` / `.js`) in the target realm via the prerenderer sandbox and return a `RunEvaluateResult` (status, module counts, per-failure `{ path, error, stackTrace? }`). Without `path`, evaluates every non-test evaluable module. With `path`, evaluates only that single realm-relative file — handy for a quick self-check right after writing one module. Test files (`*.test.*`) are rejected — the test runner validates those. When a failure reports a line/column, those numbers refer to the transpiled module — pair with the transpiled-module fetch above (Bash + `boxel read-transpiled` on the Claude backend, `fetch_transpiled_module` on OpenRouter) to locate the offending source construct, then fix the `.gts` source (never copy transpiled patterns back into source).
- `run_instantiate({ path? })` — Instantiate card example instances in the target realm via the prerenderer sandbox and return a `RunInstantiateResult` (status, instance counts, per-failure `{ path, cardName, error, stackTrace? }`). Without `path`, searches the realm for Spec cards and instantiates every `linkedExample` on every card/app Spec; specs with no `linkedExamples` still get a bare instantiation to exercise the card class. With `path`, instantiates only that single realm-relative `.json` example file — its `meta.adoptsFrom` supplies the module + card name, and spec discovery is skipped entirely so you can self-check one instance in isolation. The `path` argument must end in `.json`. `instanceFiles` only contains real `.json` example paths (bare-instantiation fallbacks are filtered out) so any entry can be fed straight back into `path`. If a bare instantiation fails, its failure entry has `path: ''` and a populated `cardName` — identify the spec by `cardName` and do NOT pass the empty path back into `path`. When a failure reports a line/column, those numbers refer to the transpiled module — pair with the transpiled-module fetch above (Bash + `boxel read-transpiled` on the Claude backend, `fetch_transpiled_module` on OpenRouter) to locate the offending source construct, then fix the `.gts` source (never copy transpiled patterns back into source).

### Control Flow

- `signal_done()` — Signal that the current issue is complete. Call this only after all implementation and test files have been written.
- `request_clarification({ message })` — Signal that you cannot proceed and need human input. Describe what is blocking.

### Important: Issue Descriptions Are Immutable

**Never modify an issue's `description` field after creation.** The description captures the original intent of the issue. If you need to add context — blocked reasons, progress notes, clarification requests, or any post-creation information — use `add_comment` instead. The `update_issue` tool strips `description` changes automatically.

## Required Flow

1. **Inspect before writing.** Search the target realm for existing cards (Bash + `boxel search` on Claude, `search_realm` on OpenRouter — see the Realm-side reads section above). Read or grep the workspace files you plan to change (or sibling files in the same directory) before creating or modifying anything.
2. **Write card definitions** (`.gts`) into the workspace.
3. **Write `.test.gts` test files** co-located with card definitions. Every issue must have at least one test file. **Write tests immediately after the card definition, before any instances or catalog specs.**
4. **Write card instances** (`.json`) into the workspace.
5. **Create a Catalog Spec card** (`Spec/<card-name>.json`) for each top-level card defined in the brief by calling `create_catalog_spec` — never via native `Write`. Link sample instances via `linkedExamples`.
6. **(Optional) Call `run_tests()`** to self-validate before signalling done. This returns test results in-memory without writing any realm artifacts. Iterating on your own work with `run_tests` is faster than round-tripping through the orchestrator pipeline.
7. **Call `signal_done()`** when all implementation and test files are written. The orchestrator runs the full validation pipeline (which persists a `TestRun` card, among other artifacts) automatically after this.
8. **If tests fail**, the orchestrator feeds failure details back. Re-read the affected workspace files, fix them, and call `signal_done()` again.
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
line number is for the transpiled module. Fetch the transpiled output
and read the reported line to see what compiled construct raised the
error — then reason back to the `.gts` source construct that produced
it.

- **Claude backend:** `boxel read-transpiled sticky-note.gts --realm <target-realm-url>` via `Bash`. Pipe through `sed -n '60,70p'` (or similar) to focus on a window around the reported line.
- **OpenRouter backend:** `fetch_transpiled_module({ path: 'sticky-note.gts' })`.

For example, `" is not a valid character within attribute names: (error occurred in '/.../sticky-note.gts' @ line 66 : column 32)`
typically points inside a `precompileTemplate(...)` block in the
transpiled output. The actual fault in the source is often in a CSS
comment or a template expression — line 66 in your `.gts` source is
unrelated. Reading the transpiled line is what connects the error back
to the source.

### The transpiled output is for DEBUGGING ONLY — never for implementation

**Scope:** the transpiled fetch (Bash + `boxel read-transpiled` on
Claude, `fetch_transpiled_module` on OpenRouter) is only for
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

Use the transpiled fetch the way a developer uses a source map: to
translate a runtime line number back to a source construct in the
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

- **Never write to the source realm.** All generated artifacts go to the target realm via the workspace mirror.
- **Stay inside the workspace.** Workspace fs operations are scoped to the local mirror of the target realm. Use realm-relative paths (`sticky-note.gts`, `StickyNote/note-1.json`) — never absolute paths outside the workspace, never the user's home directory, never the source realm.
- **Don't drive sync yourself.** The orchestrator owns `boxel sync` / `boxel push`. Read-only `boxel` commands (`boxel status`, `boxel history`) are fine for inspection, but never run sync, push, or any command that mutates the realm directly.
- **Write source code, not compiled output.** When writing `.gts` files, write clean idiomatic source — never compiled JSON blocks or base64-encoded content.
- **Use absolute `adoptsFrom.module` URLs** when referencing definitions that live in a different realm (e.g., the source realm's tracker schema).
- **Start small and iterate.** Write the smallest working implementation first, then add the test. If tests fail, read the failure output carefully before making targeted fixes.
