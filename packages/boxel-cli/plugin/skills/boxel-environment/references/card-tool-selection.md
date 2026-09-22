# Card Tool Selection — Create, Edit, Update

Choosing the right host-command combination for creating new cards or editing existing instances from the AI assistant. This expands Step 4 (Data task) of the master decision tree in `../SKILL.md`.

## Creating Cards

| Tool | Use When |
|------|----------|
| **run-realm-code** | **Always — any new file**, `.gts` definitions and `.json` instances alike (use `Realm.createFile`) |
| **copy-card + patch-fields** | Clone existing card as template, then modify |
| **write-text-file** | Avoid — use the `run-realm-code` tool instead (tool calls don't stream and skip the code-patch pipeline) |

## Editing Cards

| Tool | Use When | Don't Use When |
|------|----------|----------------|
| **patch-fields_3e67** ⭐ | Field updates (nested paths, arrays, linksTo) — **preferred** | Card doesn't exist yet |
| **patchCardInstance** | Full card replacement (use sparingly — replaces entire card) | Surgical edits |
| **run-realm-code** | Code (.gts), JSON structure, schema changes, new files | Small markdown edits in large docs |
| **ApplyMarkdownEdit** | Targeted edits in large markdown fields | Short fields, code files, non-markdown |

## Quick Decision

```
Card doesn't exist yet?
├─ New .gts file → `run-realm-code` with `Realm.createFile`
├─ New .json instance → `run-realm-code` with `Realm.createFile`
└─ Clone + modify → copy-card → patch-fields

Card already exists?
├─ Update fields → patch-fields (preferred)
├─ Full replacement → patchCardInstance (sparingly)
├─ Edit .gts or JSON structure → `run-realm-code`
└─ Small change in big markdown → ApplyMarkdownEdit
```

## Conventions

- **File naming:** Definitions: `kebab-case.gts` | Instances: `PascalCase/slug.json` | Links: `BlogPost/my-post` (no `.json`)
- **Path rules:** Use `./`, `../` relative paths for same-realm `adoptsFrom`. Use absolute URLs for cross-realm. After copy/move, verify linkage!

## Pair with

- `source-code-editing` — the `run-realm-code` tool call format used by code edits.
- `boxel` — when the schema or relationship is non-trivial.
