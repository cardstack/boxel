---
name: software-factory-bootstrap
description: Use when processing a bootstrap Issue inside an interactive Claude Code session — read the brief, create the target realm if needed, and write the Project, IssueTracker, Knowledge Article, and implementation Issue cards into the workspace. Pair with `software-factory-scheduling` (status transitions) and `software-factory-operations` (the per-issue workflow that picks up after bootstrap completes).
---

# Software Factory Bootstrap

Use this skill when the Issue you just picked up has
`attributes.issueType: "bootstrap"`. Your job is to read the brief,
make sure the target realm exists, and seed the project artifacts
that drive the rest of the run: a Project card, an IssueTracker
board, Knowledge Article cards with the brief context, and the
implementation Issues.

## Two modes: greenfield vs adjust

The brief tells you which mode you're in. Read the brief card's JSON
(`boxel file read "<brief-path>.json" --realm <source-realm-url>`)
and check `data.attributes.sourceCardUrl`:

- **Greenfield** (`sourceCardUrl` absent or empty) — build new cards
  from scratch. Create Project / IssueTracker / Knowledge Articles,
  then one `feature` Issue per entry-point card. This is the
  default; the rest of this skill describes it.
- **Adjust** (`sourceCardUrl` set) — seed the target realm with a
  working copy of the existing card it points at, confirm the copy
  is green, then create `adjustment` Issues that describe deltas to
  it. See **"Adjust flow"** below.

Everything from the implementation loop onward (scheduling, the
validators, status transitions, project completion) is identical for
both modes — adjust is a superset, not a fork. The only differences
are the seed-from-source sub-phase below and that adjust emits
`adjustment` Issues instead of `feature` Issues.

## When you reach this skill

The user has handed you (or the seed Issue carries) two URLs:

- A **brief URL**, e.g.
  `http://localhost:4201/software-factory/Wiki/sticky-note`. The
  brief is a card in the source realm.
- A **target realm URL**, e.g.
  `http://localhost:4201/<username>/<realm-name>/`. The target may
  or may not exist yet.

You start in `packages/software-factory/` (where Claude Code was
launched so the `.claude/skills` symlink is picked up). The local
workspace mirror of the target realm is **not** your cwd at
session start — you create it during bootstrap as a fresh temp
directory and `cd` into it. See "Set up the workspace" below.

## First: verify `boxel` is installed

The user is expected to have `@cardstack/boxel-cli` installed
(see the runbook prerequisites). Verify it's on PATH and exposes
the commands this skill needs:

```bash
boxel --version
help_output="$(boxel --help)"
for cmd in lint parse test; do
  echo "$help_output" | grep -qE "^[[:space:]]+$cmd[[:space:]]" || {
    echo "boxel --help is missing the \`$cmd\` subcommand."
    echo "Ask the user to install or upgrade @cardstack/boxel-cli:"
    echo "  pnpm i -g @cardstack/boxel-cli"
    exit 1
  }
done
```

If verification fails, **stop and report**. Don't try to install
`boxel` yourself.

## Creating the target realm

If the target realm does not already exist, create it before
writing anything into the workspace. Confirm by attempting to read
the realm or its `_mtimes` endpoint; a 404 means "not yet created."

The realm-creation command is a native boxel-cli subcommand
(not `boxel run-command`):

```bash
boxel realm create <realm-name> "<Display Name>"
# e.g. boxel realm create factory-test-stickynote "Factory Test Sticky Note"
```

**`<realm-name>` is just the realm's slug** — must match
`^[a-z0-9-]+$` (lowercase letters, numbers, hyphens). **Do not pass
a path with a slash** (e.g. `user/my-realm`); the regex will reject
it. The realm server prepends the user-namespace segment
automatically based on the active profile's identity. Given the
target realm URL the user wants, derive the slug from the final
path segment:

- target URL: `http://localhost:4201/user/factory-test-stickynote-2/`
- realm-name to pass: `factory-test-stickynote-2`
- server returns: `http://localhost:4201/user/factory-test-stickynote-2/`

You may see a warning like
`⚠️ Detected local realm directories at legacy local paths`.
That's an informational notice about an unrelated directory layout
issue in your cwd — it does **not** affect realm creation. Ignore
it unless the command itself exits non-zero.

See the `realm-sync` skill for the full surface (auth, icon URL,
etc.).

## Set up the workspace

