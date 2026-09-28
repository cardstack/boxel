---
name: rich-markdown-reports
description: Use when a request calls for a report, summary, briefing, or dashboard-style document — especially when you'd otherwise define a new card type to present it. Compose it as a rich Boxel markdown (.md) file that embeds the relevant cards (custom or off-the-shelf) instead of authoring a bespoke CardDef or writing plain prose.
boxel:
  kind: skill
---

# Rich Markdown Reports

_For a report, reach for Rich Markdown that embeds existing cards — not a new card definition built just to present it._

When a user asks for a report, summary, or dashboard-style document, the tempting move is to design a new card type (a `CardDef`) to hold it. For most reports, don't. Compose the report as a **Rich Markdown `.md` file** that embeds the cards it's about — custom types the user already has, or off-the-shelf catalog cards. You get a live, rich document without inventing a one-off schema, and the embeds stay current as the underlying cards change.

## The rule

When a task calls for a report, summary, meeting notes, briefing, or any write-up of one or more cards:

- **Default to Rich Markdown, not a new card definition.** Reach for a `.md` file that embeds existing cards before you consider authoring a bespoke `CardDef` to represent the report.
- **Embed the cards the report is about** with BFM directives instead of describing them in prose — custom or off-the-shelf cards both work.
- **Reference live data** rather than copying values into the text, so the report stays current as the cards change.
- **Structure it with headings** so it's navigable.

**Write it as a `.md` file in a realm — do not paste it into the chat.** The card and file embeds only render as live cards when the markdown lives as a file in a realm; the same BFM typed into a chat reply stays raw text and the embeds don't resolve. Save it to a realm the user can write to — see **Pair with** below for how to create the file. A report that never becomes a realm file hasn't used this skill.

## Pair with

- **`boxel-flavored-markdown`** — the directive grammar your embeds use (`:card` / `::card` / `::file`, embed formats, fenced renderers). Pick the format that fits the report.
- **`source-code-editing`** — the SEARCH/REPLACE block format used to write the file to the realm. The block format is the same for a `.md` file as for code, so reuse it here even though a report isn't source code.

## Don't use for

- **A reusable, structured, or interactive artifact.** If the deliverable needs a typed schema, edit forms, or its own behavior — not just a document that presents other cards — a `CardDef` is the right tool, not Rich Markdown.
- Content that references no Boxel cards or files — plain markdown is fine there.
- BFM grammar edge cases or a card's rendering internals — that's the `boxel-flavored-markdown` skill.
