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

## Prerequisite: `boxel` must be on PATH

Every command in this skill uses `boxel <subcommand>`. The
`software-factory-scheduling` and `software-factory-bootstrap`
skills verify `boxel` is installed at their start; if you got
this far, that check has passed.

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

Your `cwd` should be the local mirror of the target realm — a temp
directory the bootstrap step created via `mktemp -d` and `cd`'d
into. If you're picking up an Issue in a fresh session where
bootstrap already ran (so the workspace doesn't exist yet), set
it up now:

```bash
WORKSPACE="$(mktemp -d)"
boxel realm pull <target-realm-url> "$WORKSPACE"
cd "$WORKSPACE"
```

Use the **native** `Read`, `Write`, `Edit`, `Glob`, `Grep`, and
`Bash` tools on these files; realm-relative paths resolve directly.
After you write, push the workspace to the realm with
`boxel realm push <local-dir> <target-realm-url>` — the validators
that touch the realm need the realm to reflect your latest writes.

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

| File path                        | adoptsFrom                                                   |
| -------------------------------- | ------------------------------------------------------------ |
| `Projects/<slug>.json`           | `{module: "<tracker-module-url>", name: "Project"}`          |
| `Boards/<slug>.json`             | `{module: "<tracker-module-url>", name: "IssueTracker"}`     |
| `Issues/<slug>.json`             | `{module: "<tracker-module-url>", name: "Issue"}`            |
| `Knowledge Articles/<slug>.json` | `{module: "<tracker-module-url>", name: "KnowledgeArticle"}` |
| `Spec/<slug>.json`               | `{module: "https://cardstack.com/base/spec", name: "Spec"}`  |

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

Run these against the target realm after writing files. The CLI
itself just prints results — it does **not** write validation
cards into the realm. Persisting the audit trail (TestRun,
LintResult, ParseResult, EvalResult, InstantiateResult into the
`Validations/` folder) is **your** responsibility: see
"Validation artifact cards" below for the card types, file naming,
sequence numbers, and how to map `--json` output to the card's
attributes. Always run each validator with `--json` so you can
capture the structured result and convert it into the card.

**Push first.** All five validators read from the realm (not your
local workspace). After writing files in the workspace, push them to
the realm before running any validator:

```bash
boxel realm push <local-dir> <target-realm-url>
# e.g. boxel realm push . http://localhost:4201/user/my-realm/

# Or two-way sync (resolves conflicts via --prefer-local etc.):
boxel realm sync <local-dir> <target-realm-url> --prefer-local
```

See the `realm-sync` skill for the full surface (flags, conflict
resolution, watch mode).

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

### `boxel parse [path]`

Type-checks `.gts` / `.gjs` / `.ts` via glint (template-aware
TypeScript) and validates the document structure of `.json`
files. From inside the workspace dir, it defaults to checking
the local files — use this as a pre-flight before pushing. With
a path argument, parses just that file (extension required:
`.gts` / `.gjs` / `.ts` / `.json`).

```bash
# from inside the workspace dir
boxel parse                        # whole workspace
boxel parse sticky-note.gts        # single file
boxel parse Spec/sticky-note.json  # one Catalog Spec
```

The realm form is for checking files already pushed:

```bash
boxel parse --realm http://localhost:4201/alice/my-realm/
```

### `boxel run-command @cardstack/boxel-host/commands/evaluate-module/default`

Evaluates an ESM module in the realm's prerenderer sandbox. Use
right after writing a `.gts` to catch import errors, decorator
mishaps, or anything else that fails at module load time.

**Input shape** — `moduleIdentifier` is the _absolute_ module URL
(no `.gts` extension); `realmIdentifier` is the absolute target
realm URL (used for SSRF validation):

```bash
MODULE="http://localhost:4201/user/my-realm/sticky-note"
REALM="http://localhost:4201/user/my-realm/"
boxel run-command @cardstack/boxel-host/commands/evaluate-module/default \
  --realm "$REALM" --json \
  --input "$(jq -nc --arg m "$MODULE" --arg r "$REALM" \
              '{moduleIdentifier:$m, realmIdentifier:$r}')"
```

`--json` returns the standard `run-command` wrapper:
`{"status":"ready"|"error","result":"<json-string>","error":...}`.
Parse `result` as JSON; the command's own fields live at
`data.attributes`: `passed` (bool), and on failure `error` +
`stackTrace`. A handy one-liner:

```bash
boxel run-command ... --json | jq -r '.result | fromjson | .data.attributes.passed'
```

When a failure reports a line/column, those numbers refer to the
**transpiled** module — pair with `boxel read-transpiled` (see
above) to find the offending source construct, then fix the `.gts`
source. **Never copy transpiled patterns back into source.**

Test files (`*.test.*`) are rejected — `boxel test` handles those.

### `boxel run-command @cardstack/boxel-host/commands/instantiate-card/default`

Instantiates a single card in the prerenderer sandbox. Use after
writing a `.json` instance to catch shape mismatches or runtime
errors in field initializers.

**Input shape** — `moduleIdentifier`, `cardName`, and
`realmIdentifier` are required; `instanceData` is optional but
needed to exercise actual field values. **All three identifiers
must be absolute URLs.** If `instanceData` is passed, its
`data.meta.adoptsFrom.module` must already be the same absolute URL
(the relative form `../sticky-note` will be rejected with
"instanceData adoptsFrom (...) does not match moduleUrl/cardName").

```bash
MODULE="http://localhost:4201/user/my-realm/sticky-note"
REALM="http://localhost:4201/user/my-realm/"
CARD_NAME="StickyNote"
# Instance folders are named exactly after the card type (singular),
# matching the convention used across the catalog/experiments realms.
INSTANCE_PATH="StickyNote/note-1.json"

# Read the workspace JSON, rewrite adoptsFrom.module to the absolute URL,
# then feed it to instantiate-card as the instanceData string.
INSTANCE_DATA=$(jq -c --arg m "$MODULE" --arg name "$CARD_NAME" \
  '.data.meta.adoptsFrom = {module:$m, name:$name}' "$INSTANCE_PATH")

boxel run-command @cardstack/boxel-host/commands/instantiate-card/default \
  --realm "$REALM" --json \
  --input "$(jq -nc --arg m "$MODULE" --arg n "$CARD_NAME" --arg r "$REALM" --arg d "$INSTANCE_DATA" \
              '{moduleIdentifier:$m, cardName:$n, realmIdentifier:$r, instanceData:$d}')"
```

Same `--json` shape as `evaluate-module`: parse the wrapper's
`result` field as JSON, then read `data.attributes.passed` /
`error` / `stackTrace`.

**Do not** pass a `Spec/...json` path or any card whose
`adoptsFrom.module` is a base-realm URL
(`https://cardstack.com/base/...`). Specs adopt from the base
realm, and the prerender refuses cross-origin module loads with
"moduleUrl origin does not match realmUrl origin". To validate
Specs, run `boxel test` (which exercises the Spec's
`linkedExamples` against the card class).

### `boxel test [path]`

Drives a headless Chromium against the host app's compiled test
bundle and runs every `*.test.gts` file in a workspace. Returns
pass/fail counts plus per-failure details.

```bash
boxel test                  # tests cwd against a local in-process
                            # module server (no realm-server required)
boxel test ./my-workspace   # explicit workspace dir
boxel test --json | jq      # machine-readable
boxel test --debug          # stream browser console
boxel test --realm <url>    # opt back into testing a remote realm
```

**Default is local mode** — there is no push step. The CLI starts an
in-process transpiling server that serves cards from the workspace
dir and the bundled base realm. `--realm <url>` is the older flow that
fetches modules from a running realm-server; use it only when you
specifically need to test cards already on a remote realm.

The CLI ships its own test harness (`bundled-test-harness/`) and the
base realm source (`bundled-realms/`) so this works on a published
install with no monorepo on disk.

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
6. **Pre-flight: `boxel parse` locally — _before_ any push.** From
   inside the workspace dir, run `boxel parse` (no flags — it
   defaults to reading the cwd). This catches type errors and
   malformed Spec JSON in seconds, without a realm round-trip. If
   it reports errors, fix the files locally and re-run
   `boxel parse` until clean. Only then proceed to step 7. This
   step does NOT produce a `Validations/parse_*.json` artifact —
   that's reserved for the post-push validator pass below.
7. **Push the workspace** to the target realm.
8. **Run the realm-side validators and iterate until they all
   pass — or until you hit a bail-out limit.** Each pass through
   the loop:
   1. Run each validator (in this order — cheap to expensive):
      `boxel lint <changed-file>`, `boxel parse <changed-file> --realm <url>`,
      `boxel run-command @cardstack/boxel-host/commands/evaluate-module/default --input '{"moduleIdentifier":"<absolute-module-url>","realmIdentifier":"<absolute-realm-url>"}'`,
      `boxel run-command @cardstack/boxel-host/commands/instantiate-card/default --input '{"moduleIdentifier":"<absolute-module-url>","cardName":"<ClassName>","realmIdentifier":"<absolute-realm-url>","instanceData":"<json-string-with-absolute-adoptsFrom>"}'`,
      `boxel test`. Use `--json` so the structured result is
      available. The post-push parse with `--realm` is what
      produces the `Validations/parse_*.json` audit-trail card —
      step 6's local parse is a pre-flight, not an audit.
   2. After each validator, write a corresponding
      `Validations/<type>_<issue-slug>-<n>.json` artifact card
      (see "Validation artifact cards" below). The card captures
      this run's result — `status: "passed"` or `"failed"` —
      regardless of outcome.
   3. If any validator returned `"failed"` or `"error"`: fix the
      relevant source files in the workspace, push, and re-run.
      Write new artifact cards on the next iteration with the
      next sequence number (`<type>_<issue-slug>-2.json`,
      `-3.json`, …) — do NOT overwrite the previous ones. The
      historical sequence is the audit trail.
   4. Stop iterating when every validator's most recent
      artifact card has `status: "passed"`. A single fix-up
      that resolves multiple validators can land in one
      iteration; you don't have to re-fail before each retry.

   **Do not mark the Issue done until every validator passes.**
   "Most failed but a few passed, good enough" is not the bar.

   **Bail-out limits — don't spiral.** The validator loop must
   terminate. If you hit any of these, stop iterating and
   proceed to "Bailing out" below instead of marking the Issue
   done:
   - **8 total iterations per Issue.** If after 8 passes through
     the validator loop you still don't have all five validators
     green, stop. (This matches the orchestrator's old
     `maxIterationsPerIssue` default.)
   - **3 consecutive failures of the same validator with the
     same error.** Compare the latest 3 artifact cards for the
     failing validator. If the failure message (or the first
     line of the stack) is identical, your fix isn't working —
     stop. Continuing past this point burns context for no gain.
   - **5 distinct fix attempts on the same validator without a
     single pass.** Look across the artifact-card sequence: if a
     validator has 5+ failed cards and no passed card, the
     problem is outside this Issue's scope.

9. **Push the workspace** so the final validation cards land on
   the realm.
10. **Either mark done or bail out.**
    - If all five validators passed: edit
      `Issues/<slug>.json:data.attributes.status` to `"done"` and
      push. (See `software-factory-scheduling` for the full
      status-transition rules.)
    - If you hit a bail-out limit: see "Bailing out" below.

## Bailing out (when validators won't go green)

Some failures aren't fixable in one agent session — a brief
ambiguity, a runtime error rooted outside the workspace, a flaky
host-app dependency. Don't keep retrying past the limits in
step 7.

When you stop:

1. Set the Issue's `status` to `"blocked"` (not `"done"`, not
   `"in_progress"`).