Once the realm exists, create a fresh temp directory as the local
workspace mirror, pull the (empty) realm into it, and `cd` so
realm-relative paths resolve. After this step, every subsequent
file operation in this skill (and in `software-factory-operations`)
runs from inside the workspace:

```bash
WORKSPACE="$(mktemp -d)"
boxel realm pull <target-realm-url> "$WORKSPACE"
cd "$WORKSPACE"
pwd                              # confirm cwd is the temp workspace
```

A freshly-created realm is empty, so the pull is a no-op except to
establish the local-dir ↔ realm mapping. All subsequent writes
happen in the workspace and propagate via
`boxel realm push <local-dir> <realm-url>` when you sync.

## Adjust flow (when the brief sets `sourceCardUrl`)

Do this **in addition to** the standard Project / IssueTracker /
Knowledge Article artifacts (those steps still apply), and **instead
of** creating `feature` Issues per entry-point card.

1. **Seed the source card + its same-realm dependency graph.** From
   inside the workspace dir, run the dedicated ingestion command
   (read-only from the source realm — it doesn't write to it):

   ```bash
   boxel realm ingest-card "<source-card-url>" .
   ```

It copies, preserving realm-relative paths, into the local workspace: the source card's
module, every same-realm module it imports transitively
(**including type-only imports**, which a runtime dep graph would
miss but `boxel parse` needs), its sample instances, and its
**card/app** Catalog Spec. Cross-realm imports
(`https://cardstack.com/base/...`) and component/function Specs
are left out on purpose. Pass `--realm <url>` only if the source
realm can't be auto-detected.

- **If the source card has no co-located test** — common for
  catalog cards, which rarely ship `.test.gts` — write
  **characterization tests** that capture its current behavior:
  field defaults, computed-field outputs, and the key rendered
  output of its formats. These establish the green baseline; they
  are what the adjustment must not regress. Without them there is
  nothing to protect and a zero-test `boxel test` run can never
  count as green.

2. **Confirm a green baseline.** Push the seeded workspace, then run
   the standard validators (per the "Validators" section of
   `software-factory-operations`: `boxel parse`, `boxel lint`,
   evaluate-module, instantiate-card, `boxel test`) against the
   seeded copy. They must **all pass before you create any
   adjustment Issue**. Two traps:
   - A validator reporting `filesChecked: 0` (or zero tests) is
     **not** a pass — it usually means the push hasn't landed yet.
     Re-sync and re-run.
   - A red parse/eval/instantiate baseline usually means the copy is
     incomplete (a missed same-realm dependency) — copy the missing
     file and re-run. If you cannot get the baseline green, **stop
     and report to the user** rather than proceeding; adjustment
     Issues against a red baseline are meaningless.

3. **Write a source-provenance Knowledge Article**
   (`Knowledge Articles/<slug>-source-provenance.json`,
   `articleType` per the schema): the `sourceCardUrl`, the list of
   files copied, and the baseline validator results. This is what
   later Issues read to understand what the seed was.

4. **Create `adjustment` Issues** — one per coherent delta the brief
   describes (not one-per-entry-point-card; that's the greenfield
   rule). Use `issueType: "adjustment"` (confirm the enum via
   `get-card-type-schema`). Each adjustment Issue's `description`
   (immutable after creation) must name:
   - the **workspace-relative target file(s)** to edit — the seeded
     card and any support files the delta touches (they already
     exist in the workspace);
   - the **delta** — what changes, phrased as a diff against the
     seeded baseline, not a from-scratch card spec;
   - **acceptance** — the new expected behavior and its test
     assertions, plus the standing requirement that the
     **pre-existing baseline tests keep passing** (the delta must
     not regress the green baseline).

   Adjustment Issues direct edits at the **seeded artifacts** —
   module, tests, sample instances, Spec. Don't write an Issue that
   asks for a new module, instance, or Spec alongside the seeded
   ones unless the brief explicitly asks for a new card.

   Wire `project` / `relatedKnowledge` (include the provenance
   article) / `blockedBy` exactly as for `feature` Issues.

The agent that later picks up an `adjustment` Issue **edits** the
seeded files rather than creating cards from scratch — see the
"Adjustment issues" section of `software-factory-operations`.

## Discover the tracker module URL

The tracker schema (Project / IssueTracker / Issue /
KnowledgeArticle) is published by the source realm at
**`<realm-server-origin>/software-factory/darkfactory`**. Build the
URL from the target realm's origin and confirm it's reachable:

```bash
boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
  --realm <target-realm-url> \
  --input '{"codeRef": {"module": "<tracker-module-url>", "name": "Project"}}'
```

If that returns a schema, you have the right URL. If it 404s, check
that the source realm is published at the same realm server (the
brief the user gave you is in a realm on the same origin).

Cache the tracker module URL for the rest of the bootstrap — every
tracker card you write references it in `meta.adoptsFrom.module`.

## How to write tracker-schema cards

Project, IssueTracker, KnowledgeArticle, and Issue cards are plain
`.json` files in the workspace. Use the native `Write` tool with the
JSON:API document shape below.

| File                               | adoptsFrom.name    |
| ---------------------------------- | ------------------ |
| `Projects/<slug>.json`             | `Project`          |
| `Boards/<slug>.json`               | `IssueTracker`     |
| `Knowledge Articles/<slug>-*.json` | `KnowledgeArticle` |
| `Issues/<slug>-<card-slug>.json`   | `Issue`            |

For each card, the document envelope is:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      /* per the live schema (see below) */
    },
    "relationships": {
      /* per the live schema (see below) */
    },
    "meta": {
      "adoptsFrom": {
        "module": "<tracker-module-url>",
        "name": "Project"
      }
    }
  }
}
```

### Fetch the live schema before writing each tracker card

Do **not** memorize attribute names, enum values, or relationship
keys for these cards — they evolve. Before writing a Project /
IssueTracker / Issue / KnowledgeArticle JSON, call:

```bash
boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
  --realm <target-realm-url> \
  --input '{"codeRef": {"module": "<tracker-module-url>", "name": "Project"}}'
