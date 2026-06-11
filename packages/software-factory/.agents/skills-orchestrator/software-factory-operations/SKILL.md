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

## Workspace files (local mirror of target realm)

The agent's working directory is the workspace — the local mirror of the
target realm that the orchestrator syncs back between iterations. Use the
**native** `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash` tools on
these files; the workspace `cwd` is set for you, so realm-relative paths
resolve directly.

These files live in the workspace:

- Card definitions: `*.gts`
- Card tests: `*.test.gts`
- Content card instances under `<CardType>/<id>.json` (the user data the
  cards represent — e.g. `StickyNote/note-1.json`)
- Tracker-schema cards: `Projects/<slug>.json`, `Issues/<slug>.json`,
  `Knowledge Articles/<slug>.json`, `Spec/<slug>.json`

`Bash` is also available for `boxel` CLI commands:

- Read-only inspection: `boxel status`, `boxel history`, `boxel search`,
  `boxel read-transpiled`.
- `boxel run-command` — dispatches to whatever host command you specify.
  Most specifiers are read-only inspection commands (`get-card-type-schema`,
  `evaluate-module`, `instantiate-card`), but the surface itself is generic;
  treat it as "as safe as the named command."

See the **Realm-side reads** section below for the full usage.

**Inspect before writing.** Read or grep the file you plan to change, and
glob for sibling files (e.g. existing card definitions in the same
directory) before creating new ones.

## Tracker-schema cards — write JSON directly

Project, IssueTracker, Issue, KnowledgeArticle, and Spec cards are plain
`.json` files in the workspace. Use `Write` to create them; to update one,
`Read` it, then either `Edit` the relevant attributes or `Write` the
merged document back — same workspace fs surface as `.gts` files.

| File path                        | adoptsFrom                                                     |
| -------------------------------- | -------------------------------------------------------------- |
| `Projects/<slug>.json`           | `{module: "<darkfactoryModuleUrl>", name: "Project"}`          |
| `Boards/<slug>.json`             | `{module: "<darkfactoryModuleUrl>", name: "IssueTracker"}`     |
| `Issues/<slug>.json`             | `{module: "<darkfactoryModuleUrl>", name: "Issue"}`            |
| `Knowledge Articles/<slug>.json` | `{module: "<darkfactoryModuleUrl>", name: "KnowledgeArticle"}` |
| `Spec/<slug>.json`               | `{module: "https://cardstack.com/base/spec", name: "Spec"}`    |

`<darkfactoryModuleUrl>` is named in the system prompt — use that value
verbatim.

**Always fetch the live schema before writing.** Field names, enum values,
and relationship keys for each card type are introspected at runtime —
never hard-coded in this skill. Call
`get_card_schema({ module, name })` for the card you're about to write
and use the returned `{ attributes, relationships? }` JSON Schema to shape
the document. The bootstrap skill covers the bootstrap-specific attribute
population guidance; this skill covers the operational patterns
(read-before-write, comments, invariants) that layer on top.

**Read before write.** When updating any tracker card, `Read` the file
first, change only the attributes you intend to update, then write the
merged document back. Don't overwrite the whole file with only your new
fields — you'll silently drop the existing attributes.

