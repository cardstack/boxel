---
name: software-factory-bootstrap
description: Use when processing a bootstrap issue — covers how to create Project, IssueTracker, KnowledgeArticle, and implementation Issue cards from a brief.
---

# Software Factory Bootstrap

Use this skill when the current issue has `issueType: bootstrap`. Your job is
to read the brief, create project artifacts, and set up the issue backlog for
the implementation phase.

## Two modes: greenfield vs adjust

The bootstrap issue's description tells you which mode you're in:

- **Greenfield** (no source card) — build new cards from scratch. Create
  Project / IssueTracker / Knowledge Articles, then one `feature` Issue per
  entry-point card. This is the default; the rest of this skill describes it.
- **Adjust** (the brief carries a `sourceCardUrl`, surfaced in the bootstrap
  issue as **"Source card to adjust:"**) — seed the target realm with a
  working copy of an existing card, confirm it's green, then create
  `adjustment` Issues that describe deltas to it. See **"Adjust flow"** below.

Everything from the implementation loop onward (scheduling, the validators,
status transitions, project completion) is identical for both modes — adjust
is a superset, not a fork. The only differences are the seed-from-source
sub-phase below and that adjust emits `adjustment` Issues instead of
`feature` Issues.

## Adjust flow (when a source card is present)

Do this **in addition to** the standard Project / IssueTracker / Knowledge
Article artifacts (steps still apply), and **instead of** creating `feature`
Issues per entry-point card.

