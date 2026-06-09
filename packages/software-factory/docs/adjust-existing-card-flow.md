# Adjust-existing-card flow — contract & brief schema

> Design note for the adjust-existing-card flow — the contract between the
> brief, the seed-from-source bootstrap step, and the adjustment issue loop.

## Goal

Extend the interactive factory so it can **adjust an existing card**
instead of only generating new ones. The brief points at a **source
card**; the factory creates a fresh target realm, seeds it with a
working copy of that card and its same-realm dependency graph,
confirms a green baseline, and then runs the _standard_ issue loop —
where the Issues describe **adjustments (deltas)** to the seeded card.

Adjust is a **superset** of greenfield, not a fork: the only
divergences are (1) one extra sub-phase inside bootstrap and (2) which
operations-skill flavor an Issue's `issueType` dispatches to.
Everything from the scheduler down is shared.

## Assumptions locked for this project

- **Same realm server as the source card.** The source card lives on
  the same realm server as the target realm, reachable with the active
  profile. No cross-server auth work.
- **2-input run contract, unchanged.** The two run inputs stay exactly
  as greenfield: a **brief URL** and a **new (target) realm URL**. The
  brief carries the source-card reference, so the runbook prompt barely
  changes.

---

## Decision 1 — Source-card reference on the brief

**Decision: a `sourceCardUrl` string field on the brief card.**

The brief is a `Wiki` card (`realm/wiki.gts`). Add one optional field:

```ts
// realm/wiki.gts
@field sourceCardUrl = contains(StringField);   // optional
```

The bootstrap step discovers the source card **mechanically**, with no
prose parsing, by reading a single attribute:

```jsonc
// the brief's JSON:API document
{
  "data": {
    "attributes": {
      "content": "…the adjustment instructions, as today…",
      "sourceCardUrl": "http://localhost:4201/realm/StickyNote/note-1",
    },
  },
}
```

**Branch signal:** `data.attributes.sourceCardUrl` present and non-empty
→ adjust flow. Absent or empty → greenfield. This is the single value
the bootstrap branch reads (see Decision 3).

### Why a string field, not a typed `linksTo`

- **Simplest mechanical read** — one attribute, no relationship-graph
  traversal, no new card type. Briefs stay plain `Wiki` cards and the
  runbook prompt is unchanged.
- **Keeps the 2-input contract trivially.** Nothing about the run
  inputs changes.

### The cost, and how we cover it

A string field has no referential integrity, no realm-index dependency
edge, and no host-UI navigation. We accept that because the adjust
flow fetches the URL at seed time anyway:

- **Validate at seed time, fail loud.** The bootstrap step must fetch
  the source card before seeding. A missing, malformed, or
  unreachable `sourceCardUrl` is a hard bootstrap failure with a clear
  message — not a silent greenfield fallback. (A typo'd URL must never
  be mistaken for "no source card.")
- **Assert same-server.** The URL's origin must match the target realm
  server's origin (the locked no-cross-server-auth assumption). The
  bootstrap step rejects a cross-origin `sourceCardUrl`.

---

## Decision 2 — The `adjustment` issue type

**Decision: add a new `issueType` value `adjustment`.**

`issueType` is an enum (`realm/kanban-config.gts` → `issueTypeOptions`,
currently `bootstrap, feature, bug, task, research, infrastructure`).
Add:

```ts
// realm/kanban-config.gts
export const issueTypeOptions: Option[] = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'feature', label: 'Feature' }, // greenfield implementation
  { value: 'adjustment', label: 'Adjustment' }, // adjust-flow delta  ← NEW
  // …bug, task, research, infrastructure…
];
```

The two implementation issue types are deliberately distinct:

