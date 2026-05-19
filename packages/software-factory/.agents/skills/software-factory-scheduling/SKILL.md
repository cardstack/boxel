---
name: software-factory-scheduling
description: Use when working a software factory run from inside an interactive Claude Code session — picking the next unblocked Issue from a target realm, transitioning its status through the lifecycle, and recording progress as the agent works through the issue backlog. Replaces the orchestrator's `issue-scheduler` + status-transition logic now that the agent drives the loop directly.
---

# Software Factory Scheduling

Use this skill whenever you need to **pick the next issue to work on**
in a software-factory target realm, or when you need to **transition
an issue's status** as you start, finish, or get stuck on it. This is
the loop control logic the orchestrator used to own; in the
interactive Claude Code flow the agent owns it.

## When you use this skill

The user pointed you at a target realm and asked you to work the
factory backlog. You are about to:

- Search the realm for `Issue` cards.
- Decide which one to pick up next.
- Set its status to `in_progress`, work it (per the
  `software-factory-bootstrap` or `software-factory-operations`
  skill, depending on `issueType`), then mark it `done` or `blocked`.
- Repeat until no eligible issues remain.

## First: verify `boxel` is installed

The user is expected to have `@cardstack/boxel-cli` installed
(see the runbook prerequisites). Verify it before any `boxel
<cmd>` invocation:

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

If verification fails, stop and report. Don't try to install
`boxel` yourself.

## Picking the next issue

1. **Search the target realm for every Issue card.** The Issue
   card-type is published by the source realm's `darkfactory`
   module. Construct the search query with the live tracker module
   URL (see "Discovering the tracker module URL" below):

   ```bash
   boxel search --realm <target-realm-url> --query '{
     "filter": {
       "type": { "module": "<tracker-module-url>", "name": "Issue" }
     }
   }' --json
   ```

2. **Filter to eligible issues.** An Issue is eligible if **all** of
   the following are true:
   - `attributes.status` is `"backlog"` **or** `"in_progress"`.
   - **Every** Issue listed in `relationships.blockedBy.*.links.self`
     has `attributes.status === "done"`. Resolve each `blockedBy`
     `links.self` against the parent issue's `id` (it's a relative
     path like `../Issues/foo`); the resulting URL matches the
     blocker's `id` from the search index.
   - You haven't already tried this issue and exhausted your turn
     budget on it in the current run.

3. **Order the eligible set** and take the first:
   - `in_progress` before `backlog` (resume semantics — finish what
     you started before starting something new).
   - Then by `attributes.priority`: `critical` > `high` > `medium`
     > `low`.
   - Then by `attributes.order` ascending (lower order first).

4. **If no Issue is eligible**, you're done. Tell the user, then:
   - If every Issue in the realm has `status === "done"`, set the
     **Project** card's `projectStatus` to `"completed"` and push
     the workspace.
   - Otherwise some Issues are stuck (blocked, or blocked-by-blocked).
     Report which ones and why.

## Status transitions you perform

The agent owns the full status lifecycle in this flow. There is no
orchestrator to flip statuses for you.

