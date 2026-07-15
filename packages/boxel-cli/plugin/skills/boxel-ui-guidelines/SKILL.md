---
name: boxel-ui-guidelines
description: Use when writing or editing Boxel templates that render UI: applying theme tokens, choosing between @fields and @model, using boxel-ui components (Button, Pill, Avatar, BoxelSelect), or fixing layout/overflow issues.
boxel:
  kind: skill
---

# Boxel UI Guidelines

_Ensures boxel-ui components are used in templates and theming guidelines are followed_

You are a Boxel UI specialist. Whenever you write or review GTS templates and card definitions, you must follow these guidelines:

## Pair with

- **`boxel`** — for the underlying CardDef/FieldDef and `@fields` vs `@model` rules.
- **`boxel-design`** — for the visual decisions these templates implement.
- **`source-code-editing`** — for the actual template edits.

## Don't use for

- Visual design choices (color, mood, typography) — that's `boxel-design`.
- Field schema decisions (`contains` vs `linksTo`) — that's `boxel`.

---

## Sections (load on demand)

- `references/use-boxel-design-tokens-for-theming.md` — Use Boxel Design Tokens for Theming
- `references/font-loading-theme-card-owns-imports.md` — Font Loading — Theme Card Owns Imports
- `references/field-rendering-fields-vs-model.md` — Field Rendering: @fields vs @model
- `references/template-patterns.md` — Template Patterns. Includes the **entrance-animation invisibility trap** — never put `opacity: 0` in base CSS + `animation: ... forwards`; move the `from` state into the keyframe and use `animation-fill-mode: both`, so a canceled animation (format flip, reduced-motion) leaves the element visible.
- `references/use-container-queries-not-viewport-units.md` — Use Container Queries, Not Viewport Units
- `references/prevent-content-overflow.md` — Prevent Content Overflow
- `references/prefer-component-apis-write-new-components-when-needed.md` — Prefer Component APIs; Write New Components When Needed
- `references/use-boxel-ui-components.md` — Use Boxel-UI Components
- `references/style-budget.md` — Style budget — keep `<style>` blocks ≤40% of file, deduplicate across formats
- **`references/delegated-render-control.md`** — How the host wraps `<@fields.X @format='...' />` chrome (CardContainer + field-component classes) and how the parent overrides it via theme cascade, `:deep()`, or `@displayContainer={{false}}`. **Critical reading when embedding child cards in a parent that has its own design language.** Covers:
  - **Divider strategy is binary** — parent draws lines (AND kills `--boundaries` shadow), OR child halo IS the boundary (no parent borders). Both at once = "drop shadow fighting a thin border."
  - **Picking the format** — fitted vs embedded by who owns the cell size (the most common rendering bug is fitted-with-short-content leaving empty box space).
  - **Plural-field wrapper trap** — `.linksToMany-field` ≠ `.containsMany-field`; target `.plural-field` + `.linksToMany-itemContainer`/`.containsMany-item` with `display: contents`.
  - **Atom alignment & invisibility** — default chrome has near-white background; `@displayContainer={{false}}` or recolor when on dark surfaces.
  - **Stagger animations through `display: contents`** — CSS-variable cascade trick (nth-child on wrapper, animation-delay reads var on card).
  - Embedded grid chrome, image bleed, isolated previews, and what NOT to override (child container queries, fitted's width/height).
  - The child-side contract — what every format MUST NOT decorate on its outermost element.
- `references/checklist.md` — Checklist
