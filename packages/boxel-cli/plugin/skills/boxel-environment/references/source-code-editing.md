# Source Code Editing

The SEARCH/REPLACE block format is defined in the canonical **`source-code-editing`** skill, not here.

When you need to edit a `.gts` or `.json` file from inside the Boxel app, load that skill:

- Path: `skills/source-code-editing/SKILL.md`
- Trigger: any code-change intent — adding/editing imports, fields, templates, computed properties, or creating new `.gts` files.

Key reminders for the runtime context:
- ALWAYS SEARCH/REPLACE — for `.gts` and `.json` files alike; avoid `write-text-file` (tool calls don't stream; UI freezes).
- For new files, mark the URL line with `(new)`.

For the full block format, matching rules, and recovery from failed matches, read the canonical skill.
