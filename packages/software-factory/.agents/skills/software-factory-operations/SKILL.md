---
name: software-factory-operations
description: Use when implementing a software factory Issue inside an interactive Claude Code session — covers the per-issue workflow of inspecting realm state, writing `.gts` card definitions, tests, instances, and Catalog Spec cards, running the validator CLIs (`boxel lint` / `boxel parse` / `boxel test` / `boxel run-command evaluate-module` / `boxel run-command instantiate-card`), and recording progress on the Issue. Pair with `software-factory-scheduling` (how to pick the next Issue + status transitions) and `software-factory-bootstrap` (what to do when the Issue's `issueType` is `bootstrap`).
---

# Software Factory Operations

Use this skill when you have **picked up an implementation Issue**
(per the `software-factory-scheduling` skill) and need to deliver
the artifacts the Issue describes — a card definition, tests, sample
instances, and a Catalog Spec. There is no orchestrator: you write
files in the workspace mirror of the target realm, push them, run
validators against the realm, fix anything they catch, and flip the
Issue status when you're done.

## Realm roles

- **Source realm** (`packages/software-factory/realm/` published at
  `<realm-server-origin>/software-factory/`)
  Publishes the brief, the tracker schema (Project / IssueTracker
  / Issue / KnowledgeArticle), and shared modules. **Never write
  to this realm.**
- **Target realm** (user-specified, mirrored by your workspace)
  Receives every artifact you generate: card definitions, instances,
  tests, Catalog Specs, and the tracker cards (Project / Issue /
  KnowledgeArticle).

## Workspace files (local mirror of the target realm)

Your `cwd` is the local mirror of the target realm. Use the **native**
`Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash` tools on these
files; realm-relative paths resolve directly. After you write, push
the workspace to the realm with `boxel push` (or whatever sync
command your `boxel-cli` profile uses) — the validators that touch
the realm need the realm to reflect your latest writes.

Files that live in the workspace:

- Card definitions: `*.gts`
- Card tests: `*.test.gts` (co-located with the definition)
- Card instances under `<CardType>/<id>.json` (the user-data the
  cards represent, e.g. `StickyNote/note-1.json`)
- Tracker-schema cards: `Projects/<slug>.json`,
  `Boards/<slug>.json`, `Issues/<slug>.json`,
  `Knowledge Articles/<slug>.json`, `Spec/<slug>.json`

**Inspect before writing.** Read or grep the file you plan to
change, and glob for sibling files (e.g. existing card definitions
in the same directory) before creating new ones. The
`boxel-development` skill has the authoring patterns; this skill
just covers the loop around them.

## Tracker-schema cards — write JSON directly

Project, IssueTracker, Issue, KnowledgeArticle, and Spec cards are
plain `.json` files. Use `Write` to create them; to update, `Read`
first, then `Edit` (or `Write` the merged document back) — see
"Read before write" below.

| File path                        | adoptsFrom                                                     |
| -------------------------------- | -------------------------------------------------------------- |
| `Projects/<slug>.json`           | `{module: "<tracker-module-url>", name: "Project"}`            |
| `Boards/<slug>.json`             | `{module: "<tracker-module-url>", name: "IssueTracker"}`       |
| `Issues/<slug>.json`             | `{module: "<tracker-module-url>", name: "Issue"}`              |
| `Knowledge Articles/<slug>.json` | `{module: "<tracker-module-url>", name: "KnowledgeArticle"}`   |
| `Spec/<slug>.json`               | `{module: "https://cardstack.com/base/spec", name: "Spec"}`    |

`<tracker-module-url>` is derived from the target realm's origin
(`<origin>/software-factory/darkfactory`) — see the
`software-factory-scheduling` skill for the discovery rule.

### Always fetch the live schema before writing

Field names, enum values, and relationship keys evolve. Before
writing any tracker JSON file (Project / Issue / KnowledgeArticle /
Board) or a Spec card, introspect the live schema:

```bash
boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
  --realm <target-realm-url> \
  --input '{"codeRef": {"module": "<module-url>", "name": "<card-name>"}}'
```

The command returns `{ attributes, relationships? }` JSON Schema for
the card class. Use the field names, types, and enum values it
returns verbatim. Schemas are cached on the realm server, so
repeated calls with the same code ref are cheap.

### Read before write

When updating any tracker card (or any `.json` you didn't just
write), `Read` the file first, modify only the attributes you intend
to change, then `Write` (or `Edit`) the merged document back. Do
not overwrite the entire file with only the new fields — you'll
silently drop existing attributes, comments, and relationships.

### Issue invariants you must enforce yourself

The orchestrator used to enforce these via a wrapper tool that's no
longer in the loop. You enforce them:

- **`description` is immutable after creation.** Never modify an
  Issue's `description` once the card exists. To add context —
  blocked reasons, progress notes, validation failures,
  clarification requests — append to the `comments` array instead.
  See "Adding a comment to an existing Issue" below.
- **Status transitions are restricted** to the values documented in
  `software-factory-scheduling`. Briefly: set to `"in_progress"` on
  pickup; `"done"` after validators pass and the sync is clean;
  `"blocked"` (with a comment) when you can't make progress. The
  Issue schema enums the set — introspect it if you're unsure.

### Adding a comment to an existing Issue

Issue cards carry a `comments` array on `attributes`. To append:

1. `Read` the Issue's `.json`.
2. Append a new entry to `data.attributes.comments[]`, populating
   the body / author / timestamp fields the schema names. The
   comment-timestamp field on an entry is **not** the same as the
   Issue's top-level `createdAt` / `updatedAt`; the schema
   disambiguates them — call `get-card-type-schema` once if you're
   unsure, then reuse the field names.
3. `Write` (or `Edit`) the document back. **Do not modify
   `description` or any other top-level attribute** — comments are
   append-only.

### Catalog Spec card shape

Spec cards (`Spec/<slug>.json`) adopt from
`https://cardstack.com/base/spec` / `Spec`. Fetch the live schema:

```bash
boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
  --realm <target-realm-url> \
  --input '{"codeRef": {"module": "https://cardstack.com/base/spec", "name": "Spec"}}'
```

What the schema does **not** tell you and you must supply for
entry-point cards:

- A display title and short description suitable for the catalog.
- The spec-type field set to the enum value for card-style specs
  (vs. apps, fields, etc.) — use the value the schema returns.
- A code-ref attribute pointing at your `.gts` definition, formatted
  as `{module: "../<slug>", name: "<PascalClass>"}` (relative path,
  no `.gts` extension) so the spec resolves the definition relative
  to itself.
- A markdown usage guide for the catalog page.
- A linked-examples relationship populated with one or more sample
  instances:

  ```json
  "<linked-examples-key>": [
    { "links": { "self": "../<CardType>/<instance-id>" } }
  ]
  ```

  (The schema names the relationship key.)

The full document envelope is the same as for tracker cards (`data`
/ `type: "card"` / `attributes` / `relationships` / `meta.adoptsFrom`),
just with the `https://cardstack.com/base/spec` adoptsFrom.

## Realm-side reads (via `boxel` CLI)

For operations that need to reach the realm runtime — searching the
indexed cards, fetching transpiled JS, running host commands — shell
out via `Bash` to `boxel`. These never go through the workspace
filesystem.

- **Search the target realm** for cards using a structured query
  (filter, sort, page). Use this to check for existing cards, find
  duplicates, or inspect project state:

  ```bash
  boxel search --realm <target-realm-url> --query '<json>' --json
  ```

  Single-quote the entire JSON so the shell doesn't expand or split
  it; keep keys and string values double-quoted inside. Pipe
  through `jq` to project. **For the full query syntax (filter / eq
  / contains / range / every / any / not / sort / page, CodeRef
  matching, common mistakes) see the `boxel-api` skill.**

- **Fetch transpiled JavaScript** for a `.gts` module — only when an
  eval/instantiate error reports a line/column number, since those
  numbers reference the transpiled output, not your `.gts` source:

  ```bash
  boxel read-transpiled <realm-relative-path> --realm <target-realm-url>
  ```

  The `.gts` extension is optional. Pipe through `sed -n '<line>p'`
  to inspect a single line. See "Debugging Runtime Evaluation
  Errors" below for when to reach for this.

- **Run any other host command** in the realm's prerendered runtime
  (module evaluation, card instantiation, anything else exposed at
  `@cardstack/boxel-host/commands/<name>/default`):

  ```bash
  boxel run-command <command-specifier> \
    --realm <target-realm-url> \
    --input '<json>' --json
  ```

  Most agent tasks won't need this directly — the validators below
  already wrap the common ones. See the `boxel-command` skill for
  the programmatic surface and failure modes.

## Validators (CLI commands)

Run these against the target realm after writing files. Each is
safe to call repeatedly — they do **not** persist any validation
cards (TestRun, LintResult, etc.) into the realm; the result is the
CLI output you read directly.

**Push first.** All five validators read from the realm (not your
local workspace). After writing files in the workspace, push them to
the realm before running any validator:

```bash
boxel push --realm <target-realm-url>
# or: boxel sync --realm <target-realm-url>
```

(Exact command depends on the boxel-cli surface in your version —
see the `realm-sync` skill.)

### `boxel lint [path] --realm <url>`

ESLint + Prettier with the `@cardstack/boxel` rules. Without a
path, lints every `.gts` / `.gjs` / `.ts` / `.js` file in the realm.
With a realm-relative path, lints just that file — prefer this
right after writing or editing a single file.

```bash
boxel lint sticky-note.gts --realm http://localhost:4201/alice/my-realm/
boxel lint --realm http://localhost:4201/alice/my-realm/   # whole realm
```

Exit code is non-zero when any error-severity violation exists.
Pass `--json` for a structured result you can pipe through `jq`.

### `boxel parse [path] --realm <url>`

Type-checks `.gts` / `.gjs` / `.ts` via glint (template-aware
TypeScript) and validates the document structure of `.json` files
linked as Spec `linkedExamples`. Without a path, parses every
parseable file in the realm. With a path, parses just that file —
the extension is required (`.gts` / `.gjs` / `.ts` / `.json`).

```bash
boxel parse sticky-note.gts --realm http://localhost:4201/alice/my-realm/
boxel parse --realm http://localhost:4201/alice/my-realm/
```

**Monorepo-only:** parse runs glint locally against the host app's
node_modules + monorepo paths. It will fail outside the boxel
monorepo with a clear error.

### `boxel run-command evaluate-module --realm <url> --input '{...}'`

Evaluates an ESM module in the realm's prerenderer sandbox. Use
right after writing a `.gts` to catch import errors, decorator
mishaps, or anything else that fails at module load time.

```bash
boxel run-command evaluate-module \
  --realm <target-realm-url> \
  --input '{"path": "sticky-note.gts"}'
```

When a failure reports a line/column, those numbers refer to the
**transpiled** module — pair with `boxel read-transpiled` (see
above) to find the offending source construct, then fix the `.gts`
source. **Never copy transpiled patterns back into source.**

Test files (`*.test.*`) are rejected — `boxel test` handles those.

### `boxel run-command instantiate-card --realm <url> --input '{...}'`

Instantiates a single card instance in the prerenderer sandbox.
Use after writing a `.json` instance to catch shape mismatches or
runtime errors in field initializers.

```bash
boxel run-command instantiate-card \
  --realm <target-realm-url> \
  --input '{"path": "StickyNote/note-1.json"}'
```

**Do not** pass a `Spec/...json` path or any card whose
`meta.adoptsFrom.module` is a base-realm URL
(`https://cardstack.com/base/...`). Specs adopt from the base realm,
and the prerender refuses cross-origin module loads with
"moduleUrl origin does not match realmUrl origin". To validate
Specs, run `boxel test` (which exercises the Spec's `linkedExamples`
against the card class).

### `boxel test --realm <url>`

Drives a headless Chromium against the host app's compiled test
bundle and runs every `*.test.gts` file in the realm. Returns
pass/fail counts plus per-failure details.

```bash
boxel test --realm http://localhost:4201/alice/my-realm/
boxel test --realm <url> --json | jq      # machine-readable
boxel test --realm <url> --debug          # stream browser console
```

**Monorepo-only:** test discovers the host app's `dist/` directory
relative to this CLI. The host app must be built first
(`pnpm --filter @cardstack/host build`).

A test run with zero tests, or with all tests skipped, returns
`status: "failed"` — **never use `QUnit.skip()` / `QUnit.todo()`** in
your `.test.gts` files. Tests must actually execute. See "Writing
QUnit card tests" below.

## Required flow per Issue

1. **Inspect before writing.** Search the target realm for existing
   cards (`boxel search`) and `Read`/`Glob` workspace files you plan
   to change (or sibling files in the same directory).
2. **Write card definitions** (`.gts`) into the workspace.
3. **Write `.test.gts` test files** co-located with the card
   definition. Every issue must include at least one test file.
   Write tests **immediately** after the card definition, before
   instances or Spec cards — it forces the API decisions early.
4. **Write card instances** (`.json`) into the workspace.
5. **Write a Catalog Spec card** (`Spec/<card-name>.json`) — adopts
   from `https://cardstack.com/base/spec` / `Spec`. Link sample
   instances via `relationships.linkedExamples`.
6. **Push the workspace** to the target realm.
7. **Run the validators** (in this order — cheap to expensive):
   `boxel lint <changed-file>`, `boxel parse <changed-file>`,
   `boxel run-command evaluate-module --input '{"path": "<file>"}'`,
   `boxel run-command instantiate-card --input '{"path": "<instance>"}'`,
   `boxel test`. Fix anything that fails and re-run.
8. **Mark the Issue done** by editing
   `Issues/<slug>.json:data.attributes.status` to `"done"` and
   pushing. (See `software-factory-scheduling` for the full
   status-transition rules — never set `status` to `"done"` until
   validators pass and the push is clean.)

If you cannot make progress at any step, set the Issue's `status`
to `"blocked"`, append a comment explaining what's stuck, push, and
report back to the user. See `software-factory-scheduling`.

## Target realm artifact structure

```
target-realm/
├── card-name.gts                    # Card definition
├── card-name.test.gts               # QUnit test (co-located)
├── CardName/
│   └── sample-instance.json         # Card instance
├── Spec/
│   └── card-name.json               # Catalog Spec card
├── Projects/
│   └── project-name.json            # Project card
├── Boards/
│   └── project-name.json            # IssueTracker card
├── Issues/
│   └── issue-slug.json              # Issue card
└── Knowledge Articles/
    └── article-name.json            # KnowledgeArticle card
```

There is no `Validations/` folder in the interactive flow — the
validators run via CLI and don't persist artifacts.

## Debugging runtime evaluation errors

`evaluate-module` and `instantiate-card` failures surface
line/column references that point to the **transpiled** JavaScript
output, not the `.gts` source you wrote. The realm compiles `.gts`
to JS before execution, and runtime errors reference the compiled
output.

When a validation error contains text like
`(error occurred in '/.../sticky-note.gts' @ line 66 : column 32)`,
the line number is for the transpiled module. Fetch the transpiled
output and read the reported line:

```bash
boxel read-transpiled sticky-note.gts \
  --realm <target-realm-url> | sed -n '60,70p'
```

For example, `" is not a valid character within attribute names` at
`line 66 : column 32` typically points inside a
`precompileTemplate(...)` block in the transpiled output. The
actual fault in the source is often in a CSS comment or a template
expression — line 66 in your `.gts` source is unrelated. Reading
the transpiled line is what connects the error back to the source
construct.

### The transpiled output is for DEBUGGING ONLY — never for implementation

**Scope:** `boxel read-transpiled` is only for investigating
**runtime errors in `.gts` modules you have already written** —
when an eval or instantiate failure points to a line/column in the
transpiled output and you need to map that coordinate back to your
source. It is **not** for learning how to write cards, not for
understanding Boxel patterns, and not a general reference.

- **Do not copy patterns, imports, or shapes from the transpiled
  output into your `.gts` source.** The transpiler emits artifacts
  like `setComponentTemplate(...)`, `precompileTemplate(...)`,
  wire-format template arrays, base64 CSS imports
  (`./file.gts.CiAg...`), and other compiler internals. None of
  those belong in source code.
- **Do not write `.gts` that "looks like" the compiled JS.** Always
  write clean idiomatic Ember / `<template>`-tag / CardDef /
  FieldDef source. If you find yourself tempted to hand-write a
  `setComponentTemplate(...)` call or a wire-format template, stop
  — you're modeling the wrong layer.
- **Always edit `.gts` source, never the transpiled output.** The
  realm regenerates the transpiled JS on every write, so any edit
  there is silently discarded.
- **When in doubt, favor idiomatic card development practices.**
  The `boxel-development` skill and existing cards in the target
  realm are the right references — not what the compiler happens to
  emit.

Use the transpiled fetch the way a developer uses a source map: to
translate a runtime line number back to a source construct in the
code **you wrote**, then close the transpiled view and fix the
source idiomatically.

## Writing QUnit card tests

Test files are `.test.gts` files co-located with card definitions
in the target realm. Each file exports a `runTests()` function that
registers QUnit modules and tests.

### Example test

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

### Key points

- Tests are `.test.gts` files co-located with the card definition
  (e.g., `sticky-note.gts` and `sticky-note.test.gts`).
- Each test file must export a `runTests()` function.
- Use `import.meta.url` to resolve card definitions relative to the
  test file — never hardcode realm URLs.
- Use `setupCardTest(hooks)` for rendering context, then
  `renderCard(loader, card, format)` for DOM assertions.
- No external realm writes during tests — all test data lives in
  browser memory.
- Use `data-test-*` attributes for DOM selectors when testing
  rendered output.
- Use QUnit assertions: `assert.dom()`, `assert.strictEqual()`,
  `assert.ok()`.
- **Wrap every `test(...)` in a QUnit `module('<name>', function
  (hooks) { ... })` block.** The TestRun UI (and any future
  TestRun cards you write) group results by module name; top-level
  tests collapse into a "default" bucket and become hard to read.
- **Never use `QUnit.skip()` or `QUnit.todo()`.** All tests must
  actually execute. A run with zero tests, or with every test
  skipped, is reported as `failed`.

## Important rules

- **Never write to the source realm.** All generated artifacts go
  to the target realm via the workspace mirror.
- **Stay inside the workspace.** Workspace fs operations are scoped
  to the local mirror of the target realm. Use realm-relative paths
  (`sticky-note.gts`, `StickyNote/note-1.json`) — never absolute
  paths outside the workspace, never the user's home directory,
  never the source realm.
- **Push after every meaningful batch of writes.** The validators
  read from the realm. Workspace writes are invisible to them until
  the push lands. Don't run a validator and then act surprised at
  stale results.
- **Write source code, not compiled output.** When writing `.gts`
  files, write clean idiomatic source — never compiled JSON blocks
  or base64-encoded content.
- **Use absolute `adoptsFrom.module` URLs** when referencing
  definitions that live in a different realm (e.g., the source
  realm's tracker schema or `https://cardstack.com/base/spec`).
- **Start small and iterate.** Write the smallest working
  implementation first, then add the test. If tests fail, read the
  failure output carefully before making targeted fixes — don't
  pile speculative changes on top of a failure you haven't
  understood.

## See also

- `software-factory-scheduling` — picking the next Issue,
  status-transition rules, building per-issue context from
  relationships.
- `software-factory-bootstrap` — what to do when the Issue's
  `issueType` is `bootstrap` (create Project / IssueTracker /
  Knowledge Articles / implementation Issues from a brief).
- `boxel-development` — `.gts` card authoring patterns
  (CardDef / FieldDef, fields, formats, templates, common
  pitfalls). The agent-facing reference for "what does the
  `.gts` actually look like".
- `boxel-api` — full `boxel search` query syntax.
- `boxel-command` — programmatic surface for `boxel run-command`.
- `realm-sync` — `boxel push` / `boxel pull` / workspace sync.
