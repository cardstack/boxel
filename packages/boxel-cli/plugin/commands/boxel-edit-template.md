---
name: boxel-edit-template
description: Change isolated, embedded, fitted, edit, atom, or markdown templates on a CardDef or FieldDef.
boxel:
  kind: skill
---

# /boxel-edit-template

## Use When

- The user wants visual changes, layout changes, or template-level behavior changes to an existing card.
- They mention a specific format ("the fitted view", "embedded", "the edit form") OR they describe what they see ("the card looks cramped", "the title is too big").

## Inputs

- Path to the `.gts` file.
- Which format(s) to change.
- The desired change (visual or structural).

## Read

1. `skills/boxel/SKILL.md` (focus: `references/template-syntax.md`)
2. **If editing the fitted format: `skills/boxel/references/container-query-fitted-layout.md` is REQUIRED reading.** Don't write a fitted template without it.
3. `skills/boxel/references/lint-workflow.md`
4. `skills/boxel-ui-guidelines/SKILL.md`
5. `skills/source-code-editing/SKILL.md`
6. If the change is design-driven: `skills/boxel-design/SKILL.md`.

## Procedure

1. Read the current template — confirm which format you're editing.
2. SEARCH/REPLACE the template. Preserve `<style scoped>` blocks and tracking markers.
3. **For `fitted`, follow `skills/boxel/references/container-query-fitted-layout.md` exactly** — two-element `.cq` → `.fit` pattern, six height quanta, `pow()`-based typography, `minmax(0, 1fr)` body row, `min-height: 0` on grid children. Hand-rolling without these will overflow at edge sizes.
4. For multi-card delegation, use `<@fields.x />` — don't iterate `@model` then try `<@fields.x />` inside the loop.
5. Use theme tokens (`var(--background)`, `var(--muted)`, `var(--border)`) — no hard-coded colors.

## Done Criteria (self-verify)

- [ ] No JS expressions in templates (`{{ @model.x * 2 }}` → use a helper or getter).
- [ ] No object literals in templates (`{{hash a=1 b=2}}` is OK, `{ a: 1 }` inside template is not).
- [ ] Empty/null states handled (`{{#if @model.foo.length}}...{{else}}...{{/if}}`).
- [ ] **No `(this.x)` or `(@model.x)` in `{{#if}}` guards** — wrap-in-parens makes Glimmer try to call it as a helper; class getters fail silently. Use `{{#if this.x}}` (no parens) for property access; parens are only for helper invocations like `(eq a b)`.
- [ ] Block-param names don't shadow HTML tags (no `as |s|`, `as |section|`, `as |option|`).
- [ ] Theme variables only — `grep -E '#[0-9a-fA-F]{3,8}' <file>` returns no hard-coded colors (except where theme-scoped).
- [ ] **For `fitted` edits**: the two-element `.cq` → `.fit` pattern from `container-query-fitted-layout.md` is in place; `.fit` declares `--type-base`, `--type-ratio`, and the `pow()`-derived role variables; body row uses `minmax(0, 1fr)`; every region has `overflow: hidden; min-height: 0`.
- [ ] **For `fitted` edits**: every one of the **16 named sizes** renders cleanly — Small/Medium/Large Badge; Single/Double/Triple Strip + Double-Wide/Triple-Wide Strip; Small/Regular/CardsGrid/Tall/Large Tile; Compact/Full/Expanded Card. Walk the table in `boxel/references/fitted-formats.md`; no overflow, type hierarchy legible at every cell, sub-format routing (badge/strip/tile/card) hits correctly. Verify in the live app's format preview, not `npx boxel check`.
- [ ] Changed `.gts` files passed installed npm `boxel` lint (`npx boxel file lint ... --file <local-file>` before push and `npx boxel lint <path> --realm <url>` after push).

## Failure Recovery

- `TypeError: Cannot read properties of null (reading 'manager')` → check for HTML-tag-shadowing block params (see `boxel/references/template-syntax.md`).
- Fitted view looks wrong at some size → review the four sub-formats (badge/strip/tile/card) in `boxel/references/fitted-formats.md`.
