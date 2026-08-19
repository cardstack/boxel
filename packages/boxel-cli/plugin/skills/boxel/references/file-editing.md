# File Editing

The SEARCH/REPLACE block format is defined in the canonical [`source-code-editing`](../../source-code-editing/SKILL.md) skill, not here.

- Trigger: any file edit or creation — imports, fields, templates, computed properties, new `.gts` files.

Key reminders:

- ALWAYS use SEARCH/REPLACE to create and edit files — `.gts` and `.json` alike; never `write-text-file`.
- For new files, append `(new)` after the file URL line.
- SEARCH text must match the existing file exactly; keep blocks small.
