---
name: distill-learnings
description: Consolidate accumulated learnings from .claude/learnings/ into the right skill tree files, then archive consumed entries.
boxel:
  kind: skill
---

# /distill-learnings

## Use When

- `.claude/learnings/` has accumulated a handful of entries and the user wants to consolidate.
- About to share the workspace with someone new and want the scratchpad cleaned up.
- A learning has been validated through repeated use and should graduate into the skill tree.

> **Sibling command**: for upstream sync (folding a `cardstack/boxel-skills` PR into our skill tree with the realm-GTS adaptations), use [`/distill-from-boxel-skills`](./distill-from-boxel-skills.md) instead. That command's input is an upstream PR or commit; this command's input is the local `.claude/learnings/` scratchpad. Both write into the same skill tree under `skills/`.

## Procedure

### 1. Inventory the scratchpad

```bash
ls .claude/learnings/ | grep -vE '^_distilled$|^README\.md$'
```

Read EVERY file in `.claude/learnings/` (except `README.md` and the `_distilled/` archive). For each one, read in full — these are short by design.

### 2. Read the relevant skill tree slice

Each learning has a natural home in the skill tree. Before drafting, identify which file each learning would update:

| Learning shape                                                      | Likely skill-tree home                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Realm URL / canonical library URL / common-libs convention          | A `library-*` pattern README, or `boxel-patterns/references/libraries.md`              |
| Query / filter / sort gotcha                                        | `boxel/references/query-systems.md` or `boxel/SKILL.md` cardinal rules                 |
| Template-rendering gotcha (chrome, delegated render, format choice) | `boxel-ui-guidelines/references/delegated-render-control.md` or `template-patterns.md` |
| New cardinal rule that every CardDef needs                          | `boxel/SKILL.md` cardinal rules table + cross-link from `CLAUDE.md`/`AGENTS.md`        |
| Realm convention (slug format, instance naming)                     | A pattern README, or the relevant command file's Done Criteria                         |
| Workflow/process (cli surface, push escape hatch)                   | `boxel-environment/` or `boxel/references/lint-workflow.md`                            |

Read the candidate destination(s) before proposing edits — you need to know what's already there to match tone and avoid duplication.

### 3. Classify each learning

For each scratchpad entry, decide which bucket it belongs in. Be ruthless — most learnings either go into the skill tree or should be discarded.

| Bucket                                                                      | Action                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Workspace-specific URL / convention / quirk that fits an existing skill ref | Distill into that file                                                  |
| General Boxel pattern not already in the skill tree                         | Distill into the relevant skill ref (or propose a new pattern dir)      |
| Cardinal rule worth elevating                                               | Distill into `boxel/SKILL.md` + cross-link from `CLAUDE.md`/`AGENTS.md` |
| Already covered by existing skill tree content                              | Discard — the learning is redundant                                     |
| Personal preference (cross-project)                                         | Move to auto memory instead — not workspace-scoped                      |
| Out-of-date or wrong                                                        | Discard                                                                 |

When in doubt, ask the user before acting on it. Don't silently discard.

### 4. Draft the skill-tree edits

For each learning, draft the concrete edit — the exact text to add to the target file, in the same tone as the existing content there. Use proper diff blocks; don't summarize vaguely.

If a learning needs a new section in an existing file, propose the section heading + initial content.

If a learning needs a new file in the skill tree, propose the path + initial body + which SKILL.md / parent SKILL needs to reference it.

When a distillation introduces a new term, concept, library, helper, host command, pattern, slash command, convention, or acronym — OR renames an existing one — **also update [`skills/glossary.md`](../skills/glossary.md)** so the glossary stays current. New patterns get a one-line entry in the matching outcome group under §25; new conventions go under §24; new host commands under §18; etc.

### 5. Show the user and get approval

Print a summary in this shape:

```
Reviewed N scratchpad learnings:
  - {n_distill}  → skill tree (proposed below, grouped by target file)
  - {n_discard}  → discard (reasons listed)
  - {n_ask}      → need your input

Proposed skill-tree edits:
  [show the actual diff blocks per file]

Discards (reason listed for each):
  - {file}: {reason}

Asks:
  - {file}: {what you need to know}
```

Wait for the user to confirm before applying any edits.

### 6. Apply approved changes

- Edit the target skill files with the approved additions/updates.
- Add cross-link lines to `CLAUDE.md` / `AGENTS.md` if a cardinal rule was elevated.
- Move every distilled or discarded file to `.claude/learnings/_distilled/<YYYY-MM-DD>/`. Preserve the original filename so the audit trail reads cleanly.
- Leave any "needs user input" files in place.

```bash
DATE=$(date +%Y-%m-%d)
mkdir -p .claude/learnings/_distilled/$DATE
# Move each distilled or discarded file:
# git mv .claude/learnings/<file> .claude/learnings/_distilled/$DATE/<file>
```

### 7. Report

Brief summary of what landed where, what was discarded with reasons, what's still pending. Don't auto-commit — let the user decide when.

## Done criteria

- [ ] Every file in `.claude/learnings/` (except README + `_distilled/`) has been read and classified.
- [ ] Distilled content landed in the right skill-tree file, matching the tone of existing entries.
- [ ] Cardinal-doc cross-links (`CLAUDE.md`/`AGENTS.md`) were updated when a rule was elevated.
- [ ] Consumed files moved to `_distilled/<date>/` (no silent deletes).
- [ ] Anything that needs user input has been surfaced — not silently dropped.
- [ ] User has approved all edits before they were written.

## Failure recovery

- Learning is ambiguous → ask the user before discarding. Better to leave it in the scratchpad than lose it.
- No obvious skill-tree home → propose a new pattern dir or skill ref. Don't shoehorn a learning into the wrong existing section.
- Too many learnings to distill in one pass → distill a coherent subset (e.g. all query-related learnings into `query-systems.md`), leave the rest for the next pass.
- Risk of touching the skill tree in a load-bearing way (cardinal rules, design-playbook, query-systems) → pause for explicit user direction before editing those high-impact files.
