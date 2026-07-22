## The default — usually good enough

Every `CardDef`, `FieldDef`, and `FileDef` already has a working `markdown` format. The default renders the card's HTML fallback (`isolated` for cards, `embedded` for fields) into a hidden container and converts it to markdown via turndown + GFM.

**Do not define `static markdown` just to have one.** The default handles headings, paragraphs, lists, links, images, tables, and embedded cards (HTML card containers become `:card[…]` / `::card[…]` directives automatically).

Define an explicit `static markdown` only when:

- The HTML fallback produces noisy or misleading output (style leakage, odd layout artifacts)
- The field has a natural non-HTML representation (code files → fenced code blocks, dates → formatted strings, scalar values → bare text)
- You need deterministic output for indexing or downstream consumers
- A stakeholder explicitly wants a specific markdown shape
