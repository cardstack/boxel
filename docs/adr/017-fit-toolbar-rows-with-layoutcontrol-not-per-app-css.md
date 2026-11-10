---
status: proposed
date: 2026-11-03
scope:
  - packages/pretui/components/layout-control*
  - packages/pretui/components/button.gts
  - packages/pretui/components/icon-button.gts
  - packages/pretui/components/segmented-control.gts
  - packages/pretui/components/select.gts
  - packages/pretui/components/search-input.gts
  - packages/pretui/components/filter-chips.gts
  - packages/pretui/internal/field-dress.gts
---

# 017. Fit toolbar rows with LayoutControl, not per-app CSS

A row of mixed controls (search, view toggle, filters, a dropdown, a ⋯ menu, a primary action) is laid out by Pret UI's `LayoutControl`. It gives every control one height and, as the row narrows, picks in JS which form each control shows, folding the rest into ⋯. Controls take part through an opt-in height knob and an opt-in `@display` argument, so every app's toolbar adapts the same way instead of each app patching heights, wrapping and hidden variants in its own CSS.

## 1. Decision

### 1.1. The row

A row of two or more interactive controls that must fit a variable width SHOULD be a `LayoutControl`. Its narrow behaviour MUST come from the slots' declared forms (stepping down, then folding into ⋯), not from caller CSS that wraps the row or hides controls.

### 1.2. One form rendered

A slot MUST render only the form LayoutControl chose. Alternative forms MUST NOT be present and hidden with CSS, so they never reach the tab order or the accessibility tree. Every form MUST keep an accessible name.

### 1.3. Height knob

A single-line Pret UI control meant to sit in a LayoutControl MUST either read `--pretui-row-h` as the first link of its own height chain, or expose a height knob that LayoutControl maps the row height onto. The first form is: `var(--pretui-row-h, var(--pretui-<control>-h, <default>))`. LayoutControl sets `--pretui-row-h` only when it is given a height, and nothing else sets it, so a control outside a sized row keeps its own height. A control MUST NOT read `--control-height` for this: the theme defines it for every themed scope, so it is never unset there.

### 1.4. Display argument

A Pret UI control that has smaller forms MUST offer them through an opt-in `@display` argument whose default is today's form. The control, not the caller, owns how each smaller form looks. A control without `@display` takes part only by folding into ⋯.

### 1.5. Primary action

The row's primary action SHOULD be a `@pinned` slot, so it never folds into ⋯.

## 2. Rationale

Redesigning the Matrix apps (Talent & Resource Tracker first) showed that Pret UI had no component for a row of mixed controls. Each control shipped its own height, so toolbars looked uneven. When a row ran out of room it wrapped (a filter chip dropped to a second line) or squeezed, and each app patched that with its own breakpoints and restyles. Deciding the form in one place, from the row's own width, makes the behaviour the same in every app and keeps it working in a narrow pane on a wide screen. The contract and the chooser's rules are in `packages/pretui/components/layout-control.md`.

## 3. Considered options

- **LayoutControl chooses, controls render (chosen).** One place measures and decides; each control owns its smaller forms, so they look the same everywhere.
- **Per-app CSS breakpoints.** What the apps did before: duplicated per app, keyed to the viewport rather than the row, and it hides variants with CSS, which leaves them in the DOM.
- **Container queries inside each control.** A control only knows its own box, not the rest of the row, so it can't decide which control should give up space first, and a shrink-to-fit control loses its content width once it becomes an inline-size container.
- **Callers swap components per form in the slot block.** Works without `@display`, but every app rewrites the swap and the small forms drift apart; it remains the fallback for controls that don't have `@display` yet.

## 4. Remediation

Known gaps are listed in [remediation/017.md](remediation/017.md).
