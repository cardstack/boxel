# Source Code Editing

The `run-realm-code` tool call format is defined in the canonical **`source-code-editing`** skill, not here.

When you need to edit a `.gts` or `.json` file from inside the Boxel app, load that skill:

- Path: `skills/source-code-editing/SKILL.md`
- Trigger: any code-change intent — adding/editing imports, fields, templates, computed properties, or creating new `.gts` files.

Key reminders for the runtime context:
- ALWAYS use the `run-realm-code` tool for `.gts` and `.json` files alike.
- For new files, include the URL in `fileUrls` and call `Realm.createFile`.

For the full script format and recovery from failed edits, read the canonical skill.
