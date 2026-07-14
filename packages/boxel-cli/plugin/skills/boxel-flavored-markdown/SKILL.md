---
name: boxel-flavored-markdown
description: Use when authoring or editing Boxel Flavored Markdown (BFM) content — content fields rendered as rich markdown with :card/::card directives, mermaid diagrams, etc.
boxel:
  kind: skill
---

# Boxel Flavored Markdown (BFM)

_BFM reference: render surfaces, base syntax, :card/::card directives, mermaid, math ($...$ / $$...$$), alerts, footnotes, and code highlighting._

BFM is the markdown dialect Boxel reads and writes. It extends CommonMark + GitHub Flavored Markdown with:

- Card directives (`:card[URL]`, `::card[URL | spec]`) for embedding cards
- Mermaid diagrams in fenced code blocks
- LaTeX math via `$...$` / `$$...$$` (KaTeX)
- GFM alerts (`> [!NOTE]`, `> [!WARNING]`, etc.)
- Footnotes, extended tables, heading IDs
- Monaco-powered syntax highlighting for fenced code blocks

## Pair with

- **`boxel-markdown-format`** — when you're generating BFM as the _output_ of a `static markdown` template.
- **`boxel`** — for the surrounding CardDef when MarkdownField is a card field.

## Don't use for

- Plain CommonMark or GFM content with no Boxel-specific directives (no extra skill needed).
- HTML-emitting markdown (BFM is plain-text; the runtime renders it).

---

## Sections (load on demand)

- `references/where-bfm-is-used.md` — Where BFM is used
- `references/base-syntax.md` — Base syntax
- `references/bfm-extensions-beyond-commonmarkgfm.md` — BFM extensions beyond CommonMark/GFM
- `references/card-directives-the-boxel-extension.md` — Card directives (the Boxel extension)
- `references/authoring-notes.md` — Authoring notes
- `references/quick-reference.md` — Quick reference
