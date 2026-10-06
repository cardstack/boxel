## What it is

A **Menu** opened by right-click, long-press, or the keyboard's own request (Shift+F10, the Menu key), anchored at the point it was asked for rather than at a button. Wrap the region the commands are about — a row, a card, a canvas — and hand it the same `MenuEntry[]` tree **Menu**, **Menubar** and **CommandPalette** take: one command object, four surfaces.

Use it when the commands belong to a thing the reader can point at and there is no room, or no wish, for a visible button. If there is a button, use **Menu**. If the commands are global, use **CommandPalette**. If a right-click should do one thing rather than offer several, it should not be a menu at all.

## The contract

```
@items                                       — the MenuNode tree, identical to Menu's
@open? @defaultOpen? @onOpenChange?          — the overlay contract
@onSelect?(node)                             — fires after any item activates, alongside the node's own onSelect
@label? (default 'Context menu')             — the root panel's accessible name
@focusable? (default true)                   — the region takes a tab stop
@longPressDelay? (seconds, default 0.5)      — touch
@hoverDelay? (ms, default 110)               — submenu hover intent
@safeDelay? (ms, default 300)                — how long the safe triangle defers a sibling
@platform? ('apple' | 'other')               — force the shortcut spelling
<:default as |open|>                         — the right-clickable region
```

**Nothing about `@items` is context-menu specific.** Commands, toggles with true/false/mixed, radio groups, sections, submenus, separators, `kbd` shortcuts, the `needsInput` ellipsis convention, `isDefault`, `destructive`, and dynamic Alt overlays all come from `menu.gts` — the taxonomy, the row transform, the panel markup, its whole stylesheet, the safe triangle, the roving tabindex and the type-ahead. A command object written for Menu renders here unchanged, which is the property that stops the four menu surfaces drifting apart.

**The region is the trigger, and it takes a tab stop by default.** Browsers fire `contextmenu` for Shift+F10 and the Menu key only on an element that can hold focus, so a menu on a bare `<div>` is pointer-only whatever it listens for. `@focusable={{false}}` opts out when the region already contains its own focusable rows and the menu should hang off those instead.

**It is anchored to a point.** The invocation point is materialised as a zero-size fixed span and measured by the same `anchorTo` every other Pretui overlay uses, so it flips and shifts near a viewport edge for free. A keyboard invocation has no pointer, so it anchors on the region's own box — its start edge, a little way down — never at the viewport origin.

**Long-press is one-shot.** Any movement, lift or cancel clears the handle and nothing re-arms it. The default is the platform long-press threshold on both mobile OSes.

**The wrapper is `display: contents`**, so the component does not disturb the layout it wraps. The region itself is a block, and the default block is yielded `open` so it can show a selected treatment while the menu is up.

## Prior art

**shadcn / Radix ContextMenu** mirrors DropdownMenu part for part — `Item`, `CheckboxItem`, `RadioItem`, `Sub`, `Separator`, `Shortcut`, `destructive` — anchored on a virtual reference at the pointer, with a 700ms long-press. **Base UI ContextMenu** is the same shape. **MUI** uses `Menu` with `anchorReference='anchorPosition'`. Agents will emit an `onContextMenu` handler with `preventDefault` and a `ContextMenuTrigger` wrapping the region.

Where this is better: **the keyboard path exists.** A right-click menu that can only be opened by right-clicking is a set of commands that do not exist for anyone using a keyboard. The region is reachable, Shift+F10 and the Menu key are handled explicitly (browsers disagree about the coordinates they report for them, and a menu pinned to the top-left corner is the usual symptom), a keyboard invocation focuses the first item as the APG asks, and dismissal puts focus back on the thing the menu was about rather than dropping it on the body. It is also **not a second menu engine**: Radix and Base UI ship a ContextMenu that duplicates DropdownMenu, and the two drift; this file contains only the anchoring, the gestures and the focus return.

Where it is thinner: no per-item components — the tree is data, so there is no `ContextMenuItem` to wrap a custom row in; no `modal` arg; and no way to keep the browser's own menu on an `<input>` inside the region, because `preventDefault` is applied to every `contextmenu` the region receives. Put text fields outside the region, or accept that their native cut/paste menu is replaced.

## Accessibility

Governing pattern: APG **Menu and Menubar**, with the menu surface itself supplied by `MenuPanel` (see **Menu** for the roles inside it).

What this component does, and the tests assert:

- **The region is in the tab order** (`tabindex='0'` through the roving-tabindex modifier) unless `@focusable={{false}}`, which takes it out of the tab order.
- **A right-click opens the menu displayed, focus untouched**, exactly as a platform menu does; the first Down or Home then moves focus onto the first item (Up or End onto the last) from wherever focus was. **Shift+F10 opens it with focus on the first item.** The two invocations are deliberately different, and both are asserted.
- **Arrow keys walk the rows, Home and End jump, Right opens a submenu onto its first item, Left closes it back to the parent, Enter activates.** Type-ahead comes from the shared buffer.
- **Escape closes one level at a time**, and the last one returns focus to the region. Activating an item closes everything and returns focus the same way.
- **A disabled row is present and skipped**, not removed.
- **Outside pointer and a right-click elsewhere close it**; a right-click inside the region while open re-anchors rather than stacking.
- **The root panel is named** by `@label`; each submenu panel is named by its parent row.

The caller's part: keep the region a thing, not the page. The tab stop and the accessible name are for a reader who lands on it and presses Shift+F10, so the region should be recognisable as the object of the commands. If the region already has focusable rows, turn `@focusable` off and let the menu hang off those. And put the destructive command last, behind a separator, with `destructive: true`; the flag is what makes it visually distinct, not its position.

## Theming

The region reads `--radius-surface` for its focus outline shape and `--ring` for the outline itself. Everything else — panel surface, border, shadow, rows, shortcut faces, the destructive tone, check and submenu indicators — is `MenuPanel`'s and follows **Menu**'s theming exactly. Nothing here has a knob of its own; a season that retunes Menu retunes this with it, which is the point of sharing the engine.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types | Give them |
| --- | --- |
| `ContextMenuTrigger` | the `<:default>` block — the region |
| `ContextMenuContent` / `Item` / `Sub` / `Separator` | the `@items` tree |
| `CheckboxItem` / `RadioItem` | `kind: 'toggle'` / `kind: 'radio'` nodes |
| `ContextMenuShortcut` | `kbd: 'Mod+O'` on the node; `@platform` fixes the face |
| Radix `onSelect` on an item | the node's `onSelect`, plus `@onSelect` for the component |
| `onContextMenu` + `preventDefault` | done for you — do not add another |
| MUI `anchorReference='anchorPosition'` | built in; the point comes from the gesture |
| a button that opens a menu | **Menu** |
| commands across the whole app | **CommandPalette** |
