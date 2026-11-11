## What it is

**The app navigation rail**: a collapsible column of nav items beside a card app's content, which folds to icon width, goes off-canvas, or becomes a drawer in a narrow pane. It is shadcn's most-copied layout block, rebuilt so it works without a mouse. The family is four components in one module:

- **Sidebar** is the rail itself.
- **SidebarTrigger** is the toolbar button that toggles it.
- **SidebarGroup** is a labeled section of the rail.
- **SidebarItem** is a nav row that survives the collapse to icon width.

Reach for a neighbor when you need something else:

- **PageScaffold** (also exported as **AppShell**) is the whole page frame: masthead, navigation, main, aside, footer.
- **Drawer** is a modal panel with no persistent rail.
- **Tabs** is navigation within a view.

## The contract

```
@open?, @defaultOpen?, @onOpenChange?, @persistKey?
@label?, @placement? ('start' | 'end'; left/right map), @collapsible? ('rail' | 'offcanvas' | 'none')
@width?, @railWidth?, @mobileWidth?, @mobile?, @mobileBreakpoint?, @railBreakpoint?
@shortcut?, @shortcutKey?, @bordered?
@scroll? ('page' | 'content'), @resizable?, @minWidth?, @maxWidth?
<:header> <:nav> <:footer> <:default>   — each yielded { open, collapsed, mobile }; nav and default add toggle, default adds controls
Element: HTMLDivElement

<SidebarTrigger @open @onToggle @controls @label? @size?>
<SidebarGroup @label? @hideLabel?>        — <:default> <:action>
<SidebarItem @label @href? @onClick? @active? @badge? @collapsed? @disabled? @icon?>   — <:icon> <:action>
```

**Collapse modes.** `rail` (the default) folds to icon width, and items keep their names with a tooltip. `offcanvas` slides the rail away entirely and removes it from the tab order and the accessibility tree with `visibility: hidden`. `none` pins it open and drops the handle.

**Controlled or not.** Pass `@open` to control it, or let it keep its own state with `@defaultOpen`. `@onOpenChange` reports every toggle either way.

**Persistence is opt-in and named.** With no `@persistKey` the rail touches no storage at all. With one, it writes the preference to `localStorage` and restores it on the next mount, and a stored value never overrides a controlled `@open`.

**The shortcut** (Cmd/Ctrl + `@shortcutKey`, default `b`) toggles the rail. It needs the modifier, it is ignored while focus is in a text field, and `@shortcut={{false}}` turns it off. It is owned by a modifier that removes it on teardown.

**Mobile is the pane, not the viewport.** The rail measures its own shell with a ResizeObserver and becomes a **Drawer** (native `<dialog>` top layer) below `@mobileBreakpoint`. A sidebar in a 400px pane folds whatever the window is doing, and `@mobile` forces either mode.

**The rail can follow the pane too.** `@railBreakpoint` (px, opt-in) adds a third band on the same measurement: at or above it the rail is full, between `@mobileBreakpoint` and it the rail folds on its own (to icons with `@collapsible='rail'`, away with `'offcanvas'`), below `@mobileBreakpoint` it is a drawer. A manual toggle wins while the pane stays in its band; crossing into another band hands control back. The automatic change lands at once rather than sliding, so a narrow pane doesn't open with the rail sliding shut. Every later change slides, a controlled caller's own change to `@open` included. It fires `@onOpenChange`, so a controlled caller applies it by updating `@open`, and it is never written to `@persistKey`. Leaving the rail band needs 16px past the edge, so a pane resting on it does not flicker. A pinned rail ignores it, and unset, nothing changes. For a rail that folds in a narrow pane but never becomes a drawer, set `@mobileBreakpoint={{0}}`: `@mobile={{false}}` skips the measurement, bands and all.

