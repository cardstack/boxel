---
name: distill-from-boxel-skills
description: Backport an improvement (or a batch of improvements) from the upstream cardstack/boxel-skills repo into this workspace's skill tree. Use when a recent PR or commit upstream documents a gotcha, pattern, or rule we should mirror locally.
boxel:
  kind: skill
---

# /distill-from-boxel-skills

## Why this exists

The Boxel AI Assistant (the in-app card-side AI) loads skills from the **`cardstack/boxel-skills`** GitHub repo at https://github.com/cardstack/boxel-skills. Each upstream `Skill/<name>.md` becomes a skill the assistant can mount when answering Boxel-card questions.

This workspace's skill tree under `skills/` is a parallel, **locally-tracked** descendant of that material — adapted for the local-development side of the same product: Claude Code, Cursor, Aider, etc. operating on `.gts` files in a workspace, rather than the host's AI Assistant operating inside the live app.

The two trees share most of their content (CardDef syntax, query traps, theme rules, design playbook) and diverge in a few well-defined places (template-helper imports that work in the host but not in realm GTS, host-internal command surfaces, etc.). When upstream lands a substantive improvement — a new gotcha, a clearer rule, a heuristic catalogue — the same insight usually belongs here too. This command is the playbook for getting it in.

## Use When

- A user references a specific upstream PR or commit (e.g. "incorporate cardstack/boxel-skills#74").
- A "what's new in boxel-skills since last sync" check finds substantive changes worth mirroring.
- A user notices the in-app AI Assistant gives advice this skill tree doesn't.
- A new skill file appears upstream that doesn't have a local counterpart yet.

## Inputs

- Either a PR/commit URL (preferred — narrowest scope) or the boxel-skills branch + a date range to scan.
- The user's intent: backport a single change, OR run a "what's new since X" sweep.

## Read

1. The actual diff from the PR/commit (via `gh pr view` if authenticated, otherwise `https://patch-diff.githubusercontent.com/raw/cardstack/boxel-skills/pull/<N>.diff`).
2. The destination file(s) in our skill tree per the mapping below.
3. If the change touches a pattern we already maintain (e.g. `query-systems`, `delegated-rendering`), the existing version, to compare tone + avoid duplication.
4. `skills/glossary.md` — the running index of terms.

## File-to-file mapping

The naming convention is consistent enough that most files map mechanically:

| Upstream `Skill/<name>.md` | Local home |
|---|---|
| `dev-core-concept.md` | `skills/boxel/references/core-concept.md` |
| `dev-core-patterns.md` | `skills/boxel/references/core-patterns.md` |
| `dev-quick-reference.md` | `skills/boxel/references/quick-reference.md` |
| `dev-technical-rules.md` | `skills/boxel/references/technical-rules.md` (+ cardinal rules in `skills/boxel/SKILL.md`) |
| `dev-file-def.md` | `skills/boxel-file-def/SKILL.md` |
| `dev-file-editing.md` | `skills/boxel/references/file-editing.md` (or `skills/source-code-editing/SKILL.md`) |
| `dev-markdown-format.md` | `skills/boxel-markdown-format/SKILL.md` |
| `dev-fitted-formats.md` | `skills/boxel/references/fitted-formats.md` (+ `container-query-fitted-layout.md`) |
| `dev-bfm-syntax.md` | `skills/boxel-flavored-markdown/SKILL.md` |
| `dev-command-development.md` | `skills/boxel/references/command-development.md` |
| `dev-data-management.md` | `skills/boxel/references/data-management.md` |
| `dev-defensive-programming.md` | `skills/boxel/references/defensive-programming.md` |
| `dev-delegated-rendering.md` | `skills/boxel/references/delegated-rendering.md` (+ `skills/boxel-ui-guidelines/references/delegated-render-control.md`) |
| `dev-enumerations.md` | `skills/boxel/references/enumerations.md` |
| `dev-external-libraries.md` | `skills/boxel/references/external-libraries.md` |
| `dev-query-systems.md` | `skills/boxel/references/query-systems.md` |
| `dev-spec-usage.md` | `skills/boxel/references/spec-usage.md` |
| `dev-styling-design.md` | `skills/boxel/references/styling-design.md` (+ `skills/boxel-design/SKILL.md`) |
| `dev-template-patterns.md` | `skills/boxel-ui-guidelines/references/template-patterns.md` (note: NOT `skills/boxel/references/template-syntax.md` — those are disambiguated; see Naming conventions in `skills/boxel-patterns/SKILL.md`) |
| `boxel-design.md` | `skills/boxel-design/SKILL.md` |
| `boxel-ui-guidelines.md` | `skills/boxel-ui-guidelines/SKILL.md` |
| `boxel-design-system.md` | `skills/boxel-design/references/theme-design-system.md` (+ `skills/boxel-theme-development/SKILL.md`) |
| `env-assistant-persona.md` | `skills/boxel-environment/references/assistant-persona.md` |
| `env-calling-commands.md` | `skills/boxel-environment/references/calling-commands.md` |
| `env-choosing-llm-models.md` | `skills/boxel-environment/references/choosing-llm-models.md` |
| `env-creating-and-editing-cards.md` | `skills/boxel-create-edit-cards/SKILL.md` |
| `env-indexing-operations.md` | `skills/boxel-environment/references/indexing-operations.md` |
| `env-markdown-edit.md` | `skills/boxel-environment/references/markdown-edit.md` |
| `env-searching-and-querying.md` | `skills/boxel-environment/references/searching-and-querying.md` |
| `env-sim-boxel-environment-guide.md` | `skills/boxel-environment/SKILL.md` |
| `env-user-environment-awareness.md` | `skills/boxel-environment/references/user-environment-awareness.md` |
| `env-workflows-and-orchestration-patterns.md` | `skills/boxel-environment/references/workflows-and-orchestration.md` |
| `source-code-editing.md` | `skills/source-code-editing/SKILL.md` |
| `catalog-listing.md` | `skills/catalog-listing/SKILL.md` |

