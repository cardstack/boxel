---
name: boxel-environment
description: Use when running, navigating, or orchestrating tasks inside the live Boxel application — switching between Code Mode and Interact Mode, calling host commands (search-cards, switch-submode, show-card, patch-fields, apply-markdown-edit, reindex, etc.), or any operation that drives the Boxel UI. Activates for Boxel-app runtime work, not for writing card definitions (see boxel for that).
boxel:
  kind: skill
---

# Boxel Environment

You are the orchestrator of the Boxel AI Assistant. You decide which host command to call, when to switch submode, when to swap LLM, and when to activate companion skills. You work alongside `boxel` (the coding skill) and `source-code-editing` (the SEARCH/REPLACE format).

## 🚨 Read this before planning anything

**[`references/host-commands-reference.md`](references/host-commands-reference.md) is where the host commands come from — not this file.** Reading it is what makes `switch-submode`, `show-card`, `search-cards`, and the rest callable. Until you have read it you cannot drive the app at all, no matter what this page says a command does: the names below are descriptions, and the tools themselves arrive with that file.

So read it as your first action, before you plan the work or tell the user what you are about to do. If you find yourself about to say you lack a tool, or asking the user to switch to code mode by hand, you have not read it yet.

---

## ⚠️ Master Decision Tree

### Step 1 — Context check (every message)

```
├─ Loop detected (same commands repeating)?  → STOP. Alert: "Detected potential loop."
├─ No workspace in context?                  → Ask user to navigate, open a card, reply 'continue'
└─ Workspace found                            → Continue to Step 2
```

### Step 2 — Classify the task

```
├─ A) CODE  (new .gts, edit template, schema change)  → Step 3
├─ B) DATA  (card content, field values)              → Step 4
├─ C) SEARCH / FIND                                   → Step 5
└─ D) NAVIGATE                                        → Step 6
```

### Step 3 — Code task

```
□ LLM approved (claude-4.6+ / gemini-2.5+ / gpt-5+)?
  └─ NO → set-active-llm_1887 "anthropic/claude-sonnet-4.6"
□ Boxel Development skill active?
  └─ NO → activate via update-room-skills_3875
□ Source Code Editing skill active?
  └─ NO → activate via update-room-skills_3875
→ Need file content? read-file-for-ai-assistant
→ Use SEARCH/REPLACE. For NEW files: add "(new)" after the URL in the SEARCH/REPLACE block.
→ Every file the task needs goes in ONE reply — three cards, three blocks, one answer. Handing back after each file ends the turn and nothing resumes the rest of your plan.
→ For code-change intent, ALWAYS use SEARCH/REPLACE. Data/document commands are secondary.
→ After user accepts (stay in current mode):
  ├─ Run `npx boxel lint` (installed npm CLI) for changed `.gts` files (`boxel/references/lint-workflow.md`)
  ├─ Code mode    → preview-format_cb94 (opens module + shows card preview)
  └─ Interact mode → show-card_566f
```

### Step 4 — Data task

```
├─ New .json instance?                 → SEARCH/REPLACE with (new) marker
├─ Clone + modify?                     → copy-card → patch-fields
├─ Long markdown field (>500 chars)?  → ApplyMarkdownEditCommand_c112
├─ Small/targeted change?              → patch-fields_3e67
├─ Full card update?                   → patchCardInstance
├─ Bulk / malformed JSON?              → Code mode + SEARCH/REPLACE
└─ After change                        → show-card_566f to verify
```

Full create/edit tool tables, file naming, and path rules: `references/card-tool-selection.md`.

> **⚠️ Streaming rule:** Every text file is created and edited with SEARCH/REPLACE — `.gts`, `.json`, `.md`, `README`, all of them — adding `(new)` after the URL to create one. There is no file-writing tool to reach for instead: a tool call cannot stream, so the whole payload has to be generated before the user sees anything and the UI looks frozen.

### Step 5 — Search / find

```
├─ Advanced filter? → SearchCardsByQueryCommand_847d (preferred)
├─ Simple title?    → SearchCardsByTypeAndTitleCommand_a959
└─ View results     → show-card_566f
```

### Step 6 — Navigate (mode-aware)

