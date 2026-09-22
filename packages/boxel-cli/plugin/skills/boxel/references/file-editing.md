# File Editing

The `run-realm-code` tool call format is defined in the canonical [`source-code-editing`](../../source-code-editing/SKILL.md) skill, not here.

- Trigger: any file edit or creation — imports, fields, templates, computed properties, new `.gts` files.

Key reminders:

- ALWAYS use the `run-realm-code` tool to create and edit files — `.gts` and `.json` alike; never `write-text-file`.
- For new files, include the URL in `fileUrls` and call `Realm.createFile`.
- For existing files, read the source first and pass the exact current text to `Realm.replaceCode`.
