## What it is

An edge-docked modal panel. Same blocking semantics as **Dialog**, different geometry: it fills one axis of the viewport and slides in from `end`, `start` or `bottom`. Reach for it when the content is a list or a long form that benefits from full viewport height — filters, detail inspectors, a settings sheet on narrow screens — and when the user's mental model is "a surface that came from the side", not "a box on top of the page". If the content is a short decision, use **Dialog**. If the panel should not block the page, use **Popover** or a **SplitPanes** side region instead; a Drawer is modal and there is no non-modal mode.

## The contract

```
@open, @onClose (required), @label?, @placement? ('end'|'start'|'bottom'), @dismissible? (default true)
<:title> <:default> <:footer>
```

Identical control semantics to Dialog, and deliberately so: the same `modalBehavior` modifier drives `showModal()`/`close()`, the same `cancel`-preventDefault keeps `@open` authoritative, and the same `target === currentTarget` test detects a `::backdrop` click. Learning one teaches the other.

Two non-obvious points. **Sizing is a CSS custom property, not an arg.** `--pretui-drawer-size` sets width for `start`/`end` (default `360px`, clamped to `100vw - 48px`) and max-height for `bottom` (default `420px`, clamped to `80dvh`). This is the kit's component-owned-knob convention: consumers set the property on any ancestor rather than reaching in with `:deep()`. **The inner shell is a three-row grid** (`auto 1fr auto`) with `overflow-y: auto` on the body only, so a long list scrolls under a pinned title and footer — the behaviour you almost always want and the thing hand-rolled drawers get wrong.

Placement is logical, not physical: `start`/`end` follow writing direction, so an RTL season mirrors for free.

## Prior art

**Web Awesome `wa-drawer`** is the direct lineage — `open`, `label`, `placement` (`top|end|bottom|start`), `without-header`, `with-footer`, `light-dismiss` — and it exposes its focus-trap utility as a `modal` property so callers can temporarily disable trapping. **Radix** has no drawer; the community uses Vaul, which adds drag-to-dismiss, velocity-based snapping and snap points over a `Dialog`. **React Spectrum** treats it as `DialogTrigger type="tray"`, i.e. a responsive presentation of the same dialog.

Pretui's departures:

- **No `top` placement.** Web Awesome has four; Pretui ships three. A top drawer collides with system UI and app chrome and reads as a banner, not a surface. Dropping it is a taste call, not an omission.
- **Native top layer instead of a JS focus trap.** Everything Web Awesome's `modal` utility maintains — trapping, stacking, inertness — comes from `showModal()` here, so there is no trap to disable and nothing to leak.
- **Corner radius follows the docked edge.** `end` rounds only its leading corners, `bottom` only its top pair. Small, but it is the difference between "panel attached to the viewport" and "floating box that happens to be flush".
- **Motion is `@starting-style`, per-placement.** Each placement declares its own entry transform (`translateX(±24px)` / `translateY(24px)`), so direction is encoded in CSS state rather than computed in JS, and `prefers-reduced-motion` collapses to the end state.

Pretui does _not_ attempt Vaul's drag-to-dismiss. That is the visible feature gap versus the best-in-class mobile drawer.

## Accessibility

Governing pattern: APG **Dialog (Modal)** — a drawer is a dialog with geometry, and there is no separate pattern for it. Focus trap, Escape, `::backdrop`, inert background and stacking all come from `showModal()`.

Gaps, the same ones Dialog has and worth repeating rather than cross-referencing:

- **`@label` is the only labelling route.** A heading in `<:title>` is not wired via `aria-labelledby`; pass `@label` as well or the drawer is announced unlabelled.
- **No `aria-describedby`** for the body.
- **No initial-focus control** — the browser takes the first focusable descendant, which in a filter drawer is often a close button rather than the first control.
- **No `aria-modal` is set explicitly**; it is implied by `showModal()`, which is correct in current browsers but means the semantics disappear if a caller ever renders `<dialog open>` without `showModal()`.
- The scrolling body region has no `tabindex="0"`, so a drawer whose body is entirely non-interactive text cannot be scrolled by keyboard alone (WCAG 2.1.1). Worth fixing.
- `@dismissible={{false}}` produces a genuine keyboard trap if the caller does not provide another exit. That is by design, but it is the caller's obligation to supply one.

## Theming

`--card`, `--foreground`, `--pretui-shadow-overlay`, `--pretui-overlay-scrim`, `--radius-surface`, `--pretui-drawer-size`, `--font-sans`, `--text-body`, `--text-heading`, `--weight-heading`, `--track-heading`, `--space-3/4/6`, `--border`, `--muted-foreground`, `--leading-body`. A season that wants a wide inspector sets `--pretui-drawer-size` at the layout root rather than overriding the component. Note the drawer has no `--radius-surface` on its docked edge by construction, so a season with a very large radius will look asymmetric by intent, not by accident.

## React ecosystem

This **is** shadcn `Sheet`, MUI/Ant `Drawer`, wa-drawer. Agents will
pass `side` (`top|right|bottom|left`); Pretui uses `@placement`
(`start|end|top|bottom` — physical `left/right` should map through
direction).

| shadcn Sheet / MUI Drawer                  | Pretui Drawer                 |
| ------------------------------------------ | ----------------------------- |
| `side`                                     | @placement (prefer start/end) |
| SheetTrigger / SheetContent                | trigger + panel               |
| SheetHeader / Title / Description / Footer | named blocks                  |
| `open` / `onOpenChange`                    | same                          |
| `modal`                                    | default true                  |

- [ ] Accept `side` as an alias of `@placement`.
- [ ] Mention SlideOver / shadcn Sheet in the isolated header (brief already does).