**Issue invariants you must enforce yourself** (these used to be enforced
by a wrapper tool; they aren't anymore):

- **`description` is immutable** after the issue is created. If you need
  to add context — blocked reasons, progress notes, validation failures,
  clarification requests — append to the `comments` array instead. See
  "Adding a comment to an existing issue" below.
- **Status transitions are restricted.** You may set `status` to
  `"blocked"` (cannot proceed) or `"backlog"` (unblock). Never set
  `status` to `"done"` or `"in_progress"` — those are owned by the
  orchestrator based on `signal_done` + validation results.

### Adding a comment to an existing issue

Issue cards carry a containsMany comments array on `attributes`. To
append a comment:

1. Call `get_card_schema({ module: "<darkfactoryModuleUrl>", name: "Issue" })`
   if you don't already have the Issue schema cached. The comments array
   entry is itself an object with its own field shape — use the field
   names returned by the schema (the body / author / timestamp fields)
   verbatim. The timestamp field on a comment is **not** the same as the
   Issue's own top-level `createdAt` / `updatedAt` attributes; the schema
   disambiguates them.
2. `Read` the issue's `.json`.
3. Append a new entry to the comments array on `data.attributes`,
   populating the body (markdown comment text), the author (e.g.
   `"factory-agent"` or `"orchestrator"`), and the comment-timestamp
   field (ISO timestamp).
4. `Write` (or `Edit`) the document back. **Do not modify the description
   or any other attribute** — comments are append-only.

### Catalog Spec card shape

Spec cards (`Spec/<slug>.json`) adopt from
`https://cardstack.com/base/spec` / `Spec`, **not** from the tracker
module. Fetch the live schema before writing:

```
get_card_schema({ module: "https://cardstack.com/base/spec", name: "Spec" })
```

Use the returned `{ attributes, relationships? }` to shape the document.
What the schema does **not** tell you and you must supply yourself for
entry-point cards:

- A display title and short description suitable for the catalog.
- The spec-type field set to the enum value the schema returns for
  card-style specs (vs. apps, fields, etc.).
- A code-ref attribute pointing at your `.gts` definition, formatted as
  `{module: "../<slug>", name: "<PascalClass>"}` (relative path, no
  `.gts` extension) so the spec resolves the definition relative to
  itself.
- A markdown usage guide for the catalog page.
- A linked-examples relationship populated with one or more sample
  instances:

  ```json
  "<linked-examples-key>": [
    { "links": { "self": "../<CardType>/<instance-id>" } },
    ...
  ]
  ```

  (The schema names the relationship key.)

The full document envelope is the same as for tracker cards (`data` /
`type: "card"` / `attributes` / `relationships` / `meta.adoptsFrom`),
just with the `https://cardstack.com/base/spec` adoptsFrom.

## Realm-side reads (via `boxel` CLI)

For operations that need to reach the realm runtime — searching the
indexed cards, fetching transpiled JS, running host commands — shell out
via `Bash` to the `boxel` CLI. These never go through the workspace fs.

- **Search the target realm** for cards using a structured query
  (filter, sort, page). Use this to check for existing cards, find
  duplicates, or inspect project state.
  ```
  boxel search --realm <target-realm-url> --query '<json>' --json
  ```
  Single-quote the entire JSON object so the shell does not expand or
  split it; keep keys and string values double-quoted inside. Pipe
  through `jq` to project. **For the full query syntax (filter / eq /
  contains / range / every / any / not / sort / page, CodeRef matching,
  common mistakes) see the `boxel-api` skill.**
- **Fetch the transpiled JavaScript** for a `.gts` module — used only
  when an eval/instantiate error reports a line/column number, since
  those numbers reference the transpiled output, not your `.gts` source.
  ```
  boxel read-transpiled <realm-relative-path> --realm <target-realm-url>
  ```
  The `.gts` extension is optional. Pipe through `sed -n '<line>p'` (or
  wrap with `awk`) to inspect a single line. See the **Debugging
  Runtime Evaluation Errors** section below for when to reach for this.
- **Run any other host command** in the realm's prerendered runtime
  (module evaluation, card instantiation, anything else exposed at
  `@cardstack/boxel-host/commands/<name>/default`):
  ```
  boxel run-command <command-specifier> --realm <target-realm-url> --input '<json>' --json
  ```
  Most agent tasks won't need this — the validators below already wrap
  the common host commands. See the `boxel-command` skill for the
  programmatic surface and failure modes.

### Fetching live card-type schemas

`get_card_schema({ module, name })` returns the live JSON Schema
(`{ attributes, relationships? }`) for any `CardDef`, introspected from
the actual class via the realm server's prerenderer (the same path the
AI Bot uses for its patch-tool schemas). Always call this before writing
a tracker card (Project / Issue / KnowledgeArticle), a Spec card, or any
other card whose shape you need to know. Schemas are cached per-process,
so repeated calls with the same code ref are free.

