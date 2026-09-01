# Issue tracker: Linear when a ticket exists, local markdown otherwise

## Routing rule

- If the work at hand has a Linear ticket (a CS-xxxxx id was given, or the
  branch/PR names one), that ticket is the issue of record: read the spec from
  it and write updates, findings, and new sub-issues to Linear.
- If no Linear ticket was given, track the work as local markdown under
  `.scratch/<feature-slug>/` (conventions below). Do NOT create Linear issues
  on your own initiative.
- Promotion is user-triggered only: when the user says "promote this to
  Linear", create the Linear issue(s) from the `.scratch/` files, link back,
  and note in each file that it moved.

## Local markdown conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a
  single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a
  `## Comments` heading
- `.scratch/` is gitignored — these files never land in the public repo

## When a skill says "publish to the issue tracker"

If a Linear ticket is in context, publish there. Otherwise create a new file
under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

A CS-xxxxx id → fetch from Linear. A path → read the file at the referenced
path. The user will normally pass one or the other directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from
  `01`, with the question in the body. A `Type:` line records the ticket type
  (`research`/`prototype`/`grilling`/`task`); a `Status:` line records
  `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is
  unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open,
  unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set
  `Status: resolved`, then append a context pointer (gist + link) to the map's
  Decisions-so-far in `map.md`.

## PRs as a request surface

Off. External PRs are not part of the issue queue.
