## Base syntax

Standard CommonMark plus GFM. The common subset you can rely on:

- ATX headings (`# H1` … `###### H6`) — marker and text must be on the **same line**. BFM auto-assigns `user-content-*` IDs to headings so they're anchorable.
- Paragraphs, hard breaks (two trailing spaces + `\n`), horizontal rules
- Emphasis (`*em*`, `**strong**`), inline code (`` `x` ``), fenced code blocks
- Lists (bullet `-`/`+`/`*`, ordered `1.` — note `.` not `)`)
- Links `[text](url)` and images `![alt](url)`
- GFM tables (`|`-separated), strikethrough (`~~x~~`), autolinks
- **Extended tables** — column alignment, colspan/rowspan, multi-line cells (via `marked-extended-tables`)