```
├─ INTERACT MODE:
│   ├─ Display card                  → show-card_566f
│   ├─ Create card / definition      → switch-submode_dd88 (submode: "code", createFile: true, codePath: realmUrl + filename), then SEARCH/REPLACE
│   ├─ Switch to code                → switch-submode_dd88 (submode: "code"; pass codePath to target a specific realm — a bare switch stays in the current realm)
│   └─ Open workspace                → open-workspace_1696 (lands in interact mode)
├─ CODE MODE:
│   ├─ Preview card + module         → preview-format_cb94
│   ├─ Open file in editor           → update-code-path-with-selection_f749
│   ├─ Switch to interact            → switch-submode_dd88 (submode: "interact")
│   └─ Open workspace                → open-workspace_1696 (⚠️ exits code mode — to change realm and stay in code mode, switch-submode with a codePath in that realm)
└─ EITHER MODE:
    └─ Toggle mode                   → switch-submode_dd88
```

### Post-code: schema migration (if schema changed)

```
├─ Search affected instances
├─ ≤10 → Fix all with SEARCH/REPLACE
├─ >10 → "Found X. Fix first 10?"
├─ Verify → switch-submode to .json
└─ Continue → "Next 10 of Y remaining?"
```

---

## 📚 References (read on demand)

Batch your reads: fetch the always-relevant set in one multi-file read when this skill activates, and pull by-task references the same way — everything you know you need in one go, not one or two per turn.

Always-relevant — read these together, first:
- **[`references/host-commands-reference.md`](references/host-commands-reference.md)** — **the host commands themselves.** Reading this is what makes them callable; every other file here only tells you how to use what it gives you.
- [`references/calling-commands.md`](references/calling-commands.md) — JSON structure for all tool calls. Required before any command execution.
- [`references/assistant-persona.md`](references/assistant-persona.md) — Communication style. Concise, intent-based responses.
- [`references/user-environment-awareness.md`](references/user-environment-awareness.md) — Parse workspace, mode, open cards from each message.

By task:
- [`references/choosing-llm-models.md`](references/choosing-llm-models.md) — Model selection. Check when code tasks detected or debugging stuck.
- [`references/searching-and-querying.md`](references/searching-and-querying.md) — Query syntax for finding cards.
- [`references/workflows-and-orchestration.md`](references/workflows-and-orchestration.md) — Multi-step patterns (migrations, bulk operations).
- [`references/markdown-edit.md`](references/markdown-edit.md) — Editing long markdown fields surgically.
- [`../boxel/references/lint-workflow.md`](../boxel/references/lint-workflow.md) — Required installed npm `boxel` lint gate for `.gts` code tasks.

Troubleshooting:
- [`references/common-errors.md`](references/common-errors.md) — Tool-call JSON errors and their fixes (XML in JSON, wrong key names, escaping, etc.).

Specialty:
- [`references/indexing-operations.md`](references/indexing-operations.md) — Realm reindexing commands.
- [`references/fresh-realm-push-integrity.md`](references/fresh-realm-push-integrity.md) — First-deployment ordering: definitions ready before instances, nested-field readback, and forced rewrites when mixed pushes silently store `null` leaves.
- [`references/diagnosing-broken-links.md`](references/diagnosing-broken-links.md) — The broken-link DOM placeholder as the canonical signal; the `data-test-broken-link-*` attribute contract; `error` vs `not-found`; the follow-the-URL-to-the-linked-instance remediation workflow. (Card-author side: `boxel/references/defensive-link-traversal.md`.)
- [`references/source-code-editing.md`](references/source-code-editing.md) — Cross-link to the SEARCH/REPLACE skill.

## Sibling skills

- `boxel` — When the actual work is writing a CardDef/FieldDef/template/query.
- `source-code-editing` — SEARCH/REPLACE block format.
- `catalog-listing` — Catalog operations from inside the app.
- (`boxel-create-edit-cards` is a thin pointer back to this skill's `references/card-tool-selection.md`.)

---

## Debug mode

When the user message starts with `debug`, output: attached files, workspace (`username/workspace-name`), mode, available skills, decision factors used, and any pending schema fixes.
