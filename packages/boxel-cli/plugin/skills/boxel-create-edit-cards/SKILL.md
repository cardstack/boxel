---
name: boxel-create-edit-cards
description: Use when choosing the right Boxel host command combination to create new cards or edit existing instances from the AI assistant.
boxel:
  kind: skill
---

# Creating and Editing Cards

_Quick reference for choosing the right combination of commands to create new cards or update existing ones_

## Pair with

- **`boxel-environment`** — these are runtime host commands; the environment skill defines the orchestration model.
- **`source-code-editing`** — for the SEARCH/REPLACE block format used by code edits.
- **`boxel`** — when the schema or relationship is non-trivial.

## Don't use for

- Writing card definitions outside the live Boxel app — use `boxel` + `source-code-editing` directly.

## 🔧 Card Tools: Create, Edit, Update

### Creating Cards
| Tool | Use When |
|------|----------|
| **SEARCH/REPLACE** | **Always use for .gts files** — new definitions, templates, any code file |
| **write-text-file** | New .json card instances from scratch (structured data, typically small) |
| **copy-card + patch-fields** | Clone existing card as template, then modify |

### Editing Cards
| Tool | Use When | Don't Use When |
|------|----------|----------------|
| **patch-fields_3e67** ⭐ | Field updates (nested paths, arrays, linksTo) — **preferred** | Card doesn't exist yet |
| **patchCardInstance** | Full card replacement (use sparingly — replaces entire card) | Surgical edits |
| **SEARCH/REPLACE** | Code (.gts), JSON structure, schema changes, new files | Small markdown edits in large docs |
| **ApplyMarkdownEdit** | Targeted edits in large markdown fields | Short fields, code files, non-markdown |

**Quick Decision:**
```
Card doesn't exist yet?
├─ New .gts file → SEARCH/REPLACE with (new) marker (ALWAYS — never write-text-file for .gts)
├─ New .json instance → write-text-file
├─ Clone + modify → copy-card → patch-fields
└─ Code mode .json → SEARCH/REPLACE

Card already exists?
├─ Update fields → patch-fields (preferred)
├─ Full replacement → patchCardInstance (sparingly)
├─ Edit .gts or JSON structure → SEARCH/REPLACE
└─ Small change in big markdown → ApplyMarkdownEdit
```

**File Naming:** Definitions: `kebab-case.gts` | Instances: `PascalCase/slug.json` | Links: `BlogPost/my-post` (no `.json`)

**Path Rules:** Use `./`, `../` relative paths for same-realm `adoptsFrom`. Use absolute URLs for cross-realm. After copy/move, verify linkage!