## Self-Validation (optional, in-memory results)

All five validators are factory tools, safe to call repeatedly mid-turn.
They return in-memory result objects and **do not persist any durable
validation cards** — the orchestrator still runs the full validation
pipeline (which persists `TestRun` / `LintResult` / `ParseResult` /
`EvalResult` / `InstantiateResult` cards) after `signal_done`, so calling
any of these mid-turn is optional.

**Side effect to know about:** the realm-touching validators
(`run_evaluate`, `run_instantiate`, `run_tests`) sync your workspace to
the realm before invoking the prerenderer, so they push whatever you've
just written. That's the same write the orchestrator's between-iteration
sync would have done — it's not destructive, but it does mean calling
these tools is the moment your local writes hit the realm. The lighter
validators (`run_lint`, `run_parse`) run entirely in-process and don't
touch the realm.

- `run_lint({ path? })` — Run ESLint + Prettier (with `@cardstack/boxel`
  rules) and return an in-memory `RunLintResult` with `status`,
  `filesChecked`, `filesWithErrors`, `errorCount`, `warningCount`,
  `durationMs`, `lintableFiles`, and per-violation `{ rule, file, line,
column, message, severity }`. Without `path`, lints every `.gts` /
  `.gjs` / `.ts` / `.js` file in the target realm. With `path`
  (realm-relative file path), lints **only that one file** — prefer this
  right after writing or editing a single file.
- `run_tests()` — Run the realm's QUnit suite and receive an in-memory
  result object `{ status, passedCount, failedCount, skippedCount,
durationMs, testFiles, failures, errorMessage? }`. Use it when you
  want feedback before signalling done.
- `run_parse({ path? })` — Parse and type-check files in the target
  realm and return an in-memory `RunParseResult` with `status`,
  `filesChecked`, `filesWithErrors`, `errorCount`, `durationMs`,
  `parseableFiles`, and per-error `{ file, line, column, message }`.
  Without `path`, runs glint (ember-tsc) over every `.gts` / `.gjs` /
  `.ts` file in the realm AND validates every `.json` file listed as a
  Spec `linkedExample` (same discovery as the parse validation step).
  With `path` (realm-relative file path), parses **only that one file**
  — `.gts` / `.gjs` / `.ts` runs through glint; `.json` is parsed and
  checked for card document structure. The extension is required;
  `parseableFiles` entries are always returned in the `.json` / `.gts`
  / `.gjs` / `.ts` form, so you can feed any of them straight back into
  `path`. Prefer the single-file form right after writing or editing one
  file.
- `run_evaluate({ path? })` — Evaluate ESM modules (`.gts` / `.gjs` /
  `.ts` / `.js`) in the target realm via the prerenderer sandbox and
  return a `RunEvaluateResult` (status, module counts, per-failure
  `{ path, error, stackTrace? }`). Without `path`, evaluates every
  non-test evaluable module. With `path`, evaluates only that single
  realm-relative file — handy for a quick self-check right after writing
  one module. Test files (`*.test.*`) are rejected — the test runner
  validates those. The tool bound-polls past the brief read-after-write
  window where the realm has the source on disk but indexing hasn't
  populated the module map yet, so a returned failure is a real failure
  — don't retry on the agent side. When a failure reports a line/column,
  those numbers refer to the transpiled module — pair with
  `boxel read-transpiled` (see Realm-side reads above) to locate the
  offending source construct, then fix the `.gts` source (never copy
  transpiled patterns back into source).
