## What it is

A dropdown command menu at OS parity: a trigger you supply, and a floating panel built from a plain data tree. Reach for it when a surface has more actions than fit as visible buttons — row overflow menus, a "more" button on a Toolbar, contextual commands on a card, an application menu under a Menubar.

It is a _command_ surface, not a value picker: activating an item runs a function and closes the panel. Toggle and radio items are the exception and exist because every desktop menu has them — a checkmark on "Show Sidebar" is a command that reports its own state, not a form control. If you need to choose a value, use **Select**; for a filterable value list, **Combobox** or **Lookup**; for a panel of arbitrary content rather than a list of commands, **Popover**.

The same node tree drives **CommandPalette** (⌘K) and **Menubar**. That is deliberate: one tree, three surfaces, so an application's command set is authored once and every surface stays in sync.

## The contract

`@items` is a `MenuEntry[]`, where `MenuEntry` is `MenuNode | '---'`. `MenuNode` is a discriminated union of five shapes:

- **`CommandNode`** — the ordinary item. `{ label, kbd?, icon?, destructive?, disabled?, onSelect? }`.
- **`ToggleNode`** — carries a `checked` state of `'on' | 'off' | 'mixed'`, rendered with `role="menuitemcheckbox"`.
- **`RadioNode`** — one of a mutually-exclusive set, `role="menuitemradio"`.
- **`SubmenuNode`** — nests a further `MenuEntry[]`. Arbitrary depth.
- **`SectionNode`** — a labelled group, which is how you get a heading rather than a bare rule.

`MenuItemSpec` is retained as an alias for `CommandNode`, so **every pre-rebuild `@items` array remains valid unchanged** — the old `{ label, kbd?, destructive?, disabled?, onSelect? }` objects and the `'---'` separator literal both still work.

Open state is **controllable**: pass `@open` and `@onOpenChange` to drive it, or omit both and the component owns it. The `:trigger` block is yielded `(open, toggle)` either way. `@onSelect` fires after any item activates, alongside that node's own handler; `select` closes the panel _before_ invoking the handler, so a handler that opens a Dialog does not race the menu's teardown.

Placement is `@align` (`'start' | 'end'`) for the common case, or `@placement` for full control. `@anchorElement` anchors the panel to something other than the trigger — that one argument is what lets a selection menu, a toolbar menu, and a context menu all be this same component.

`@hoverDelay` (default 110ms) and `@safeDelay` (default 300ms) tune the pointer behaviour described below. `@label` names the root panel; `@platform` forces shortcut rendering, which the docs pages use.

### Three decisions worth calling out

**Items are data, not children.** shadcn, Radix, and Web Awesome all model menu contents as child elements (`<DropdownMenuItem>`, `<wa-dropdown-item>`); Pretui takes a tree. That buys uniform row rendering, keyboard-hint alignment, and destructive styling with no per-call-site discipline — and it makes a menu trivially serializable, so a card can compute its own command set and hand the identical tree to the palette. The cost is that an item cannot contain arbitrary markup. The rebuild removed the sharp edge of that trade: submenus, checkable items, radio groups, and sections are now first-class node types rather than things you were told to use a different component for.

**The trigger is instrumented, not merely wrapped.** The component finds the focusable control inside the `:trigger` block and applies `aria-haspopup`, a live `aria-expanded`, and the APG arrow-key contract itself. A caller who wires only `{{on 'click' toggle}}` still gets the full keyboard contract. Web Awesome does something similar by stamping onto whatever native button it finds in the slot; Pretui does it and also owns the arrow keys.

**Disabled items stay focusable.** Every item uses `aria-disabled`, never the `disabled` attribute. This is a real defect the rebuild fixed, and it is the HIG behaviour: a disabled menu item must remain reachable so a user can discover _that_ the command exists and read its shortcut. An item removed from the tab order is an item the user cannot learn about.

## Prior art

**shadcn/Radix `DropdownMenu`** is the composition benchmark — roving focus, typeahead, `Sub`/`SubTrigger`, `CheckboxItem`, `RadioItem`, portalled with collision detection. **Web Awesome `wa-dropdown`** contributes the placement vocabulary (`placement`, `distance`, `skidding`) and the trigger-stamping idea. **boxel-ui `Menu`** is the direct lineage and also took an item array. **Apple's Human Interface Guidelines** supplied the item taxonomy and the four rules that are easy to miss; the accessible-menu project was read as a specification for the Menubar variant.

Where Pretui improves on all of them:

- **The safe triangle.** Moving the pointer diagonally from a submenu trigger toward the open submenu crosses sibling items on the way. Naïve implementations close the submenu the moment a sibling is hovered. Pretui defers a sibling's hover while the pointer is inside the triangle formed by the cursor and the submenu's near edge — the technique Amazon's mega-menu made famous. `@safeDelay` bounds it so a genuinely idle pointer still resolves.
- **Platform-correct shortcuts.** `parseShortcut` / `formatShortcut` / `ariaKeyShortcuts` render ⌘⌥⇧ on Apple and Ctrl+Alt+Shift elsewhere, and emit a correct `aria-keyshortcuts` string. The `Kbd` component is exported so the same rendering is reachable outside a menu.
- **Dismissal is a real focusable backdrop element**, not a `document` click listener — so focus containment and Escape behave under nested surfaces.
- **Timers are modifier-owned and one-shot.** The hover-intent and typeahead timers run through `OwnedTimers`, which clears every handle in its destructor. No re-arming timer, which is what keeps the component compatible with `await settled()` and therefore testable at all.

## Accessibility

`role="menu"` with `menuitem` / `menuitemcheckbox` / `menuitemradio` rows and `group` sections. Roving tabindex; ArrowUp/ArrowDown to move, ArrowRight/ArrowLeft to enter and leave a submenu (mirrored under RTL), Home/End, Escape to close the current level only, Tab to dismiss the whole stack. Typeahead buffers keystrokes to jump by label. `aria-expanded` on submenu triggers, `aria-checked` on toggles and radios including the `'mixed'` state, `aria-keyshortcuts` on anything with a `kbd`. Disabled items are `aria-disabled` and remain focusable, per the HIG rationale above. Focus returns to the trigger on close.

## Theming

Panel surface, border, and shadow come from the popover tokens; rows from the control tokens; the destructive tone from the season's destructive ramp. Check and submenu indicators are glyph-plus-position, not colour alone, so state survives greyscale and the screenshot test. No fixed dimensions — the panel sizes to its widest row with shortcuts right-aligned in their own column, so keyboard hints line up down the panel regardless of label length.

## React ecosystem

This is shadcn `DropdownMenu`, Radix DropdownMenu, wa-dropdown.
Right-click is **ContextMenu**. Persistent File/Edit is **Menubar**.
⌘K is **CommandPalette**. Same MenuNode tree for all four.

| React                                     | Pretui                                 |
| ----------------------------------------- | -------------------------------------- |
| DropdownMenu                              | this tile                              |
| ContextMenu                               | **ContextMenu** stub                   |
| Menubar                                   | **Menubar** stub                       |
| NavigationMenu                            | **NavigationMenu** stub — not commands |
| `onSelect`                                | node.action / @onAction                |
| CheckboxItem / RadioItem / Sub / Shortcut | MenuNode fields                        |