| `issueType`  | Flow       | What it produces                              |
| ------------ | ---------- | --------------------------------------------- |
| `feature`    | greenfield | a card built from scratch (today's behavior)  |
| `adjustment` | adjust     | a **delta** applied to an already-seeded card |

### What an `adjustment` Issue carries

Same Issue schema (`realm/issue-tracker.gts` → `Issue`); the
difference is in how the fields are populated. An adjustment Issue's
`description` (immutable after creation, like any Issue) must name:

1. **Target file(s) to edit** — the workspace-relative paths of the
   seeded card and any support files the delta touches
   (`sticky-note.gts`, `sticky-note.test.gts`,
   `StickyNote/note-1.json`, `Spec/sticky-note.json`). These already
   exist in the workspace after seeding — the agent **edits**, it does
   not create from scratch.
2. **The delta** — what changes, concretely (add field X with type Y,
   change behavior Z, restyle the fitted view). Phrased as a diff
   against the seeded baseline, not as a full card spec.
3. **Acceptance** — `acceptanceCriteria` expressed as the new expected
   behavior and the test assertions that prove it, **plus** the
   standing requirement that the pre-existing baseline tests keep
   passing (the delta must not regress the green baseline).

Greenfield `feature` Issues are organized one-per-entry-point-card;
adjustment Issues are organized **one per coherent delta** the brief
describes against the source card.

---

## Decision 3 — Branch point and rejoin point

Adjust diverges from greenfield in exactly one place and rejoins in
exactly one place.

### Branch — inside the bootstrap Issue

The fork lives entirely inside the `bootstrap` Issue, in the
`software-factory-bootstrap` skill, after the brief is read:

```
read brief
  │
  ├─ sourceCardUrl absent  ──▶  GREENFIELD (today, unchanged)
  │                              create Project, IssueTracker,
  │                              Knowledge Articles, and one
  │                              `feature` Issue per entry-point card
  │
  └─ sourceCardUrl present ──▶  ADJUST (new sub-phase)
                                 1. seed the target realm with a
                                    working copy of the source card +
                                    its same-realm dependency graph
                                    (modules, sample instances,
                                    Catalog Spec, co-located tests)
                                 2. confirm a GREEN BASELINE: run the
                                    standard validators on the seeded
                                    card; they must all pass before any
                                    adjustment Issue is created
                                 3. write a baseline Knowledge Article
                                    capturing source provenance (where
                                    the copy came from)
                                 4. create Project, IssueTracker,
                                    Knowledge Articles, and one
                                    `adjustment` Issue per delta
```

The seed + green-baseline sub-phase has **no greenfield analog**, but
it happens entirely _within_ the bootstrap Issue, before the standard
loop begins. The standard loop itself is untouched.

### Rejoin — at the scheduler

Once bootstrap has written its implementation Issues (`feature` **or**
`adjustment`), control returns to the shared loop and never forks
again:

```
software-factory-scheduling   pick next eligible Issue (status,
                              blockedBy, priority, order) — IDENTICAL
        │                     for feature and adjustment Issues
        ▼
software-factory-operations   dispatch on issueType:
        │                       feature    → greenfield operations
        │                       adjustment → adjustment operations:
        │                                    edit existing files,
        │                                    preserve the baseline
        ▼
the five validators           lint, parse, evaluate, instantiate,
                              test — IDENTICAL, same Validations/
                              artifact cards, same bail-out limits
        ▼
status → done / blocked       IDENTICAL lifecycle, same project
                              completion rule
```

What is **shared, untouched** between the two flows:

- Issue eligibility, ordering, and the full status lifecycle
  (`software-factory-scheduling`).
- The five validators and the `Validations/<type>_<slug>-<n>.json`
  audit-trail cards, the iteration semantics, and the bail-out limits
  (`software-factory-operations`).
- Project completion (`projectStatus: completed` only when every Issue
  is `done`).

What is **new or flavored** for adjust:

- The seed + green-baseline + provenance sub-phase inside bootstrap.
- An adjustment-flavored bootstrap that emits `adjustment` Issues.
- An adjustment-flavored operations skill that **edits** seeded files
  and guards the baseline instead of creating cards from scratch.

This is the precise sense in which adjust is a **superset**: the only
new control flow is one bootstrap sub-phase and one `issueType`-keyed
dispatch; everything downstream is the existing loop.