2. Append a comment to the Issue (see "Adding a comment to an
   existing Issue") summarizing:
   - Which validator(s) you couldn't get green.
   - The most recent failure message(s), copied verbatim from
     the artifact card.
   - A brief enumeration of what you tried, keyed to the artifact
     card sequence numbers (e.g. "Iteration 1: added missing
     field. Iteration 2: changed type. Iteration 3: ...").
   - Which bail-out limit you hit (8 iterations / 3 identical
     failures / 5 distinct attempts).
3. Push so the status flip + comment land on the realm.
4. Hand back to `software-factory-scheduling` — pick the next
   eligible Issue and work it. **Do not** mark the Project
   `projectStatus: completed` if any Issues are blocked; finish
   what's still workable, then stop and report.

The artifact cards under `Validations/` already capture the
detailed evidence (per-validator output, sequence of failures).
The Issue comment is the human-readable summary on top of that
audit trail.

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
├── Knowledge Articles/
│   └── article-name.json            # KnowledgeArticle card
└── Validations/
    ├── lint_issue-slug-1.json       # LintResult card
    ├── parse_issue-slug-1.json      # ParseResult card
    ├── eval_issue-slug-1.json       # EvalResult card
    ├── instantiate_issue-slug-1.json # InstantiateResult card
    └── test_issue-slug-1.json       # TestRun card
```

## Validation artifact cards

After each validator runs, write a corresponding artifact card
under `Validations/`. Together they form the audit trail the human
sees in the Boxel host UI — a sortable history of every validation
run for every Issue.

Five card types, one per validator, all published from the source
realm. Build each module URL from the target realm's origin (same
pattern as the tracker module URL):

| CLI                                              | Card class          | Source module                                  |
| ------------------------------------------------ | ------------------- | ---------------------------------------------- |
| `boxel lint`                                     | `LintResult`        | `<origin>/software-factory/lint-result`        |
| `boxel parse`                                    | `ParseResult`       | `<origin>/software-factory/parse-result`       |
| `boxel run-command .../evaluate-module/default`  | `EvalResult`        | `<origin>/software-factory/eval-result`        |
| `boxel run-command .../instantiate-card/default` | `InstantiateResult` | `<origin>/software-factory/instantiate-result` |
| `boxel test`                                     | `TestRun`           | `<origin>/software-factory/test-results`       |

### File naming

`Validations/<type>_<issue-slug>-<n>.json` where:

- `<type>` ∈ `lint`, `parse`, `eval`, `instantiate`, `test`.
- `<issue-slug>` is the Issue's slug (the part after `Issues/` in
  its file path — e.g. `sticky-note-sticky-note` for
  `Issues/sticky-note-sticky-note.json`).
- `<n>` is a per-issue sequence number: 1 on first run, increment
  for retries. Before writing, glob
  `Validations/<type>_<issue-slug>-*.json` to find the highest
  existing number and use `n+1`. On the first iteration the folder
  may not exist yet — that's fine, `<type>_<issue-slug>-1.json`.

### Document shape

For each artifact card:

1. Run the validator with `--json` and capture the structured
   output. The CLI's JSON shape is **not** the card's attribute
   shape — they overlap but differ.
2. Introspect the live card schema before writing:

   ```bash
   boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
     --realm <target-realm-url> \
     --input '{"codeRef":{"module":"<source-module-url>","name":"<ClassName>"}}'
   ```

3. Map the validator's `--json` fields to the schema's attributes.
   The naming usually matches closely (`status`, `errorCount`,
   `durationMs`, etc.) but the schema is the source of truth for
   field names, types, and enum values. Don't guess.
4. Write the card via `Write` with the standard JSON:API envelope:

   ```json
   {
     "data": {
       "type": "card",
       "attributes": {
         /* mapped from the validator's --json output, per the schema */
         "status": "passed",
         "runAt": "2026-05-15T10:42:00.000Z"
         /* ...other schema attributes... */
       },
       "relationships": {
         /* if the schema names an issue/project relationship, link
            back to ../Issues/<slug> / ../Projects/<slug> */
       },
       "meta": {
         "adoptsFrom": {
           "module": "<source-module-url>",
           "name": "<ClassName>"
         }
       }
     }
   }
   ```

### Write artifact cards even on success

The audit trail is the point — a green `LintResult` is just as
valuable as a red one for showing the human what was checked.
Always write the card after running the validator, regardless of
pass/fail. The `status` attribute (`"passed"` / `"failed"` /
`"error"`) carries the outcome.

### Iteration semantics

When fixing a validator failure, **don't overwrite the previous
artifact**. Write a new card with the next sequence number
(`<type>_<issue-slug>-2.json`, `-3.json`, …) so the history shows
the full path from failure to fix. The host UI sorts by
`sequenceNumber` (or `runAt`) and displays the latest at the top.

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
      let { StickyNote } =
        await loader.import<typeof import('./sticky-note')>(cardModuleUrl);
      let note = new StickyNote({ title: 'Test Note', body: 'Hello' });
      await renderCard(loader, note, 'fitted');
      assert.dom('[data-test-title]').hasText('Test Note');
    });
  });
}
```

**Why `loader.import<typeof import('./sticky-note')>(...)`?** The
`loader.import()` return type is untyped by default — destructuring
`{ StickyNote }` from it would type-check as `any` in your
`.test.gts` and **`boxel parse` will fail with a type error**
(loader.import returns `{}` for a generic call). Always pass the
module's TypeScript shape via the type generic, using the same
relative path you'd use for a direct import. This is parse-step
table stakes; without it your tests don't get past validation.

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
- `realm-sync` — `boxel realm push` / `boxel realm pull` / `boxel realm sync` / workspace sync.