| Transition                | When                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backlog` → `in_progress` | The moment you pick the issue up, **before** doing any work on it.                                                                                                                                                                                                                                                                                                                                           |
| `in_progress` → `done`    | All required validators have passed AND the workspace has synced cleanly.                                                                                                                                                                                                                                                                                                                                    |
| `in_progress` → `blocked` | You cannot make progress: ambiguous brief, missing dependency, or you've hit one of the validator-loop bail-out limits documented in `software-factory-operations` ("Bailing out" section — 8 iterations per Issue, 3 identical consecutive validator failures, or 5 distinct fix attempts on the same validator without a pass). Always append a comment explaining which limit you hit and what you tried. |
| `blocked` → `backlog`     | The user (or a future you) decides to retry — out of this skill's scope.                                                                                                                                                                                                                                                                                                                                     |

**Always push the workspace after a status change.** The
status flip is local until `boxel realm push <local-dir>
<target-realm-url>` lands it on the realm. Running another search
before the push would read stale state.

**Never set `status` to a value not listed above** (e.g. `"running"`,
`"completed"`, custom strings). The Issue schema enforces an enum;
introspect it with
`boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default --realm <url> --input '{"codeRef": {"module": "<tracker-module-url>", "name": "Issue"}}'`
if you need the exact allowed values for the realm you're working
against.

## Updating an Issue card

Issue cards live at `Issues/<slug>.json` in the workspace (the local
mirror of the target realm).

**Read before write.** Always `Read` the file first, mutate only the
attributes you intend to change, then `Write` (or `Edit`) the merged
document back. Do not overwrite the entire file with just the
new fields — you'll silently drop the existing attributes (summary,
description, relationships, prior comments).

```jsonc
// Issues/sticky-note-define-card.json — after status flip
{
  "data": {
    "type": "card",
    "attributes": {
      "issueId": "SN-1",
      "summary": "Implement StickyNote card",
      "description": "…",   // <- DO NOT touch
      "status": "in_progress",
      "priority": "high",
      "order": 1,
      "updatedAt": "2026-05-15T10:42:00.000Z",
      "comments": [ ... existing comments preserved ... ]
    },
    "relationships": { ... preserved ... },
    "meta": { ... preserved ... }
  }
}
```

**`description` is immutable after creation.** Never modify an
Issue's `description`. To add context — blocked reasons, progress
notes, validation failures — append to `attributes.comments[]`
instead. The comment shape is documented in the
`software-factory-operations` skill.

## Discovering the tracker module URL

The orchestrator used to inject this URL into the agent's system
prompt. You now find it yourself:

- The tracker schema (Project / IssueTracker / Issue /
  KnowledgeArticle) is published at
  **`<target-realm-server-origin>/software-factory/darkfactory`**.
- Build it from the target realm URL: take the URL's origin, append
  `/software-factory/darkfactory`. Example:
  - target realm: `http://localhost:4201/alice/my-realm/`
  - origin: `http://localhost:4201`
  - tracker module URL: `http://localhost:4201/software-factory/darkfactory`
- Verify the URL is reachable by introspecting one of its exports
  before relying on it:
  ```bash
  boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
    --realm <target-realm-url> \
    --input '{"codeRef": {"module": "<tracker-module-url>", "name": "Issue"}}'
  ```
  If this returns a schema, you have the right URL. If it 404s or
  returns "module not found", check the source realm — the brief
  the user gave you is in a realm published from the same realm
  server, so the source realm is reachable at the same origin under
  `/software-factory/`.

Cache the tracker module URL for the rest of the run; it doesn't
change between issues.

## Building issue context

Before working an issue, load its surrounding context so you're not
operating blind:

1. **Project card** — follow the issue's `relationships.project.links.self`
   (relative to the issue's `id`). Read the resulting `.json` file
   from the workspace; pull `attributes.objective`,
   `attributes.successCriteria`, `attributes.technicalContext`, and
   any other guiding fields the schema returns.
2. **Knowledge articles** — follow each
   `relationships.relatedKnowledge.<n>.links.self` link the same way.
   Read each `Knowledge Articles/<slug>.json` and load its
   `attributes.content` / `attributes.body` (the schema names the
   field) into your working context.
3. **The issue itself** — `attributes.summary`,
   `attributes.description`, `attributes.acceptanceCriteria`, and
   the existing `attributes.comments[]` (which carry orchestrator
   /agent feedback from previous attempts, if any).

If a relationship link can't be resolved (workspace miss, 404), surface
that to the user — don't silently proceed with partial context.

## Common pitfalls

- **Forgetting to push between status flips.** If you flip
  `backlog → in_progress`, do your work, flip `in_progress → done`,
  and only push once at the end, an observer who searched the realm
  mid-flight would never see `in_progress`. Push immediately after
  the pickup flip too, so the realm reflects what you're working on.
- **Treating a stale search index as ground truth.** The realm's
  source POST returns once writes are durable, but the search index
  settles asynchronously. After a sync, the next search may briefly
  see the prior state. If a status you just wrote isn't reflected on
  the first search, wait a few hundred milliseconds and retry.
- **Picking a `done` or `blocked` issue.** Re-confirm the eligibility
  filter (`status ∈ {backlog, in_progress}` AND all blockers `done`)
  every cycle. Don't trust an in-memory list from a previous turn.
- **Working a blocked issue without addressing the blocker first.** A
  blocker that's `in_progress` or `blocked` isn't done. Skip the
  dependent issue until the blocker resolves.

## See also

- `software-factory-bootstrap` — what to do **inside** an Issue
  whose `issueType` is `bootstrap` (read the brief, create the
  Project / IssueTracker / Knowledge Articles / implementation
  Issues).
- `software-factory-operations` — what to do **inside** a regular
  implementation Issue (write `.gts` / `.test.gts` / instances /
  Spec, run validators, fix failures, sync).
