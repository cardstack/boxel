---
name: distill-learnings
description: Consolidate accumulated learnings from the workspace's learnings scratchpad — workspace-specific ones into workspace docs, generally-useful ones into a boxel-skills checkout as a PR — then archive consumed entries.
boxel:
  kind: skill
---

# /distill-learnings

## Use When

- The workspace's learnings scratchpad (e.g. `.claude/learnings/`) has accumulated a handful of entries and the user wants to consolidate.
- About to share the workspace with someone new and want the scratchpad cleaned up.
- A learning has been validated through repeated use and should graduate into durable documentation.

## Two destinations

The official skills are read-only in a workspace — they arrive via the boxel-cli plugin and are edited only in the [cardstack/boxel-skills](https://github.com/cardstack/boxel-skills) repository. A distilled learning therefore lands in one of two places:

| Destination | When | How |
|---|---|---|
| **Workspace docs** (extension READMEs, workspace `CLAUDE.md`/`AGENTS.md`, learnings kept as-is) | The learning names this workspace's specific realms, libraries, bundles, or conventions | Edit the workspace file directly |
| **Upstream: cardstack/boxel-skills** | The learning is general Boxel knowledge every user should get | Apply the edit in a local boxel-skills checkout and raise a PR — never edit installed-plugin files |

For the upstream path, ask the user where their boxel-skills checkout is if it isn't discoverable (a `boxel-skills/` directory in the workspace root is the common layout). Before writing into it, check its branch and dirty state — don't clobber in-flight work; create a branch for the distillation.

## Procedure

### 1. Inventory the scratchpad

```bash
ls .claude/learnings/ | grep -vE '^_distilled$|^README\.md$'
```

Read EVERY file in the scratchpad (except `README.md` and the `_distilled/` archive). For each one, read in full — these are short by design.

### 2. Classify each learning

For each scratchpad entry, decide which bucket it belongs in. Be ruthless — most learnings either graduate or should be discarded.

| Bucket | Action |
|---|---|
| Workspace-specific URL / convention / quirk | Distill into the matching workspace doc (extension README, workspace entry doc) |
| General Boxel pattern, gotcha, or rule not already covered upstream | Distill into the relevant file in a boxel-skills checkout, for a PR |
| Already covered by existing official-skill content | Discard — the learning is redundant |
| Personal preference (cross-project) | Move to auto memory instead — not workspace-scoped |
| Out-of-date or wrong | Discard |

When in doubt, ask the user before acting on it. Don't silently discard.

### 3. Locate the upstream home for general learnings

Each general learning has a natural home in boxel-skills:

| Learning shape | Likely home in boxel-skills |
|---|---|
| Query / filter / sort gotcha | `skills/boxel/references/query-systems.md` or `skills/boxel/SKILL.md` cardinal rules |
| Template-rendering gotcha (chrome, delegated render, format choice) | `skills/boxel-ui-guidelines/references/` |
| New cardinal rule every CardDef needs | `skills/boxel/SKILL.md` cardinal rules + `index.md` cross-link |
| Workflow/process (cli surface, push escape hatch) | `skills/boxel-environment/` or `skills/boxel/references/lint-workflow.md` |
| Working pattern worth cataloguing | `skills/boxel-patterns/` |

Read the candidate destination before drafting — you need to know what's already there to match tone and avoid duplication. For upstream edits, generalize first: strip private realm URLs, machine paths, and workspace-only assumptions. When a distillation introduces or renames a term, concept, library, helper, host command, pattern, slash command, convention, or acronym, also update `skills/glossary.md` in the checkout.

### 4. Draft the edits

For each learning, draft the concrete edit — the exact text to add to the target file, in the same tone as the existing content there. Use proper diff blocks; don't summarize vaguely. New file proposals include the path + initial body + which SKILL.md needs to reference it.

### 5. Show the user and get approval

Print a summary in this shape:

```
Reviewed N scratchpad learnings:
  - {n_workspace} → workspace docs (proposed below, grouped by target file)
  - {n_upstream}  → boxel-skills checkout (proposed below, grouped by target file)
  - {n_discard}   → discard (reasons listed)
  - {n_ask}       → need your input
```

Wait for the user to confirm before applying any edits.

### 6. Apply approved changes

- Workspace-destined edits: apply directly.
- Upstream-destined edits: apply in the boxel-skills checkout on a branch; stop with the diff ready for the user's commit/PR flow unless they explicitly ask you to commit and open the PR.
- Move every distilled or discarded file to `.claude/learnings/_distilled/<YYYY-MM-DD>/`, preserving the original filename so the audit trail reads cleanly.
- Leave any "needs user input" files in place.

### 7. Report

Brief summary of what landed where (workspace files edited; boxel-skills branch + files staged for PR), what was discarded with reasons, what's still pending. Don't auto-commit — let the user decide when.

## Done criteria

- [ ] Every scratchpad file (except README + `_distilled/`) has been read and classified.
- [ ] Workspace-specific content landed in workspace docs; general content landed in a boxel-skills checkout on a branch — never in installed-plugin files.
- [ ] `skills/glossary.md` updated in the checkout when terms were introduced or renamed.
- [ ] Consumed files moved to `_distilled/<date>/` (no silent deletes).
- [ ] Anything that needs user input has been surfaced — not silently dropped.
- [ ] User has approved all edits before they were written.

## Failure recovery

- Learning is ambiguous → ask the user before discarding. Better to leave it in the scratchpad than lose it.
- No obvious home → for general content, propose a new reference or pattern in the checkout; for workspace content, a new extension README. Don't shoehorn a learning into the wrong existing section.
- No boxel-skills checkout available → ask the user whether to clone one; don't fall back to editing plugin files.
- Too many learnings to distill in one pass → distill a coherent subset, leave the rest for the next pass.
- Risk of touching load-bearing upstream files (cardinal rules, design-playbook, query-systems) → pause for explicit user direction before editing those high-impact files.