**Fixed rail, content-only scroll.** `@scroll='content'` locks the shell to its container's height (fills a card or the viewport), keeps the rail in place and scrolls only the content pane (`overflow-y: auto`, `overscroll-behavior: contain`). The content element stays mounted across a collapse, so its scroll position survives. The default `'page'` lets the content grow to its own height, so whatever holds the shell scrolls, rail and all. The drawer mode is unchanged. With `@placement='end'` and `'content'`, the content's scrollbar runs along the seam, so the seam control (the resize seam or the plain toggle) keeps its whole 24px hit lane inside the rail instead of reaching over the scrollbar. The rail's head, body and foot pad their content clear of the lane, and the icon rail widens by the extra padding. A folded offcanvas rail has no width to hold a lane, so its toggle sits on the shell's edge, over the end of the content's scrollbar; the shortcut and a SidebarTrigger reopen it as well. This works with overlay scrollbars, which reserve no gutter. At the start, an open rail's body sets the seam's strip aside at its end, so the rail's own scrollbar sits beside the seam control rather than under it.

**Drag to resize.** `@resizable` turns the seam into a **ResizeHandle**: drag it, or press the arrow keys on it (Shift for four steps, Home folds, Enter resets to `@width`), to set the expanded width between `@minWidth` (default `12rem`) and `@maxWidth` (default `24rem`). The maximum also stays 3rem inside the pane, so a narrow pane keeps the seam in reach to drag back, and it is floored at the minimum either way. The separator's range starts at 0, meaning folded: dragging below `@minWidth` folds the rail, and a click that didn't move still toggles. While folded the seam is the plain toggle, and focus follows the swap: a fold or reopen from the seam leaves focus on the control that replaces it. With a controlled `@open`, focus follows when `@onOpenChange` updates `@open` in the same call. With `@collapsible='none'` the rail can't fold, so the range starts at `@minWidth` and a click does nothing. With `@persistKey` the width is stored beside the open state. A dragged width only changes the width: `@railBreakpoint` bands still fold and open the rail, and the width is held through them, as a manual toggle is. A resizable `@width`, `@minWidth` and `@maxWidth` must be px or rem; `@width` is clamped into the bounds, so the rail renders the width the separator announces. Until the seam moves, `@width` keeps the caller's unit (a rem width stays rem); only a width the bounds clamp, or a width set from the seam, is px. A stored width is only restored while `@resizable` is set. Keyboard resizes, like drags, follow at once rather than sliding; folding and opening slide, from the keyboard too. The slide animates how open the rail is (a registered custom property), not the width, which is why a width set from the seam needs no flag to skip it.

**Icon slot.** `SidebarItem @icon` takes an icon component (a boxel-icon) and sizes it to the icon box, whatever its own `width`/`height`, so a 24px icon sits centered on the label. `<:icon>` still yields as is, unsized, for callers that size their own glyph; a larger glyph stays centered in the icon box, on the label's center line and in the icon rail's square. Every row is at least one control height (`--control-h`), expanded or in the icon rail, so the hover and active background keep their height as the rail folds.

