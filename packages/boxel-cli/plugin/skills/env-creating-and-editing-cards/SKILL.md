---
name: env-creating-and-editing-cards
description: Quick reference for choosing the right combination of commands to create new cards or update existing ones
---

## 🔧 Card Tools: Create, Edit, Update

### Creating Cards

| Tool                         | Use When                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| **SEARCH/REPLACE**           | **Always use for .gts files** — new definitions, templates, any code file |
| **write-text-file**          | New .json card instances from scratch (structured data, typically small)  |
| **copy-card + patch-fields** | Clone existing card as template, then modify                              |

### Editing Cards

| Tool                     | Use When                                                      | Don't Use When                         |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------- |
| **patch-fields_3e67** ⭐ | Field updates (nested paths, arrays, linksTo) — **preferred** | Card doesn't exist yet                 |
| **patchCardInstance**    | Full card replacement (use sparingly — replaces entire card)  | Surgical edits                         |
| **SEARCH/REPLACE**       | Code (.gts), JSON structure, schema changes, new files        | Small markdown edits in large docs     |
| **ApplyMarkdownEdit**    | Targeted edits in large markdown fields                       | Short fields, code files, non-markdown |

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