When a file has no clear local counterpart, propose a new path — usually under the closest existing skill — rather than creating a fresh top-level skill.

## The two-tree divergence — adaptations required

Upstream targets the **in-host AI Assistant**, which runs as a card inside the live Boxel app. Our tree targets **local-dev agents** writing `.gts` files in a workspace. The realities differ in a few specific places. When an upstream snippet contains any of these, **adapt** rather than copy:

| Upstream (host context) | Local adaptation (realm GTS) |
|---|---|
| `import perform from 'ember-concurrency/helpers/perform';` + `(perform this.fooTask)` in templates | `startFoo = () => this.fooTask.perform();` + `{{on 'click' this.startFoo}}`. The `perform` helper subpath isn't fetchable in realms. See `skills/boxel/references/common-imports.md`. |
| Referring to "the assistant" / "the user types" workflow language | Tone for an autonomous coding agent reading skill content offline; reduce the conversational framing. |
| Host commands invoked as JSON `{name: "foo_xxxx", payload: {...}}` (in-app tool-call form) | Either the same JSON shape (when our reader is operating the live app via `/boxel-debug-runtime`) OR `npx boxel run-command @cardstack/boxel-host/tools/<name>/default --input '{...}'` (CLI invocation). Keep both forms if both are useful. |
| References to features we don't have here (in-app chat history, room state, attached-cards-from-room) | Drop or note "in-host only". |
| Realm URLs hard-coded to staging.boxel / app.boxel | Replace with placeholders (`<realm-url>`) per the "Public-repo path hygiene" rule in `CLAUDE.md`. |

**The substance of the upstream change usually transfers cleanly; only the prescribed invocation form changes.** PR #74 (ember-concurrency cancellation pitfall, May 2026) is the canonical example: the WRONG pattern (awaiting `.perform()` outside a task) is identical in both worlds, but the FIX in upstream uses `(perform ...)` while our adaptation uses the scoped-handler form.

## Procedure

### 1. Read the upstream change in full

For a single PR:

```sh
# Authenticated (preferred — get title + author + body + file list)
gh pr view <N> --repo cardstack/boxel-skills --json title,body,files,additions,deletions,state,url

# Or fetch the diff directly
curl -sL https://patch-diff.githubusercontent.com/raw/cardstack/boxel-skills/pull/<N>.diff
```

For a sweep of recent activity:

```sh
gh pr list --repo cardstack/boxel-skills --state merged --search "merged:>$LAST_SYNC_DATE" --json number,title,mergedAt,files
```

### 2. Classify each touched file

For each upstream file the PR modifies:

