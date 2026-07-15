---
name: boxel-markdown-format
description: Use when authoring a `markdown` template (static markdown format) on a CardDef or FieldDef — defaults, markdownEscape, and markdown helpers.
boxel:
  kind: skill
---

# Markdown Format Authoring

_Authoring `static markdown` templates: defaults, markdownEscape, markdown-helpers toolkit, delegation, and pitfalls._

Boxel has a sixth display format alongside `isolated`, `embedded`, `fitted`, `atom`, and `edit`:

- **`markdown`** — the card (or field, or file) rendered as text in **Boxel Flavored Markdown** (BFM).

This format is what the realm serves under `Accept: text/markdown`, what "Copy as Markdown" puts on the clipboard, what the code-mode markdown preview panel shows, and what gets indexed into the `boxel_index.markdown` column. See the `boxel-flavored-markdown` skill for the dialect itself.

## Pair with

- **`boxel-flavored-markdown`** — for the dialect rules your output must conform to (directives, fenced renderers, escaping).
- **`boxel`** — for the surrounding CardDef structure and `<@fields.x />` delegation rules.

## Don't use for

- Rendering markdown into HTML at runtime in `isolated` or `embedded` (that's a runtime concern handled by Boxel's markdown component).
- Authoring rich content that lives in a `MarkdownField` instance — that's content, not a template.

---

## Sections (load on demand)

- `references/the-default-usually-good-enough.md` — The default — usually good enough
- `references/shape-of-a-static-markdown-template.md` — Shape of a `static markdown` template
- `references/essential-helper-markdownescape.md` — Essential helper: `markdownEscape`
- `references/the-markdown-helpers-toolkit.md` — The `markdown-helpers` toolkit
- `references/delegation-composes.md` — Delegation composes
- `references/pitfalls.md` — Pitfalls
- `references/worked-example-note-card-with-custom-markdown.md` — Worked example: `Note` card with custom markdown
- `references/rendering-markdown-html-at-runtime.md` — Rendering markdown → HTML at runtime
- `references/when-youre-done.md` — When you're done
