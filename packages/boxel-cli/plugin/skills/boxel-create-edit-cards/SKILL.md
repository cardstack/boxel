---
name: boxel-create-edit-cards
description: Use when choosing the right Boxel host command combination to create new cards or edit existing instances from the AI assistant.
boxel:
  kind: skill
---

# Creating and Editing Cards

This skill's content has been folded into **`boxel-environment`**, which owns runtime host-command orchestration.

Read:

1. `../boxel-environment/references/card-tool-selection.md` — the create/edit tool tables, quick decision tree, file naming, and path rules.
2. `../boxel-environment/SKILL.md` — the master decision tree (Step 4 covers data tasks).

`source-code-editing` defines the SEARCH/REPLACE format used to create and edit files (`.gts` and `.json` alike). Never use `write-text-file`.