- `run_instantiate({ path? })` — Instantiate card example instances in
  the target realm via the prerenderer sandbox and return a
  `RunInstantiateResult` (status, instance counts, per-failure `{ path,
cardName, error, stackTrace? }`). Without `path`, searches the realm
  for Spec cards and instantiates every `linkedExample` on every
  card/app Spec; specs with no `linkedExamples` still get a bare
  instantiation to exercise the card class. With `path`, instantiates
  only that single realm-relative `.json` example file — its
  `meta.adoptsFrom` supplies the module + card name, and spec discovery
  is skipped entirely so you can self-check one instance in isolation.
  The `path` argument must end in `.json`. `instanceFiles` only contains
  real `.json` example paths (bare-instantiation fallbacks are filtered
  out) so any entry can be fed straight back into `path`. If a bare
  instantiation fails, its failure entry has `path: ''` and a populated
  `cardName` — identify the spec by `cardName` and do NOT pass the empty
  path back into `path`. The tool bound-polls past the brief
  read-after-write window where the realm has the source on disk but
  indexing hasn't populated the module map yet, so a returned failure
  is a real failure — don't retry on the agent side. When a failure
  reports a line/column, those numbers refer to the transpiled module —
  pair with `boxel read-transpiled` (see Realm-side reads above) to
  locate the offending source construct, then fix the `.gts` source
  (never copy transpiled patterns back into source).

## Control Flow

- `signal_done()` — Signal that the current issue is complete. Call this
  only after all implementation and test files have been written.
- `request_clarification({ message })` — Signal that you cannot proceed
  and need human input. Describe what is blocking.

## Required Flow

1. **Inspect before writing.** Search the target realm for existing
   cards (`boxel search --realm <url> --query '<json>'` via `Bash` —
   see Realm-side reads above, with full syntax in the `boxel-api`
   skill). Read or grep the workspace files you plan to change (or
   sibling files in the same directory) before creating or modifying
   anything.
2. **Write card definitions** (`.gts`) into the workspace.
3. **Write `.test.gts` test files** co-located with card definitions.
   Every issue must have at least one test file. **Write tests
   immediately after the card definition, before any instances or
   catalog specs.**
4. **Write card instances** (`.json`) into the workspace.
5. **Write a Catalog Spec card** (`Spec/<card-name>.json`) — adoptsFrom
   `https://cardstack.com/base/spec` / `Spec`. Link sample instances via
   `relationships.linkedExamples`.
6. **(Optional) Call `run_tests()`** to self-validate before signalling
   done. This returns test results in-memory without writing any realm
   artifacts. Iterating on your own work with `run_tests` is faster than
   round-tripping through the orchestrator pipeline.
7. **Call `signal_done()`** when all implementation and test files are
   written. The orchestrator runs the full validation pipeline (which
   persists a `TestRun` card, among other artifacts) automatically after
   this.
8. **If tests fail**, the orchestrator feeds failure details back.
   Re-read the affected workspace files, fix them, and call
   `signal_done()` again.
9. **Record progress** by appending to the issue's `comments` array
   (Read + Edit the issue JSON). Never modify the issue's `description`.

## Adjustment issues (adjust flow)

When the issue you picked up has `issueType: adjustment`, you are
**editing an existing, already-seeded card** — not creating one from
scratch. The bootstrap step seeded the source card and its same-realm
dependency graph into the workspace and confirmed a green baseline
before this issue existed, so the files named in the issue's
description are **already present**.

How adjustment work differs from a greenfield `feature` issue:

- **Read the seeded files first.** The issue description names the
  target file(s). `Read` each one (and grep for siblings) before
  touching anything — you are modifying working code, not authoring a
  blank slate.
- **Apply only the delta.** Use `Edit` for surgical changes to the
  seeded `.gts` / `.json`. Don't rewrite the card; change exactly what
  the delta calls for.
- **Guard the baseline.** The pre-existing tests are part of the
  contract. Extend `.test.gts` with assertions for the new behavior,
  but the **existing tests must still pass** — `run_tests` covers both.
  A delta that breaks a baseline test is not done; fix it or
  `request_clarification`.
