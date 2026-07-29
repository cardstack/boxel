# Bootstrap: Process Brief and Create Project Artifacts

You are processing a bootstrap issue. Your job is to read the brief, then
create all the project artifacts needed to begin implementation.

## Brief

**Source:** {{briefUrl}}

(The source is a Boxel brief card — our authored content — OR, for
inspired-by ports, the GitHub repository itself standing in lieu of a
wiki entry. Either way the full brief content is inlined in the issue
description below; do NOT fetch this URL as a card. Port runs
additionally carry the port-background and port-code-analysis Knowledge
Articles via `relatedKnowledge` — those are the authoritative source.)

## Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}

Description:
{{issue.description}}

## What to Create

Create the following artifacts in the target realm by calling the
**`Write`** tool to produce each `.json` file. The cwd is the local
workspace mirror of the target realm; file paths below are
workspace-relative. Use **`Read`** / **`Glob`** to inspect existing
state before creating anything, and **`Bash`** to shell out to
`boxel search` if you need to query the realm. Do not describe what
you would write — call `Write` to actually create each file.

### 1. Project Card (enrich — it already exists)

The orchestrator seeded `Projects/<slug>.json` and the IssueTracker board
at `Boards/<slug>.json` before your turn — do NOT create a new Project or
a new board. Find the Project with `Glob`/`Read` (there is exactly one
under `Projects/`).

Edit the existing Project card in place:

- `successCriteria` — derive from the brief's section headings and (for
  ports) the better-than-the-original rubric
- `scope` — reorganize the seeded raw brief content into sections if it
  improves clarity; otherwise leave it
- Relationships: add `knowledgeBase.N` → `../Knowledge Articles/<slug>-<article-slug>`
  (one per article you create below)

Leave `projectName`, `projectCode`, `projectStatus`, `objective`, and
`technicalContext` as seeded unless the brief plainly contradicts them.

### 2. Knowledge Articles

Create Knowledge Article cards in `Knowledge Articles/`. Always create at
least these two:

- **Brief Context** (`<slug>-brief-context`) — the full brief content and background, `articleType: "context"`
- **Agent Onboarding** (`<slug>-agent-onboarding`) — instructions for how to work on this project, `articleType: "onboarding"`

Add more articles as the brief warrants — for example, a detailed visual
design section could become its own article, or deep domain knowledge could
be split out for clarity. Keep each article cohesive with a clear guiding
principle.

Each article should have:

- `articleTitle` — a descriptive title (e.g., `"<brief title> — Brief Context"`, `"<brief title> — Data Model"`)
- `articleType` — one of `"context"`, `"onboarding"`, `"reference"`, `"decision"`
- `content` — the article body in markdown
- `tags` — relevant tags for skill resolution
- `updatedAt` — ISO timestamp

adoptsFrom: the darkfactory `KnowledgeArticle` type.

Link all articles from the Project card's `knowledgeBase` relationship, and
from the implementation issues' `relatedKnowledge` relationships.

### 3. Implementation Issues

Organize implementation issues around **entry-point cards** — the top-level
cards that users interact with directly and that should be discoverable in the
Boxel catalog. Create **one issue per entry-point card**. Use judgment based on
the brief to identify which cards are entry points vs interior/support cards.

Each issue should cover the full scope of its entry-point card:

- The card definition (`.gts`) and any interior/support cards it depends on
- HTML-first design artifacts under `design/` (mockup + screenshot + critique pass) — **NO `.test.gts` files**: this is the design-first loop; tests belong to a separate hardening phase. Never put tests in a description or acceptance criteria.
- A Catalog Spec (`Spec/<card-name>.json`) with realistic example instances linked via `linkedExamples`

Interior cards (field cards, helper cards, linked supporting cards) are
implemented as part of their entry-point card's issue — they do not need
their own catalog specs or separate issues.

**Dependency ordering:** If one entry-point card depends on another (e.g.,
card B uses card A as a field type or linked card), the depended-upon card's
issue must come first. Set `order` so that dependency cards are processed
before their consumers, and wire `blockedBy` so the consuming card's issue
cannot start until the dependency card's issue is done. (`blockedBy` means
"depends on the DONE-ness of" — normal sequencing, not blockage.)

**Scope each issue as an MVP pass — breadth and depth are budgets, not
defaults.** The coding agent does NOT know the big picture; if an issue
reads open-ended it will gold-plate every surface and burn hours doing a
full project's work. So plan two passes up front:

- **First-pass issues (the ones described above)**: the description MUST
  contain an explicit `**In scope (this pass)**` list — the minimal
  subset done WELL (e.g., "isolated view; fitted TILE ~200×180 only;
  3 core fields; happy path") — and a `**Deferred (second pass)**` list
  naming what is intentionally out (wide/strip fitted variants, edge
  states, secondary fields, bulk flows). Small and polished beats broad
  and rough.
- **Second-pass issues, created NOW**: for each card with meaningful
  deferred scope, also create `Issues/<slug>-<card-name-slug>-pass-2.json`
  — same format, `issueType` `"enhancement"`, priority `"low"`, `order`
  AFTER every first-pass issue, `blockedBy` its first-pass issue, and a
  description that IS the deferred list. These run only if the build
  moves forward; the operator can cancel them wholesale. Never fold
  second-pass scope into a first-pass issue.

**Build-plan Knowledge Article** — write
`Knowledge Articles/build-plan.json`: the big picture the coding agents
lack. Cover: the card-family map (what links to what and why), the pass
sequencing (which issues are first-pass MVPs, which are second-pass
polish, the dependency chains), and what "good enough" means per pass.
Wire it into EVERY issue's `relatedKnowledge` (next free index) so every
agent turn sees where its issue fits the whole. This document is
maintained: the reviewer updates it as the build's reality evolves.

**Issue format** — for each entry-point card, create an issue named after the card at `Issues/<slug>-<card-name-slug>.json` (e.g., `Issues/sticky-note.json` for a "Sticky Note" card):

- `issueId` — `"<projectCode>-<N>"` (sequential, dependency-first ordering)
- `summary` — `"Implement <card name> card"` (named after the entry-point card, e.g., "Implement Sticky Note card")
- `description` — describe the card to create, its fields, any interior/support cards, the design-first flow (mockup → critique → code), and what the catalog spec should contain. Do NOT ask for tests.
- `issueType` — `"feature"`
- `status` — `"backlog"`
- `priority` — `"high"` for the first, `"medium"` for subsequent
- `order` — sequential, respecting dependency order (cards with no dependencies first)
- `acceptanceCriteria` — checklist covering design artifacts, card definition (3 formats), spec with populated title/description, and examples. Validation gates are `run_lint`, `run_parse`, `run_evaluate`, `run_instantiate` — the v2 pipeline runs NO tests; never list `.test.gts` or `run_tests`.
- Relationships:
  - `project` → `../Projects/<slug>`
  - `relatedKnowledge.0` → `../Knowledge Articles/<slug>-brief-context`
  - `relatedKnowledge.1` → `../Knowledge Articles/<slug>-agent-onboarding`
  - `blockedBy.0` → `../Issues/design-foundation-seed` on EVERY
    implementation issue — the design-foundation issue (runs right after
    this bootstrap) establishes the brand guide, tokens, and family
    coherence sheet that all card designs consume; no card may design
    ahead of it
  - further `blockedBy.N` → issues for any entry-point cards this card
    depends on

adoptsFrom: the darkfactory `Issue` type.

If the brief describes only one card, create one issue. If it describes multiple
entry-point cards, create one issue per entry-point card ordered so that
dependency cards are implemented before cards that consume them.

## Instructions

**Step 0 (MANDATORY before any `Write`).** Fetch the live schema for
each card type you're about to write. Without this you will guess
field names and array shapes and produce cards that fail to render
with `Expected array for field value <X>` runtime errors:

```
get_card_schema({ module: "<darkfactoryModuleUrl from system prompt>", name: "Project" })
get_card_schema({ module: "<darkfactoryModuleUrl from system prompt>", name: "KnowledgeArticle" })
get_card_schema({ module: "<darkfactoryModuleUrl from system prompt>", name: "Issue" })
```

The returned `{ attributes, relationships? }` JSON Schema names every
field, its type (`string`, `number`, `boolean`, `array` for
`containsMany` / `linksToMany`, etc.), and any enum values
(`status`, `priority`, `articleType`, `projectStatus`, `issueType`).
Use those exact names, types, and enum values.

Then create the artifacts in order so relationship targets exist
when referenced:

1. The brief content is included verbatim in the issue description above. Do not fetch the URL — read the description.
2. `Read` the seeded Project card under `Projects/` (the orchestrator created it, along with the board under `Boards/` — never create either).
3. Call `Write` to create the **Knowledge Article cards** in `Knowledge Articles/` (at least brief context + agent onboarding).
4. Call `Write` to update the **Project card** in place: successCriteria, scope organization, and `knowledgeBase` links to the articles.
5. Identify entry-point cards from the brief — these are the top-level cards users interact with.
6. Call `Write` to create **one implementation Issue per entry-point card** at `Issues/<slug>-<card-name-slug>.json`, with all relationships wired.
7. Call **`signal_done`** (factory MCP tool) — the orchestrator manages issue status transitions. Do NOT set the issue status yourself.

**You must actually call the `Write` tool for each file. Calling
`signal_done` without writing the artifacts is a failure.**

Create artifacts in the order listed — Knowledge Articles before the
Project update, Issues last — so that relationship targets exist when
referenced.
