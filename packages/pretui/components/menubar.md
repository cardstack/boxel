## What it is

A persistent application menu bar — File, Edit, View — always visible, over the same command tree **Menu** and **CommandPalette** render.

## The contract

```
@items (required) — exactly Menu's arg type: a SubmenuNode becomes a File/Edit/View
             menu, a CommandNode becomes a bare command in the bar. Sections and
             '---' carry no meaning at the top level and contribute no items
@label?      — accessible name for the bar. Default 'Main menu'. A page with more
             than one menubar needs these to differ
@onSelect?   — fires after any item activates, alongside the node's own handler
@hoverDelay? — ms of hover before a NESTED submenu opens. Default 110
@safeDelay?  — ms the safe triangle keeps deferring a sibling's hover. Default 300
@platform?   — force the shortcut platform
```

**One tree, three surfaces.** A command object written for **Menu** renders unchanged here and in **CommandPalette**. The taxonomy, row model, panel markup, stylesheet, shortcut faces, safe triangle, roving tabindex and type-ahead buffer are shared rather than rewritten.

**Top-level switching is never delayed; nested submenus are.** Once a menu is open, moving along the bar opens the next immediately — that is the platform behaviour. A bar that opened on hover would fire every time the pointer crossed the top of a window; one that kept a dwell delay after opening would feel broken. Hence `@hoverDelay` applying only below the top level.

**The safe triangle defers a sibling's hover** while the pointer is travelling diagonally toward an open submenu, which is what stops a menu closing under a moving pointer.

**Sections and separators are no-ops at the top level**, so one tree can carry structure that only matters in the panel.

## Prior art

**accessible-menu 4.4.0** (ISC, Nick Milton) — ported, not vendored. Its `menubar.js` and `_baseMenu.js` are the specification this follows, specifically their keyup state machine and the edge cases inside it.

Where Pretui is better: the shared tree across three surfaces, and the shortcut faces coming from **Kbd**, so accelerators are platform-correct without the command tree knowing where it is running.

Where it is thinner: no checkable top-level items, no dynamic enable/disable contract beyond what the node carries, and no window-level integration — this is a bar in a page.

## Accessibility

- **It follows the APG menubar pattern**, with the roving tabindex, type-ahead and keyup state machine taken from a specification rather than improvised.
- **`@label` must differ between bars.** The default is 'Main menu', and two of those on one page are indistinguishable in a rotor.
- **Shortcuts render through Kbd**, which means each announces its platform-neutral spelling rather than a run of glyphs.
- **The hover behaviour is pointer-only sugar.** Every path through the bar exists on the keyboard, and the delays affect neither.
- **The safe triangle is an accessibility affordance for motor control** as much as a polish detail: a submenu that closes because the pointer strayed a few pixels is unusable with a tremor.

## Theming

The panel stylesheet, shortcut faces and row model are **Menu**'s; the bar adds only its own strip.

Sharing the panel is the visible half of the shared-tree design — a command looks identical whether it was reached from the bar, a context menu or the palette.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
