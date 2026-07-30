---
name: boxel-edit-template
description: Workflow for changing isolated / embedded / fitted / edit / atom / markdown templates on an existing CardDef or FieldDef. Routes into boxel-ui-guidelines (template rules) and container-query-fitted-layout (fitted standard); use this for the end-to-end edit procedure, the skill for the rules themselves.
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
2. **If editing the fitted format: `skills/boxel/references/container-query-fitted-layout.md` and `skills/boxel/references/fitted-formats.md` are REQUIRED reading.**
3. `skills/boxel/references/lint-workflow.md`
4. `skills/boxel-ui-guidelines/SKILL.md`
5. `skills/source-code-editing/SKILL.md`
6. If the change is design-driven: `skills/boxel-design/SKILL.md`.
7. If the template embeds child cards: `skills/boxel-ui-guidelines/references/delegated-render-control.md`.

## Procedure

1. Read the current template — confirm which format you're editing.
2. SEARCH/REPLACE the template. Preserve `<style scoped>` blocks.
3. **For `fitted`, follow `skills/boxel/references/container-query-fitted-layout.md` exactly.** Prefer `FittedCard` from `@cardstack/boxel-ui/components` for standard compositions (tune via `--fc-*` variables). When hand-rolling: single-root `.fit` grid querying the host's `fitted-card` container (no local container on the root), six height quanta, `pow()`-based typography, `minmax(0, 1fr)` body row, `min-height: 0` on grid children. Hand-rolling without these will overflow at edge sizes.
4. For multi-card delegation, use `<@fields.x />` — don't iterate `@model` then try `<@fields.x />` inside the loop (see `template-syntax.md`).
5. Use theme tokens per `boxel-ui-guidelines` — no hard-coded colors outside theme scope.

## Done Criteria (self-verify)

- [ ] Template passes the syntax rules in `boxel/references/template-syntax.md`: no JS expressions or object literals, no parenthesized property access in `{{#if}}` guards, no block-param names shadowing HTML tags, empty/null states handled.
- [ ] Theme variables only — `grep -E '#[0-9a-fA-F]{3,8}' <file>` returns no hard-coded colors (except where theme-scoped).
- [ ] **For `fitted` edits**: either the template uses `FittedCard` (styled via `--fc-*` variables and `@container fitted-card` overrides), OR the hand-rolled single-root `.fit` pattern from `container-query-fitted-layout.md` is in place (queries target the host's `fitted-card` container; no `container-type`/`container-name` in the template; `.fit` declares `--type-base`, `--type-ratio`, and the `pow()`-derived role variables; body row uses `minmax(0, 1fr)`; every region has `overflow: hidden; min-height: 0`).
- [ ] **For `fitted` edits**: every one of the **16 named sizes** renders cleanly — Small/Medium/Large Badge; Single/Double/Triple Strip + Double-Wide/Triple-Wide Strip; Small/Regular/CardsGrid/Tall/Large Tile; Compact/Full/Expanded Card. Walk the table in `boxel/references/fitted-formats.md`; no overflow, type hierarchy legible at every cell, sub-format routing (badge/strip/tile/card) hits correctly. Verify in the live app's format preview, not `npx boxel check`.
- [ ] Changed `.gts` files passed the lint gate (`npx boxel file lint ... --file <local-file>` before push, `npx boxel lint <path> --realm <url>` after).

## Failure Recovery

- `TypeError: Cannot read properties of null (reading 'manager')` → HTML-tag-shadowing block params (see `boxel/references/template-syntax.md`).
- `{{#if}}` block never enters its true branch though the value renders elsewhere → parenthesized property access (see `template-syntax.md`).
- Fitted view looks wrong at some size → review the sub-format routing in `boxel/references/fitted-formats.md`.
