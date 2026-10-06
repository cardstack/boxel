## What it is

**The app navigation rail**: a collapsible column of nav items beside a card app's content, which folds to icon width, goes off-canvas, or becomes a drawer in a narrow pane. It is shadcn's most-copied layout block, rebuilt so it works without a mouse. The family is four components in one module:

- **Sidebar** is the rail itself.
- **SidebarTrigger** is the toolbar button that toggles it.
- **SidebarGroup** is a labelled section of the rail.
- **SidebarItem** is a nav row that survives the collapse to icon width.

Reach for a neighbour when you need something else:

- **PageScaffold** (also exported as **AppShell**) is the whole page frame: masthead, navigation, main, aside, footer.
- **Drawer** is a modal panel with no persistent rail.
- **Tabs** is navigation within a view.

## The contract

```
@open?, @defaultOpen?, @onOpenChange?, @persistKey?
@label?, @placement? ('start' | 'end'; left/right map), @collapsible? ('rail' | 'offcanvas' | 'none')
@width?, @railWidth?, @mobileWidth?, @mobile?, @mobileBreakpoint?
@shortcut?, @shortcutKey?, @bordered?
<:header> <:nav> <:footer> <:default>   — each yielded { open, collapsed, mobile }; nav and default add toggle, default adds controls
Element: HTMLDivElement

<SidebarTrigger @open @onToggle @controls @label? @size?>
<SidebarGroup @label? @hideLabel?>        — <:default> <:action>
<SidebarItem @label @href? @onClick? @active? @badge? @collapsed? @disabled?>   — <:icon>
```

**Collapse modes.** `rail` (the default) folds to icon width, and items keep their names with a tooltip. `offcanvas` slides the rail away entirely and removes it from the tab order and the accessibility tree with `visibility: hidden`. `none` pins it open and drops the handle.

**Controlled or not.** Pass `@open` to control it, or let it keep its own state with `@defaultOpen`. `@onOpenChange` reports every toggle either way.

**Persistence is opt-in and named.** With no `@persistKey` the rail touches no storage at all. With one, it writes the preference to `localStorage` and restores it on the next mount, and a stored value never overrides a controlled `@open`.

**The shortcut** (Cmd/Ctrl + `@shortcutKey`, default `b`) toggles the rail. It needs the modifier, it is ignored while focus is in a text field, and `@shortcut={{false}}` turns it off. It is owned by a modifier that removes it on teardown.

**Mobile is the pane, not the viewport.** The rail measures its own shell with a ResizeObserver and becomes a **Drawer** (native `<dialog>` top layer) below `@mobileBreakpoint`. A sidebar in a 400px pane folds whatever the window is doing, and `@mobile` forces either mode.

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

Where it is thinner: **no menu sub-components.** There is no `SidebarMenuSub` or skeleton rows. Nest SidebarGroups, and use **Skeleton** for loading. There is **no resizable width**; use **SplitPanes**.

## Accessibility

APG **Disclosure** for the toggle, on a named navigation landmark.

- **The rail is a `<nav>` named by `@label`.** The handle is a `<button>` in the tab order, with `aria-expanded` and `aria-controls` pointing at the rail, and a name that states the action. The tests assert the landmark, the wiring and that the name follows the state.
- **SidebarTrigger** carries the same `aria-expanded` and `aria-controls` from outside the rail.
- **Offcanvas collapse** removes the rail from the tab order and the tree. **Rail collapse** keeps each item's name and adds a tooltip. The tests assert both.
- **SidebarGroup** is a `role="group"` labelled by its heading. `@hideLabel` keeps the name while hiding the text, and no label means no dangling `aria-labelledby`. The tests assert all three.
- **SidebarItem** is a link with `aria-current="page"` when `@active` and `@href`, and a button otherwise. Disabled stays focusable and refuses to act, and a disabled link becomes a button, because a link can't be disabled. The tests assert all of these.
- **The shortcut** needs a modifier and ignores text fields, which the tests assert.
- **Mobile** is a **Drawer**: native focus trap, Escape and inert background.

## Theming

`--pretui-sidebar-width`, `--pretui-sidebar-rail-width`, `--pretui-sidebar-bg`, `--pretui-sidebar-track`, `--pretui-drawer-size` (mobile), `--pretui-selected` and `--pretui-primary-ink` (the active item), `--primary`, `--foreground`, `--muted-foreground`, `--border`, `--hover`, `--ring`, `--radius-chip`, `--control-h`, `--inset`, `--pretui-z-raised`, `--pretui-dur-morph` / `--pretui-ease-morph` (the width slide), `--pretui-dur-snap` / `--pretui-ease-snap`, the `--pretui-size-*` steps, `--font-mono`, `--track-eyebrow`, `--track-ui`, the `--text-ui-*` sizes and `--space-2` / `--space-3`.

Widths are args as well as tokens. The slide is dropped under reduced motion.

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
