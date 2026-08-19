## Authoring notes

- **Use full URLs in directives**, not relative paths — directives are resolved by the Boxel store, not by the surrounding document's base.
- **Escape user-supplied text** before interpolating it into a BFM string. `[`, `]`, `(`, `)`, `|`, `:`, `#`, `*`, `` ` ``, `_`, `~`, `!`, `<`, `>`, leading `+`/`-`, and line-start `1.` all have meaning. See the `boxel-markdown-format` skill for `markdownEscape` and helper functions.
- **Prettier reflows markdown.** When a template's output must preserve column-zero placement (ATX headings, fence columns), protect it with `{{!-- prettier-ignore --}}`.
