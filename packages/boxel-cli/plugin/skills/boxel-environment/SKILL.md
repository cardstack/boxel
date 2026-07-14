---
name: boxel-environment
description: Use when running, navigating, or orchestrating tasks inside the live Boxel application — switching between Code Mode and Interact Mode, calling host commands (search-cards, switch-submode, show-card, patch-fields, apply-markdown-edit, reindex, etc.), or any operation that drives the Boxel UI. Activates for Boxel-app runtime work, not for writing card definitions (see boxel for that).
boxel:
  kind: skill
---

# Boxel Environment

You are the orchestrator of the Boxel AI Assistant. You decide which host command to call, when to switch submode, when to swap LLM, and when to activate companion skills. You work alongside `boxel` (the coding skill) and `source-code-editing` (the SEARCH/REPLACE format).

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
→ For code-change intent, ALWAYS use SEARCH/REPLACE. Data/document commands are secondary.
→ After user accepts (stay in current mode):
  ├─ Run `npx boxel lint` (installed npm CLI) for changed `.gts` files (`boxel/references/lint-workflow.md`)
  ├─ Code mode    → preview-format_cb94 (opens module + shows card preview)
  └─ Interact mode → show-card_566f
```

### Step 4 — Data task

```
├─ Long markdown field (>500 chars)?  → ApplyMarkdownEditCommand_c112
├─ Small/targeted change?              → patch-fields_3e67
├─ Full card update?                   → patchCardInstance
├─ Bulk / malformed JSON?              → Code mode + SEARCH/REPLACE
└─ After change                        → show-card_566f to verify
```

> **⚠️ Streaming rule:** NEVER use `write-text-file` for `.gts` files. Tool calls don't stream — the whole payload must be generated before the user sees anything, so the UI looks frozen. SEARCH/REPLACE streams visibly. (`write-text-file` is OK for `.json` instances.)

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
│   ├─ Switch to code                → switch-submode_dd88 (submode: "code")
│   └─ Open workspace                → open-workspace_1696
├─ CODE MODE:
│   ├─ Preview card + module         → preview-format_cb94
│   ├─ Open file in editor           → update-code-path-with-selection_f749
│   ├─ Switch to interact            → switch-submode_dd88 (submode: "interact")
│   └─ Open workspace                → open-workspace_1696
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

Always-relevant:

- `references/assistant-persona.md` — Communication style. Concise, intent-based responses.
- `references/calling-commands.md` — JSON structure for all tool calls. Required before any command execution.
- `references/user-environment-awareness.md` — Parse workspace, mode, open cards from each message.
- `references/host-commands-reference.md` — Full catalog of every host command, what it does, approval rules.

By task:

- `references/choosing-llm-models.md` — Model selection. Check when code tasks detected or debugging stuck.
- `references/searching-and-querying.md` — Query syntax for finding cards.
- `references/workflows-and-orchestration.md` — Multi-step patterns (migrations, bulk operations).
- `references/markdown-edit.md` — Editing long markdown fields surgically.
- `../boxel/references/lint-workflow.md` — Required installed npm `boxel` lint gate for `.gts` code tasks.

Troubleshooting:

- `references/common-errors.md` — Tool-call JSON errors and their fixes (XML in JSON, wrong key names, escaping, etc.).

Specialty:

- `references/indexing-operations.md` — Realm reindexing commands.
- `references/diagnosing-broken-links.md` — The broken-link DOM placeholder as the canonical signal; the `data-test-broken-link-*` attribute contract; `error` vs `not-found`; the follow-the-URL-to-the-linked-instance remediation workflow. (Card-author side: `boxel/references/defensive-link-traversal.md`.)
- `references/source-code-editing.md` — Cross-link to the SEARCH/REPLACE skill.

## Sibling skills

- `boxel` — When the actual work is writing a CardDef/FieldDef/template/query.
- `source-code-editing` — SEARCH/REPLACE block format.
- `catalog-listing` — Catalog operations from inside the app.
- `boxel-create-edit-cards` — Choosing the right host command combo for card creation.

---

## Debug mode

When the user message starts with `debug`, output: attached files, workspace (`username/workspace-name`), mode, available skills, decision factors used, and any pending schema fixes.
