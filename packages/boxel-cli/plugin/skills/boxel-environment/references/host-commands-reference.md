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
        module: '@cardstack/boxel-host/tools/create-workspace'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/delete-workspace'
        name: default
      requiresApproval: true
    - codeRef:
        module: '@cardstack/boxel-host/tools/preview-format'
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/update-code-path-with-selection'
        name: default
      requiresApproval: false
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
    - codeRef:
        module: '@cardstack/boxel-host/tools/search-cards'
        name: SearchCardsByQueryCommand
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/search-cards'
        name: SearchCardsByTypeAndTitleCommand
      requiresApproval: false
---

# Host Commands Reference

Quick lookup of every command available to this skill, what it does, and notable rules.

## Editing

- **SEARCH/REPLACE** — The way to create or edit files, `.gts` and `.json` alike. Streams as visible text so the user sees real-time progress, and runs through the code-patch pipeline with correctness checking. Create a new file by marking its URL line with `(new)`.
- There is no file-writing tool. Every text file — `.gts`, `.json`, `.md`, `README`, anything — is written with SEARCH/REPLACE, adding `(new)` after the URL to create one. A tool call cannot stream, so the UI sits frozen through a long generation and the write skips the code-patch pipeline; SEARCH/REPLACE streams as it is produced and goes through lint and correctness checks.
- `patch-fields_3e67` — Field updates on an indexed card the user is looking at, with their approval. Not for repairing a file you just wrote or one that failed a check: that card may not be indexed yet, so the tool applies to nothing — edit the `.json` with a SEARCH/REPLACE block instead.
- `patchCardInstance` — Update card data only.
- `ApplyMarkdownEditCommand_c112` — Edit long markdown fields (>500 chars) surgically without truncation (requires approval).
- `copy-card_eefc` — Duplicate a card (requires approval).
- `copy-source_5d09` — Duplicate a file (requires approval).
- `transform-cards_33d7` — Bulk update with a command (requires approval).

## Reading

- `read-file-for-ai-assistant_a831` — Read file contents into context.
- `read-card-for-ai-assistant` — Read a card instance.

## Navigation

- `switch-submode_dd88` — Toggle interact/code modes. Navigation only: it never writes, and it is not a step of creating or editing a file (SEARCH/REPLACE does that; `(new)` creates). Call it at most once per task, and never when the tab is already in code mode on that file — the last tool result's `context.submode` and `context.codeMode.currentFile` tell you where you are. A bare `submode: "code"` opens code mode in whatever realm the UI last showed — when the task targets a specific realm, pass `codePath` with a plain file URL in that realm (never append `(new)` to it; add `createFile: true` only when the file doesn't exist yet).
- `show-card_566f` — Display a card instance in the current mode. `cardId` is the instance id: its URL without the `.json` extension. A `.gts` path is a definition, not a card — passing one opens the definition's own module in the base realm, which is never what you want. To open a file in the editor, use `switch-submode_dd88` with `codePath`.
- `preview-format_cb94` — Open module + preview card (code mode; use after edits).
- `update-code-path-with-selection_f749` — Open file in code editor.
- `open-workspace_1696` — Navigate to a workspace by URL. Lands in **interact mode** — it exits code mode. To work on a specific realm in code mode, use `switch-submode` with a `codePath` in that realm instead.
- `create-workspace_cf0f` — Create a new workspace (realm) for the current user (requires approval). Both inputs are optional: `name` is the display name (a random one is generated when omitted) and `endpoint` is the URL path segment (derived from the name when omitted). When done it opens the new workspace; its URL is the `Workspace:` line in the context returned with the tool result — report that URL to the user.
- `delete-workspace_a465` — Permanently delete a workspace the user owns, with all of its cards and files (requires approval). Pass `realmIdentifier`. Confirm with the user before calling it; it cannot be undone.

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
- `transform-cards`, `copy-card`, `copy-source`, `patch-fields`, `apply-markdown-edit`, `create-workspace_cf0f`, `delete-workspace_a465`