1. **Seed the source card + its same-realm dependency graph.** From inside the
   workspace dir, run the dedicated ingestion command (read-only from the
   source realm — it doesn't write to it):
   ```bash
   boxel realm ingest-card "<source-card-url>" .
   ```
   It copies, preserving realm-relative paths: the source card's module, every
   same-realm module it imports transitively (**including type-only imports**,
   which a runtime dep graph would miss but `boxel parse` needs), its sample
   instances, and its **card-level** Catalog Spec. Cross-realm imports
   (`https://cardstack.com/base/...`) and component/function Specs are left out
   on purpose. Pass `--realm <url>` only if the source realm can't be
   auto-detected.
   - **If the source card has no co-located test** — common for catalog
     cards, which rarely ship `.test.gts` — write **characterization tests**
     that capture its current behavior: field defaults, computed-field
     outputs (e.g. a `displayName` / `valueChange`), and the key rendered
     output of its formats. These establish the green baseline; they are
     what the adjustment must not regress. Without them there is nothing to
     protect and `run_tests` (which fails on zero tests) can never go green.
2. **Confirm a green baseline.** Run `run_parse`, `run_evaluate`,
   `run_instantiate`, and `run_tests` against the seeded copy. They must **all
   pass before you create any adjustment Issue** — `run_tests` relies on the
   co-located or characterization tests from step 1; a zero-test run counts
   as failed. A red parse/eval/instantiate baseline usually means the copy is
   incomplete (a missed same-realm dependency) — copy the missing file and
   re-run. If you cannot get green, `request_clarification` rather than
   proceeding.
3. **Write a source-provenance Knowledge Article**
   (`Knowledge Articles/<slug>-source-provenance.json`, `articleType` per the
   schema): the `sourceCardUrl`, the list of files copied, and the baseline
   validator results. This is what later issues read to understand what the
   seed was.
4. **Create `adjustment` Issues** — one per coherent delta the brief
   describes (not one-per-entry-point-card; that's the greenfield rule). Use
   `issueType: "adjustment"` (confirm the enum via `get_card_schema`). Each
   adjustment Issue's `description` (immutable after creation) must name:
   - the **workspace-relative target file(s)** to edit — the seeded card and
     any support files the delta touches (they already exist in the workspace);
   - the **delta** — what changes, phrased as a diff against the seeded
     baseline, not a from-scratch card spec;
   - **acceptance** — the new expected behavior and its test assertions, plus
     the standing requirement that the **pre-existing baseline tests keep
     passing** (the delta must not regress the green baseline).

   Adjustment Issues direct edits at the **seeded artifacts** — module,
   tests, sample instances, Spec. Don't write an Issue that asks for a new
   module, instance, or Spec alongside the seeded ones unless the brief
   explicitly asks for a new card.

   Wire `project` / `relatedKnowledge` (include the provenance article) /
   `blockedBy` exactly as for `feature` Issues.

The implementation agent that later picks up an `adjustment` Issue **edits**
the seeded files rather than creating cards from scratch — see the
"Adjustment issues" section of `software-factory-operations`.

## How to write tracker-schema cards

Project, KnowledgeArticle, and Issue cards are plain `.json` files in
the workspace. Use the native `Write` tool with the exact JSON:API
document shape documented below for each card type.

**The system prompt names the live tracker module URL** (the value you
should put in `data.meta.adoptsFrom.module` for Project / Board / Issue /
KnowledgeArticle cards). Use that URL verbatim — do not try to derive it.

| File                               | adoptsFrom.name    |
| ---------------------------------- | ------------------ |
| `Projects/<slug>.json`             | `Project`          |
| `Boards/<slug>.json`               | `IssueTracker`     |
| `Knowledge Articles/<slug>-*.json` | `KnowledgeArticle` |
| `Issues/<slug>-<card-slug>.json`   | `Issue`            |

For each card, the document is:

```json
{
  "data": {
    "type": "card",
    "attributes": { ... per the live schema (see below) ... },
    "relationships": { ... per the live schema (see below) ... },
    "meta": {
      "adoptsFrom": {
        "module": "<darkfactoryModuleUrl from system prompt>",
        "name": "<Project | Issue | KnowledgeArticle>"
      }
    }
  }
}
```

### Fetch the live schema before writing

Do **not** memorize attribute names, enum values, or relationship keys
for these cards — they evolve. Before writing a Project / Issue /
KnowledgeArticle JSON file, call:

```
get_card_schema({ module: "<darkfactoryModuleUrl>", name: "Project" })
```

(and the same for `Issue` / `KnowledgeArticle`). The tool returns the
live `{ attributes, relationships? }` JSON Schema introspected from the
real `CardDef` — including the allowed enum values for fields like
`status` / `priority` / `issueType` / `articleType` / `projectStatus`
and the relationship keys (`project`, `relatedKnowledge`,
`knowledgeBase`, `blockedBy`, etc.). Use the field names, types, and
enums it returns verbatim. Schemas are cached per-process, so repeated
calls are cheap.

Catalog Spec cards (`Spec/<slug>.json`) are different — they adopt from
`https://cardstack.com/base/spec` / `Spec`. Fetch their schema the same
way: `get_card_schema({ module: "https://cardstack.com/base/spec",
name: "Spec" })`. The catalog spec workflow is documented in the
software-factory-operations skill.

## Naming Conventions

Derive names from the brief title:

- **slug**: lowercase, replace non-alphanumeric runs with hyphens, strip leading/trailing hyphens
  - `"Sticky Note"` → `sticky-note`
- **projectCode**: 2-4 uppercase initials from the title words
  - `"Sticky Note"` → `SN`
  - `"Employee Handbook"` → `EH`
  - `"Customer Relationship Manager"` → `CRM` (first 3-4 words)

## Card Authoring Guidance

The field/relationship shapes for each card type are fetched at runtime
via `get_card_schema` (see "Fetch the live schema before writing"
above). This section covers what is **not** in the schema: what to put
in those fields and how to organize the bootstrap output.

### Project Card

**Path:** `Projects/<slug>.json`
**adoptsFrom.name:** `Project`

Fetch the schema, then populate the attributes from the brief:

- The project-name attribute → the brief's title (e.g. `"Sticky Note"`).
- The project-code attribute → 2–4 uppercase initials from the title (e.g. `"SN"`).
- The objective / scope / technical-context / success-criteria attributes → derive from the brief content. Use markdown.
- The status attribute → use one of the enum values returned by the schema for an active project (typically the "active" / starting state — the schema's enum is the source of truth, never guess).

**Relationships:** the schema names the array relationship that links a
project to its knowledge articles. Populate one entry per article you
create (paths like `../Knowledge Articles/<slug>-<article-slug>`).

- `board` → `{ links: { self: "../Boards/<slug>" } }`
- `knowledgeBase.0` → `{ links: { self: "../Knowledge Articles/<slug>-<article-slug>" } }` (one entry per article)

### IssueTracker Card

**Path:** `Boards/<slug>.json`
**adoptsFrom:** `{ module: "<darkfactoryModuleUrl>", name: "IssueTracker" }`

Create one board per bootstrapped project. It is the canonical board for that
project's issues and should be linked both ways with the Project card.

| Field              | Type    | Example           |
| ------------------ | ------- | ----------------- |
| `boardTitle`       | String  | `"<title> Board"` |
| `hideEmptyColumns` | Boolean | `false`           |

**Relationships:**

- `project` → `{ links: { self: "../Projects/<slug>" } }`

### KnowledgeArticle Card

**Paths:** `Knowledge Articles/<slug>-<article-slug>.json` (as many as needed)
**adoptsFrom.name:** `KnowledgeArticle`

Always create at least two articles:

- **Brief Context** (`<slug>-brief-context`) — full brief content and background.
- **Agent Onboarding** (`<slug>-agent-onboarding`) — how to work on this project.

Add more as the brief warrants (e.g., detailed visual design, deep
domain knowledge). Keep each article cohesive with a clear guiding
principle. Use the `articleType` enum values returned by the schema to
classify each one (e.g., one for context, one for onboarding); use the
schema's enum literally.

### Issue Card — Organized by Entry-Point Card

**Paths:** `Issues/<slug>-<card-name-slug>.json` (one per entry-point card, named after the card)
**adoptsFrom.name:** `Issue`

Organize implementation issues around **entry-point cards** — the top-level cards users interact with directly and that should be discoverable in the catalog. Create **one issue per entry-point card**, named after that card.

Each issue covers the full scope of its entry-point card:

- Card definition (`.gts`) and any interior/support cards it depends on
- QUnit tests (`.test.gts`) for the entry-point card **and** all its support cards
- Catalog Spec (`Spec/<card-name>.json`) with realistic example instances via `linkedExamples`

Interior cards (field cards, helper cards, linked supporting types) are
implemented as part of their entry-point card's issue. They need tests
but do **not** need their own catalog specs or separate issues.

**Populating attributes** (consult the schema for the exact field names and enum values):

- The issue-id attribute → `"<projectCode>-<N>"` (sequential).
- The summary attribute → `"Implement <card name> card"`.
- The description attribute → markdown describing the card to create, its fields, support cards, tests, spec, and examples. **Immutable after creation** — see Issue Invariants below.
- The issue-type / status / priority attributes → use the enum values returned by the schema. For a fresh bootstrap, all issues start in the "backlog" state with issue-type "feature". Mark the first issue as the highest non-critical priority and the rest a step lower.
- An `order` field (sequential integer 1, 2, 3, …) for the scheduler.
- The acceptance-criteria attribute → markdown checklist: card def, support cards, tests, spec, examples.
- Timestamp fields → ISO timestamps. Note that on Issues these are top-level attributes (e.g. `createdAt` / `updatedAt`) — distinct from the timestamp field inside individual `comments[]` entries (which is named `datetime`, see operations skill). The schema is the source of truth.

**Relationships for each issue** (the schema names the keys):

- A `project` link → `../Projects/<slug>`.
- Knowledge-article links — one entry per knowledge article you want loaded into the agent's context (typically the brief-context and agent-onboarding articles you created above).
- A blocked-by relationship for any issues that must complete first.

**Dependency ordering:** If one entry-point card depends on another
(e.g., card B uses card A as a field type or linked card), order the
issues so the depended-upon card is implemented first. Set `order`
values accordingly (dependency-free cards get lower order numbers) and
wire the blocked-by relationship so consuming cards cannot start until
their dependencies are done.

If the brief describes only one entry-point card, create one issue. If it describes multiple, create one per entry-point card ordered so dependency cards come first.

## Issue Invariants — read carefully

The orchestrator depends on three rules about Issue cards. Before this
skill rewrite they were enforced by a wrapper tool that stripped /
ignored disallowed fields automatically. Now that you write the JSON
directly, you must enforce them yourself:

1. **`description` is immutable after creation.** Never modify an
   Issue's `description` once the card exists. To add post-creation
   context (blocked reasons, validation failures, progress notes), use
   the `comments` array instead — see "Adding a comment to an existing
   issue" in the operations skill.
2. **`status` transitions are restricted to the agent.** You may set
   `status` to `"blocked"` (cannot proceed) or `"backlog"` (unblock).
   Never set `status` to `"done"` or `"in_progress"` — those are owned
   by the orchestrator based on `signal_done` + validation results.
3. **Read before write for updates.** When updating an existing Issue
   (or any tracker card), `Read` the file first, modify only the
   attributes you intend to change, then `Write` (or `Edit`) the merged
   document back. Do not overwrite the whole file with only the new
   fields — you'll silently drop existing attributes the file had.

## Why Relationships Matter

The `project` and `relatedKnowledge` relationships on implementation issues are
how the orchestrator loads context for the agent. When the agent picks up an
issue, `ContextBuilder.buildForIssue()` traverses these relationships to
load the Project card and Knowledge Articles into the agent's context. Without
these relationships, the agent would have no project scope or brief content.

## Document Envelope

All three card types share the same JSON:API envelope — only the
`attributes`, `relationships`, and `adoptsFrom.name` differ. The
attribute names, enum values, and relationship keys come from the
schema you fetched with `get_card_schema`; the envelope is fixed:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      // populate per the schema returned by:
      //   get_card_schema({ module: "<darkfactoryModuleUrl>", name: "Issue" })
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
        "module": "<darkfactoryModuleUrl from system prompt>",
        "name": "Issue"
      }
    }
  }
}
```

Use relative paths (`../`) for `links.self` since cards live in sibling
directories within the workspace. The same envelope applies to Project
and KnowledgeArticle — only the `adoptsFrom.name` and the
schema-derived attributes/relationships change.

## Completion

After creating all artifacts, call `signal_done()`. The orchestrator manages
issue status transitions — do NOT set the issue status to "done" yourself.
The orchestrator will mark the issue as done after validation passes.