- **Operate on the seeded artifacts — never create parallel ones.** The
  delta is applied by editing the existing seeded files: the card module,
  its tests, its sample instances, and its Spec. If the delta adds or
  renames a field, update the **existing** sample instances to reflect it
  (so they demonstrate the new behavior) and keep the Spec's
  `linkedExamples` pointing at them — `run_instantiate` and `run_parse`
  must stay green. Do **not** add a new instance, module, or Spec to
  showcase a change; a new card (or instance) is created only when the
  issue explicitly calls for one.
- **Then the standard loop applies unchanged** — self-validate with the
  `run_*` tools, `signal_done`, fix on feedback, record progress in
  `comments`. Same validators, same invariants.

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

```
boxel read-transpiled sticky-note.gts --realm <target-realm-url>
```

Pipe through `sed -n '60,70p'` (or similar) to focus on a window around
the reported line.

For example, `" is not a valid character within attribute names: (error
occurred in '/.../sticky-note.gts' @ line 66 : column 32)` typically
points inside a `precompileTemplate(...)` block in the transpiled
output. The actual fault in the source is often in a CSS comment or a
template expression — line 66 in your `.gts` source is unrelated.
Reading the transpiled line is what connects the error back to the
source.

### The transpiled output is for DEBUGGING ONLY — never for implementation

**Scope:** the transpiled fetch (`boxel read-transpiled`) is only for
investigating **runtime errors in `.gts` modules you have already
written** — when an eval or instantiate validation failure points to a
line/column in the transpiled output and you need to map that
coordinate back to your source. It is not for learning how to write
cards, not for understanding Boxel patterns, and not a general
reference.

- **Do not copy patterns, imports, or shapes from the transpiled output
  into your `.gts` source.** The transpiler emits artifacts like
  `setComponentTemplate(...)`, `precompileTemplate(...)`, wire-format
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
translate a runtime line number back to a source construct in the code
**you wrote**, then close the transpiled view and fix the source
idiomatically.

## Writing QUnit Card Tests

Test files are `.test.gts` files co-located with card definitions in the
target realm. Each test file exports a `runTests()` function that
registers QUnit modules and tests.

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

- Tests are `.test.gts` files co-located with the card definition (e.g.,
  `sticky-note.gts` and `sticky-note.test.gts`)
- Each test file must export a `runTests()` function
- Use `import.meta.url` to resolve card definitions relative to the test
  file — never hardcode realm URLs
- Use `setupCardTest(hooks)` for rendering context, then
  `renderCard(loader, card, format)` for DOM assertions
- No external realm writes during tests — all test data lives in browser
  memory
- Use `data-test-*` attributes for DOM selectors when testing rendered
  output
- Use QUnit assertions: `assert.dom()`, `assert.strictEqual()`,
  `assert.ok()`
- **Never use `QUnit.skip()` or `QUnit.todo()`.** All tests must
  actually execute. Skipped/todo tests are flagged as `skipped` in the
  TestRun card and treated as a failure when no tests actually ran. The
  orchestrator will reject a TestRun where every test is skipped.

## Important Rules

- **Never write to the source realm.** All generated artifacts go to the
  target realm via the workspace mirror.
- **Stay inside the workspace.** Workspace fs operations are scoped to
  the local mirror of the target realm. Use realm-relative paths
  (`sticky-note.gts`, `StickyNote/note-1.json`) — never absolute paths
  outside the workspace, never the user's home directory, never the
  source realm.
- **Don't drive sync yourself.** The orchestrator owns `boxel sync` /
  `boxel push`. Read-only `boxel` commands (`boxel status`,
  `boxel history`) are fine for inspection, but never run sync, push,
  or any command that mutates the realm directly.
- **Write source code, not compiled output.** When writing `.gts` files,
  write clean idiomatic source — never compiled JSON blocks or base64-
  encoded content.
- **Use absolute `adoptsFrom.module` URLs** when referencing definitions
  that live in a different realm (e.g., the source realm's tracker
  schema).
- **Start small and iterate.** Write the smallest working implementation
  first, then add the test. If tests fail, read the failure output
  carefully before making targeted fixes.