```

(Repeat per card type.) The schema returns the live
`{ attributes, relationships? }` JSON Schema introspected from the
actual `CardDef`, including the allowed enum values for fields like
`status` / `priority` / `issueType` / `articleType` /
`projectStatus`, and the relationship keys (`project`,
`relatedKnowledge`, `knowledgeBase`, `blockedBy`, etc.). Use the
field names, types, and enums it returns verbatim. Schemas are
cached on the realm server; repeated calls are cheap.

Catalog Spec cards (`Spec/<slug>.json`) are different — they adopt
from `https://cardstack.com/base/spec` / `Spec`. Spec authoring is
covered in the `software-factory-operations` skill.

## Naming conventions

Derive names from the brief title:

- **slug**: lowercase, replace non-alphanumeric runs with hyphens,
  strip leading/trailing hyphens.
  - `"Sticky Note"` → `sticky-note`
- **projectCode**: 2–4 uppercase initials from the title words.
  - `"Sticky Note"` → `SN`
  - `"Employee Handbook"` → `EH`
  - `"Customer Relationship Manager"` → `CRM`

## Card authoring guidance

The field/relationship shapes for each card type come from
`get-card-type-schema`. This section covers what is **not** in the
schema: what to put in those fields and how to organize the
bootstrap output.

### Project card

**Path:** `Projects/<slug>.json`
**adoptsFrom.name:** `Project`

Fetch the schema, then populate the attributes from the brief:

