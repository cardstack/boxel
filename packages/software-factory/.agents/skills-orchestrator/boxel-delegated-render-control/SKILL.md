---
name: boxel-delegated-render-control
description: Controlling child-card renders from the parent — fitted vs embedded format choice, the host-injected CardContainer chrome, and the plural-field/atom/stagger/divider traps. Use when embedding cards via <@fields.X @format='...' /> or when an embedded/fitted child looks wrong (empty boxes, collapsed grids, double borders, invisible atoms).
---

# Delegated Render Control

When a parent card renders a child via `<@fields.X @format='...' />`, the
host wraps the child in a `CardContainer` with chrome you didn't write
(rounded corners, 1px halo, light background, `overflow: hidden`). Two
decisions dominate the outcome: **which format** you pick, and **who owns
the chrome**. The full mechanics — exact injected DOM/CSS, override layers,
recipes, and the child-side contract — live in
`references/delegated-render-control.md`.

## Format choice = who owns the cell size (decide BEFORE styling)

| Format     | Who controls the box size?                                                                      | Use when                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `embedded` | **The child.** Width fluid, height = the card's natural content.                                | Vertical lists, feeds, roster rows, variable-height items.                                             |
| `fitted`   | **The parent.** Child fills the box you give it (`width/height: 100%`, `container-type: size`). | Uniform tile grids (calendar cells, portraits, badge strips) where you deliberately set the cell size. |

**The single most common rendering bug:** picking `fitted` for a list of
variable-height cards — short content leaves a big empty box below each row.
The fix is the format choice, upstream of any CSS. Decision rule: _did you
set the cell size?_ Yes → `fitted` (+ `min-height`/`aspect-ratio` on the
cell). No → `embedded`.

## Who owns the chrome — three override layers (pick the lowest that works)

1. **Theme cascade** — if the linked card has `cardInfo.theme`, the theme's
   `--background`, `--foreground`, `--border`, `--radius` flow into the
   wrapper. Cleanest, but only when the child instance actually has a theme.
2. **`:deep()` from the parent's `<style scoped>`** — the workhorse.
   Target `:deep(.boxel-card-container)` for radius/background,
   `:deep(.boxel-card-container--boundaries)` for the 1px halo.
3. **`@displayContainer={{false}}`** — kills the chrome entirely
   (`display: contents`); pair with a parent-owned wrapper element.

## The high-frequency traps

1. **Plural-field wrapper.** Rendering a plural field with one tag
   (`<@fields.items @format='fitted' />`) inserts wrapper divs between your
   grid and the cards — the grid sees ONE child and collapses to a single
   column. Fix: `:deep(> .plural-field) { display: contents; }` plus
   `:deep(.linksToMany-itemContainer), :deep(.containsMany-item) { display:
contents; }`. Targeting only `.containsMany-field` is the most common
   bug — `linksToMany` ships `.linksToMany-field`, which never matches.
2. **Atoms on dark backgrounds disappear.** The atom chip's own near-white
   background + halo win over your `color: inherit`. Fix: either
   `@displayContainer={{false}}` (plain inline text), or keep the chip and
   recolor via `:deep(.field-component-card.atom-format) { background:
transparent; box-shadow: none; color: var(--accent); }`.
3. **Stagger through `display: contents`.** `:nth-child` on the cards
   themselves always resolves to 1 (each is the only child of its wrapper).
   Set `--stagger-d` on `:deep(.linksToMany-itemContainer:nth-child(N))` /
   `:deep(.containsMany-item:nth-child(N))` and read
   `animation-delay: var(--stagger-d)` on `.field-component-card` — custom
   properties inherit through `display: contents`.
4. **Divider strategy — parent draws OR child halo, never both.** Either
   the parent draws dividers and kills the child halo
   (`:deep(.boxel-card-container--boundaries) { box-shadow: none; }`), or
   the halo IS the boundary and the parent adds no borders. Leaving both
   yields the "drop shadow fighting a thin border" double-rule. When
   switching strategies, DELETE the stale rule — same-selector CSS resolves
   by source order.

## Don't override

`width/height: 100%` on `.fitted-format`, or `container-type` /
`container-name` on embedded/fitted — the child's container queries depend
on them. Style chrome (radius, background, border, shadow, padding), not
layout primitives.

## The child-side contract

The child draws ONLY inside the box; host or parent draws the box. No
`border-radius`, `border`, `box-shadow`, `overflow`, or size properties on
any format's outermost element — see the reference for the per-format table
and self-check.