| The upstream change is… | What to do |
|---|---|
| A new section / heading with a discrete topic | Distill into the mapped local file as a new section, matching local tone. |
| A clarification to an existing rule | Locate the corresponding paragraph in our file. Update in place; preserve the surrounding context. |
| A new cardinal-rule-level prohibition | Add to `skills/boxel/SKILL.md` cardinal rules table + cross-link from `CLAUDE.md` Conventions. |
| A new heuristic checklist | Mirror it in the local file. Heuristics travel well. |
| An import path or template helper the host supports but realms don't | Apply the adaptation table above. |
| A workflow that only makes sense inside the AI assistant (chat history, attached cards) | Discard, with a note in the audit summary. |
| Already covered by our content (we may have phrased it differently or fixed it earlier) | Discard, but note in the summary so the user can confirm we're not silently dropping a refinement. |

### 3. Draft the local edits

For each in-scope upstream change, draft the concrete edit — the exact text to add to the target file, in the same tone as the existing content there. Use proper diff blocks; don't summarize vaguely.

If a single upstream PR touches multiple of our destination files (typical when both `dev-quick-reference.md` and a deeper reference change together — the cheatsheet line plus the deep-dive section), draft them as a unit so the cross-references stay consistent.

When the local destination already has a section on the same topic, prefer **strengthening that section** to inserting a parallel new one. Diffing the existing prose against the upstream text usually reveals which is sharper; pick the better of the two and merge nuances from the other.

### 4. Update the glossary if needed

If the upstream change introduces a new term, helper, pattern, slug, or convention — OR adds a new cardinal rule — also update `skills/glossary.md` per its maintenance contract. The glossary's job is to stay findable as the back-of-book index.

### 5. Show the user and get approval

Match the shape of `/distill-learnings`:

```
Backporting cardstack/boxel-skills PR #<N> ("<title>"):

  - {n_distill} upstream additions → distilled into our skill tree (proposed below)
  - {n_adapted} upstream items adapted (host → realm-GTS form)
  - {n_discard} upstream items not applicable here (reasons listed)
  - {n_ask}   need your input

Proposed edits:
  [diff blocks per file]

Discards / adaptations:
  - {upstream-path}: {reason — "host-only", "different invocation form", "we say it differently in skills/X.md"}
```

Wait for the user to confirm before applying. Don't auto-commit.

### 6. Apply approved changes

Edit the destination files. Don't move the upstream PR into our `_distilled/` — it's not in our scratchpad; it's an external artifact. Instead, record the backport in a sibling tracking file:

```
.claude/learnings/_distilled/boxel-skills-backports.md
```

with one line per PR: `cardstack/boxel-skills#<N> — <one-line description> — landed in <our-path>` plus the local commit hash if available. This is the audit trail across sessions so we can do "what have we backported" sweeps.

### 7. Report

Brief summary in the same shape as `/distill-learnings`: what landed where, what was adapted (with one-line reason), what was discarded (with reason). Don't auto-commit — let the user decide.

## Done criteria

- [ ] Every file the upstream PR touches has been classified (distill / adapt / discard).
- [ ] Each distilled change lands in the mapped local file, with realm-GTS adaptations applied where needed.
- [ ] If the change introduces a new term or rule, the glossary is updated.
- [ ] `.claude/learnings/_distilled/boxel-skills-backports.md` has a one-line record of the backport.
- [ ] Discarded / adapted items are surfaced with reason — not silently dropped.
- [ ] User approved the edits before they were written.

## Failure recovery

- **Upstream diff is ambiguous about scope.** Ask the user whether to backport a small adjacent change or just the headline one.
- **A new upstream file has no local counterpart.** Propose a new path under the closest existing skill (don't create a fresh top-level skill without user buy-in). If multiple upstream files cluster under one new topic, propose a new sub-folder; otherwise widen an existing reference.
- **Upstream contradicts a local cardinal rule.** Stop. Surface the contradiction, show both texts to the user, and let them decide. (Example: upstream telling realm cards to use `(perform ...)` directly contradicts our `common-imports.md` rule — the right move is to adapt the FIX, not to flip our cardinal rule.)
- **You can't reach the upstream URL** (rate-limited, redirected, private). Try the raw diff at `patch-diff.githubusercontent.com/raw/cardstack/boxel-skills/pull/<N>.diff`. If still blocked, ask the user to paste the diff content directly.

## Tip: scanning for "what's new"

When the user asks for a sweep rather than a single PR, use the merged-since-date filter:

```sh
gh pr list --repo cardstack/boxel-skills --state merged \
  --search "merged:>$(date -v-30d +%Y-%m-%d)" \
  --json number,title,mergedAt,files \
  --limit 50
```

Then classify in batches (e.g. all `dev-quick-reference.md` PRs together) — many small upstream PRs often map to a single local section, and merging them in one edit reads better than five sequential nudges.
