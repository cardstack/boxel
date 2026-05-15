---
name: software-factory-bootstrap
description: Use when processing a bootstrap Issue inside an interactive Claude Code session — read the brief, create the target realm if needed, and write the Project, IssueTracker, Knowledge Article, and implementation Issue cards into the workspace. Pair with `software-factory-scheduling` (status transitions) and `software-factory-operations` (the per-issue workflow that picks up after bootstrap completes).
---

# Software Factory Bootstrap

Use this skill when the Issue you just picked up has
`attributes.issueType: "bootstrap"`. Your job is to read the brief,
make sure the target realm exists, and seed the project artifacts
that drive the rest of the run: a Project card, an IssueTracker
board, Knowledge Article cards with the brief context, and one
implementation Issue per entry-point card the brief describes.

## When you reach this skill

The user has handed you (or the seed Issue carries) two URLs:

- A **brief URL**, e.g.
  `http://localhost:4201/software-factory/Wiki/sticky-note`. The
  brief is a card in the source realm.
- A **target realm URL**, e.g.
  `http://localhost:4201/<username>/<realm-name>/`. The target may
  or may not exist yet.

Your `cwd` is the local workspace mirror of the target realm.

## First: verify the `boxel` CLI works

Before doing anything else, run `boxel --version`. If it succeeds
you're ready. If `boxel` is **not on PATH**, you're running against
an in-development boxel-cli — fall back to the dev binary at:

```
<monorepo>/packages/boxel-cli/bin/boxel.js
```

That script auto-falls-back to `ts-node` against the TS source when
`packages/boxel-cli/dist/` is missing or stale, so it always has
the latest commands. Two safe ways to use it:

```bash
# Option A — invoke directly with node
node /Users/jurgen/development/boxel/packages/boxel-cli/bin/boxel.js --version

# Option B — symlink onto PATH for the rest of the session
ln -sf /Users/jurgen/development/boxel/packages/boxel-cli/bin/boxel.js \
       ~/.local/bin/boxel    # or any other dir on PATH
boxel --version
```

If `dist/` exists but is stale (missing the validator commands like
`boxel lint` / `boxel parse` / `boxel test`), either rebuild
(`pnpm --filter @cardstack/boxel-cli build`) or rename `dist/` to
something like `dist.stale/` so the shim falls back to the live TS
source. Otherwise old code without the new commands will be
executed and validators won't work.

This setup wrinkle is Phase 1 only — once boxel-cli ships
end-to-end the dev workaround goes away.

## Creating the target realm

If the target realm does not already exist, create it before
writing anything into the workspace. Confirm by attempting to read
the realm or its `_mtimes` endpoint; a 404 means "not yet created."

```bash
boxel run-command create-realm \
  --realm <realm-server-url> \
  --input '{"endpoint":"<username>/<realm-name>","name":"<Display Name>"}'
```

(Exact flag names and realm-creation surface vary by `boxel-cli`
version — see the `realm-sync` skill for the canonical command.
`boxel realm create` may be available as a sugar variant.)

Once the realm exists, set up the workspace mirror for it:

```bash
boxel pull --realm <target-realm-url>
```

A freshly-created realm is empty, so the pull is a no-op except to
establish the cwd → realm mapping. All subsequent writes happen in
the workspace and propagate via `boxel push` when you sync.

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
    "attributes": { /* per the live schema (see below) */ },
    "relationships": { /* per the live schema (see below) */ },
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

## Completion

When you've written every artifact (Project, IssueTracker,
Knowledge Articles, and one Issue per entry-point card):

1. **Push the workspace** to the target realm.

   ```bash
   boxel push --realm <target-realm-url>
   ```

2. **Flip the bootstrap Issue's `status` from `in_progress` to
   `done`** (see `software-factory-scheduling` for the
   read-before-write pattern).

3. **Push again** so the status flip lands.

4. **Stop and report** what you created. Do not start implementing
   any of the freshly-created Issues yourself — that's the next
   prompt's job. The user (or the next prompt) will pick the next
   unblocked Issue and hand it to a fresh agent invocation.

## See also

- `software-factory-scheduling` — picking the next Issue once
  bootstrap is done; status-transition rules.
- `software-factory-operations` — what the next agent does inside
  each freshly-created implementation Issue (write `.gts` /
  `.test.gts` / instances / Spec, run validators, fix failures,
  mark done).
- `boxel-development` — `.gts` card authoring patterns.
- `realm-sync` — `boxel push` / `boxel pull` / realm-creation
  surface.
