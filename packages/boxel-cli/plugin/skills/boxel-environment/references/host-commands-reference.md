---
name: host-commands-reference
description: Full catalog of Boxel host commands — what each does and its approval rules.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/switch-submode'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/show-card'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/transform-cards'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/read-card-for-ai-assistant'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/read-file-for-ai-assistant'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/set-active-llm'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/open-workspace'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/preview-format'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/update-code-path-with-selection'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/write-text-file'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/copy-card'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/copy-source'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/patch-fields'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/update-room-skills'
        name: default
      requiresApproval: false
---

# Host Commands Reference

Quick lookup of every command available to this skill, what it does, and notable rules.

## Editing

- **SEARCH/REPLACE** — The way to create or edit files, `.gts` and `.json` alike. Streams as visible text so the user sees real-time progress, and runs through the code-patch pipeline with correctness checking. Create a new file by marking its URL line with `(new)`.
- `write-text-file_e5a1` — **Avoid; use SEARCH/REPLACE instead.** Tool calls don't stream, so the UI appears frozen during long generation, and the write skips the code-patch pipeline.
- `patch-fields_3e67` — Fine-grained card field updates (requires approval).
- `patchCardInstance` — Update card data only.
- `ApplyMarkdownEditCommand_c112` — Edit long markdown fields (>500 chars) surgically without truncation (requires approval).
- `copy-card_eefc` — Duplicate a card (requires approval).
- `copy-source_5d09` — Duplicate a file (requires approval).
- `transform-cards_33d7` — Bulk update with a command (requires approval).

## Reading

- `read-file-for-ai-assistant_a831` — Read file contents into context.
- `read-card-for-ai-assistant` — Read a card instance.

## Navigation

- `switch-submode_dd88` — Toggle interact/code modes. A bare `submode: "code"` opens code mode in whatever realm the UI last showed — when the task targets a specific realm, always pass `codePath` with a file URL in that realm (add `createFile: true` when the file doesn't exist yet).
- `show-card_566f` — Display card in current mode.
- `preview-format_cb94` — Open module + preview card (code mode; use after edits).
- `update-code-path-with-selection_f749` — Open file in code editor.
- `open-workspace_1696` — Navigate to a workspace by URL. Lands in **interact mode** — it exits code mode. To work on a specific realm in code mode, use `switch-submode` with a `codePath` in that realm instead.

## Search

- `SearchCardsByQueryCommand_847d` — Advanced search with filters (preferred).
- `SearchCardsByTypeAndTitleCommand_a959` — Simple title search.

## Skill / LLM management

- `update-room-skills_3875` — Activate/deactivate skills in the current room.
- `set-active-llm_1887` — Switch AI model.

## Indexing (requires write access)

- `invalidate-realm-identifiers_xxxx` — Trigger indexing for specific file/resource identifiers in a realm.
- `reindex-realm_xxxx` — Reindex a realm using default mode.
- `full-reindex-realm_xxxx` — Force a full reindex of a realm.
- `cancel-indexing-job_xxxx` — Cancel currently running indexing job.

## Approval requirements

The following require user approval before execution:
- `transform-cards`, `write-text-file`, `copy-card`, `copy-source`, `patch-fields`, `apply-markdown-edit`