**Row action.** `<:action>` puts a control at the end of a row, such as an add or a menu button (shadcn's `SidebarMenuAction`). It renders beside the row's own link or button, never inside it, so it is its own tab stop. The row then carries the hover and active surface, so pointing at the action keeps the row lit. The icon rail drops it with the label. `@badge` takes a string or a number, and a count of 0 still shows.

**Everything is logical**, so RTL is a `dir` attribute, and the width slide lands on its end state under reduced motion.

## Prior art

**shadcn `Sidebar`** is 23 exports across 726 lines: Provider, Trigger, Rail, Group, Menu, MenuItem, MenuButton, MenuSkeleton and more. **Ant `Layout.Sider`** has `collapsible`, `collapsed`, `collapsedWidth`, `breakpoint` and `trigger`. **Mantine `AppShell.Navbar`** has `collapsed` and `breakpoint`.

Where Pretui is better:

- **The handle is keyboard reachable.** shadcn's rail button has `tabIndex={-1}`, and Ant's triggers are clickable divs with no role, so an Ant sider cannot be collapsed from the keyboard at all.
- **State is announced.** The rail is a named `<nav>`, and every control that toggles it carries `aria-expanded` and `aria-controls`.
- **No hidden cookie.** shadcn writes one on every toggle, unconditionally.
- **The mobile switch measures the pane.**
- **A collapsed rail is not tabbable.** Mantine only translates it off screen.
- **Every dimension is an arg or a token**, not a module constant.

Where it is thinner: **no menu sub-components.** There is no `SidebarMenuSub` or skeleton rows. Nest SidebarGroups, and use **Skeleton** for loading. Resizing is one rail's width only; for a group of panes use **SplitPanes**.

## Accessibility

APG **Disclosure** for the toggle, on a named navigation landmark.

- **The rail is a `<nav>` named by `@label`.** The handle is a `<button>` in the tab order, with `aria-expanded` and `aria-controls` pointing at the rail, and a name that states the action. The tests assert the landmark, the wiring and that the name follows the state.
- **SidebarTrigger** carries the same `aria-expanded` and `aria-controls` from outside the rail.
- **Offcanvas collapse** removes the rail from the tab order and the tree. **Rail collapse** keeps each item's name and adds a tooltip. The tests assert both.
- **SidebarGroup** is a `role="group"` labeled by its heading. `@hideLabel` keeps the name while hiding the text, and no label means no dangling `aria-labelledby`. The tests assert all three.
- **SidebarItem** is a link with `aria-current="page"` when `@active` and `@href`, and a button otherwise. Disabled stays focusable and refuses to act, and a disabled link becomes a button, because a link can't be disabled. A `<:action>` is a sibling of the row's control, not nested in it, so each is its own tab stop. The tests assert all of these.
- **The resize seam** (`@resizable`) is a focusable `role="separator"` with `aria-valuenow`, `aria-valuemin` (0, folded; `@minWidth` on a pinned rail), `aria-valuemax`, `aria-controls` and a name, "Resize <label>" (APG window splitter). Its hit area is 24px (44px on a coarse pointer) without widening the rail, and so is the plain toggle's. Where `@placement='end'` meets `@scroll='content'` both keep a 24px lane inside the rail, so the content's scrollbar keeps its own. The tests assert drag, keys, clamp and fold.
- **The shortcut** needs a modifier and ignores text fields, which the tests assert.
- **Mobile** is a **Drawer**: native focus trap, Escape and inert background.

## Theming

`--pretui-sidebar-width` (a resizable or dragged width overrides it inline), `--pretui-sidebar-rail-width`, `--pretui-sidebar-bg`, `--pretui-sidebar-track`, `--pretui-drawer-size` (mobile), `--pretui-selected` and `--pretui-primary-ink` (the active item), `--primary`, `--primary-ink` (the seam's hover line, the same on the resize seam and the plain toggle), `--boxel-border-radius-2xs`, `--foreground`, `--muted-foreground`, `--border`, `--hover`, `--ring`, `--radius-chip`, `--control-h`, `--inset`, `--pretui-z-raised`, `--pretui-dur-morph` / `--pretui-ease-morph` (the width slide), `--pretui-dur-snap` / `--pretui-ease-snap`, the `--pretui-size-*` steps, `--font-mono`, `--track-eyebrow`, `--track-ui`, the `--text-ui-*` sizes and `--space-2` / `--space-3`.

Widths are args as well as tokens. The slide is dropped under reduced motion, and for a change the pane's width made.

Sidebar, SidebarTrigger and SidebarGroup sit in `@layer PretComponent`. SidebarItem sits in `@layer PretComposite`, above Tooltip's `PretComponent` layer, so what it sets on Tooltip wins by layer order. A caller's unlayered CSS overrides all of them without a more specific selector.

## React ecosystem

| Agent types                                 | Give them                                    |
| ------------------------------------------- | -------------------------------------------- |
| shadcn `<SidebarProvider><Sidebar>`         | `<Sidebar>`; no provider                     |
| shadcn `<SidebarTrigger>`                   | `<SidebarTrigger @open @onToggle @controls>` |
| shadcn `collapsible="icon" \| "offcanvas"`  | `@collapsible='rail' \| 'offcanvas'`         |
| shadcn `SidebarGroup` / `SidebarGroupLabel` | `<SidebarGroup @label>`                      |
| shadcn `SidebarMenuButton isActive`         | `<SidebarItem @active>`                      |
| Ant `<Sider collapsible collapsed>`         | `<Sidebar @open>`                            |
| Ant / Mantine `breakpoint`                  | `@mobileBreakpoint` (measured on the pane)   |
| Ant `collapsedWidth` + `breakpoint`         | `@railBreakpoint` with `@collapsible='rail'` |