- The project-name attribute → the brief's title (e.g. `"Sticky Note"`).
- The project-code attribute → 2–4 uppercase initials from the title (e.g. `"SN"`).
- The objective / scope / technical-context / success-criteria attributes → derive from the brief content. Use markdown.
- The status attribute → use the enum value the schema returns for an active project (typically the "active" or starting state — the schema's enum is the source of truth, never guess).

**Relationships:** the schema names the array relationship that
links a project to its knowledge articles. Populate:

- `knowledgeBase.<n>` → `{ links: { self: "../Knowledge Articles/<slug>-<article-slug>" } }` (one entry per article)

The Project card itself does **not** carry a `board` relationship —
the link is one-way IssueTracker → Project (see below). Don't add a
`board` field to the Project document.

### IssueTracker card

**Path:** `Boards/<slug>.json`
**adoptsFrom:** `{ module: "<tracker-module-url>", name: "IssueTracker" }`

Create one board per bootstrapped project. It links **back** to the
Project via its `project` relationship; the Project does not link
forward to the board (see the Project section above).

| Field              | Type    | Example           |
| ------------------ | ------- | ----------------- |
| `boardTitle`       | String  | `"<title> Board"` |
| `hideEmptyColumns` | Boolean | `false`           |

(Confirm field names against the live schema before writing.)

**Relationships:**

- `project` → `{ links: { self: "../Projects/<slug>" } }`

### KnowledgeArticle cards

**Paths:** `Knowledge Articles/<slug>-<article-slug>.json` (as many as needed)
**adoptsFrom.name:** `KnowledgeArticle`

Always create at least two articles:

- **Brief Context** (`<slug>-brief-context`) — full brief content
  and background.
- **Agent Onboarding** (`<slug>-agent-onboarding`) — how to work on
  this project, key conventions specific to the brief.

Add more as the brief warrants (e.g., detailed visual design, deep
domain knowledge). Keep each article cohesive with a clear guiding
principle. Use the `articleType` enum values returned by the schema
to classify each one (e.g., one for context, one for onboarding);
use the schema's enum literally.

### Issue cards — one per entry-point card

**Paths:** `Issues/<slug>-<card-name-slug>.json` (one per entry-point
card, named after the card)
**adoptsFrom.name:** `Issue`

Organize implementation Issues around **entry-point cards** — the
top-level cards users interact with directly and that should be
discoverable in the catalog. Create **one Issue per entry-point
card**, named after that card.

Each Issue covers the full scope of its entry-point card:

- Card definition (`.gts`) and any interior/support cards it depends on
- QUnit tests (`.test.gts`) for the entry-point card **and** all its support cards
- Catalog Spec (`Spec/<card-name>.json`) with realistic example
  instances via `linkedExamples`

Interior cards (field cards, helper cards, linked supporting types)
are implemented as part of their entry-point card's Issue. They
need tests but do **not** need their own Catalog Specs or separate
Issues.

**Populating attributes** (consult the schema for exact field names
and enum values):

- The issue-id attribute → `"<projectCode>-<N>"` (sequential).
- The summary attribute → `"Implement <card name> card"`.
- The description attribute → markdown describing the card, its
  fields, support cards, tests, spec, and examples. **Immutable
  after creation** — see Issue invariants below.
- The issue-type / status / priority attributes → use the enum
  values the schema returns. For a fresh bootstrap, all Issues
  start in the `backlog` state with `issueType` `feature`. Mark
  the first Issue as the highest non-critical priority and the
  rest a step lower.
- An `order` field (sequential integer 1, 2, 3, …) for the
  scheduler.
- The acceptance-criteria attribute → markdown checklist: card def,
  support cards, tests, spec, examples.
- Timestamp fields → ISO timestamps. On Issues these are top-level
  attributes (e.g. `createdAt` / `updatedAt`) — distinct from the
  timestamp field inside individual `comments[]` entries (which is
  named `datetime`; see the operations skill). The schema is the
  source of truth.

**Relationships for each Issue** (the schema names the keys):

- A `project` link → `../Projects/<slug>`.
- Knowledge-article links — one entry per knowledge article you
  want loaded into the agent's context when this Issue is picked
  up (typically the brief-context and agent-onboarding articles).
- A `blockedBy` relationship for any Issues that must complete
  first.

**Dependency ordering.** If one entry-point card depends on another
(e.g., card B uses card A as a field type or linked card), order
the Issues so the depended-upon card is implemented first. Set
`order` values accordingly (dependency-free cards get lower order
numbers) and wire the `blockedBy` relationship so consuming cards
cannot start until their dependencies are done. The scheduling
skill describes how the next-issue picker uses these.

If the brief describes only one entry-point card, create one Issue.
If it describes multiple, create one per entry-point card, ordered
so dependency cards come first.

## Issue invariants — read carefully

The orchestrator used to enforce these via a wrapper tool. You
enforce them yourself:

1. **`description` is immutable after creation.** Never modify an
   Issue's `description` once the card exists. To add
   post-creation context (blocked reasons, validation failures,
   progress notes), use the `comments` array instead — see "Adding
   a comment to an existing Issue" in the operations skill.
2. **Status transitions are restricted** — see the
   `software-factory-scheduling` skill for the rules. For the
   Issues you create in bootstrap, leave `status` at `backlog`. The
   agent that picks each one up will flip it to `in_progress` (and
   eventually `done` or `blocked`).
3. **Read before write for updates.** When updating an existing
   Issue (or any tracker card), `Read` the file first, modify only
   the attributes you intend to change, then `Write` (or `Edit`)
   the merged document back. Do not overwrite the whole file with
   only the new fields — you'll silently drop the existing
   attributes.

## Why relationships matter

The `project` and `relatedKnowledge` relationships on implementation
Issues are how the next agent that picks up the Issue loads context.
When you pick up an Issue (per `software-factory-scheduling`), you
traverse these relationships to load the Project card and Knowledge
Articles into your working context. **Without these relationships,
the Issue would arrive without any project scope or brief
content** — the agent would have to re-derive everything from the
brief URL.

## Document envelope

All four card types share the same JSON:API envelope — only the
`attributes`, `relationships`, and `adoptsFrom.name` differ. The
attribute names, enum values, and relationship keys come from the
schema you fetched with `get-card-type-schema`; the envelope is
fixed:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      // populate per the schema returned by:
      // boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
      //   --realm <target-realm-url> \
      //   --input '{"codeRef":{"module":"<tracker-module-url>","name":"Issue"}}'
    },
    "relationships": {
      // each relationship key from the schema points at a sibling
      // card via a relative path; arrays use indexed keys (key.0, key.1, …)
      "<project-relationship-key>": {
        "links": { "self": "../Projects/<slug>" }
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "<tracker-module-url>",
        "name": "Issue"
      }
    }
  }
}
```

Use relative paths (`../`) for `links.self` since cards live in
sibling directories within the workspace. The same envelope applies
to Project, IssueTracker, and KnowledgeArticle — only the
`adoptsFrom.name` and the schema-derived attributes/relationships
change.

## The bootstrap-seed Issue

For visual parity with the SDK orchestrator's output and to give the
human a clear "this is where the factory started" anchor in the
realm UI, write **`Issues/bootstrap-seed.json`** alongside the
implementation Issues. This Issue represents the bootstrap step
itself, not the work it produced.

Attribute shape (introspect the live `Issue` schema; common fields
shown here):

- `issueId`: `"<projectCode>-0"` (use sequence `0` so it sorts above
  the SN-1 / SN-2 / … implementation Issues)
- `summary`: `"Bootstrap: read the brief and create project artifacts"`
- `description`: short markdown — the brief URL, what was created
  (Project / IssueTracker / N Knowledge Articles / M Issues).
  Immutable after creation, like any other Issue description.
- `issueType`: `"bootstrap"` (use the enum value the schema returns;
  introspect if `"bootstrap"` isn't in the enum and pick the closest
  match)
- `status`: `"done"` — set directly when you write the seed Issue,
  since the work it represents (this bootstrap pass) is by
  definition complete by the time you're persisting it
- `priority`: `"critical"` (puts it above the implementation Issues
  even if a scheduler ever picks it up)
- `order`: `0`
- `createdAt` / `updatedAt`: now

Relationships:

- `project` → `../Projects/<slug>`
- knowledge-article links — the brief-context and agent-onboarding
  articles (so the seed Issue carries the same context any
  future-you would need to understand what the bootstrap saw)

## Completion

When you've written every artifact (Project, IssueTracker,
Knowledge Articles, implementation Issues, and the bootstrap-seed
Issue):

1. **Push the workspace** to the target realm.

   ```bash
   boxel realm push <local-dir> <target-realm-url>
   # e.g. boxel realm push . http://localhost:4201/user/my-realm/
   ```

2. **Continue with implementation.** Hand off to the
   `software-factory-scheduling` skill: search the realm for the
   next unblocked Issue (the bootstrap-seed Issue is already
   `done`, so the scheduler picks one of the freshly-created
   implementation Issues), flip its status to `in_progress`, then
   follow `software-factory-operations` to write the card and run
   validators. Loop until no eligible Issues remain. The
   scheduling skill describes the full status lifecycle and the
   loop-termination rules.

You do not stop after bootstrap. Bootstrap is one phase of a single
end-to-end run; once the artifacts are pushed, scheduling takes
over in the same session.

## See also

- `software-factory-scheduling` — picking the next Issue once
  bootstrap is done; status-transition rules.
- `software-factory-operations` — what the next agent does inside
  each freshly-created implementation Issue (write `.gts` /
  `.test.gts` / instances / Spec, run validators, fix failures,
  mark done).
- `boxel` — `.gts` card authoring patterns.
- `realm-sync` — `boxel realm push` / `boxel realm pull` / `boxel realm sync` / realm-creation
  surface.
