## What it is

**A site's top navigation**: destinations as links, and some items that open a panel of more links (columns, descriptions, a featured card). This is information architecture, not a command menu.

Reach for a neighbour when the content is different:

- **Menu** holds actions.
- **Sidebar** is an app's rail.
- **BottomNav** is the mobile bar.
- **Breadcrumb** shows where you are.

## The contract

```
@items ({ id, label, href?, children?: { id, label, href, description? }[] }[])
@label? (default 'Main'), @value?, @onValueChange?
@openOnHover? (default true), @current?
<:panel as |item close|>   — replaces a panel's default link list
Element: HTMLElement (a <nav>)
```

**The disclosure navigation pattern, not the menu pattern.** A top-level item with an `href` is a real link. An item with `children` is a `<button>` with `aria-expanded` and `aria-controls`, and it shows a panel of real links. There are no `role="menu"` semantics to fight, and Tab moves through everything in order.

**Opening and closing.** A panel opens on click, Enter or Space, and on hover unless `@openOnHover={{false}}`. A click on a hover-opened panel pins it open, since a mouse always enters a trigger before it clicks. Only one is open at a time. It closes on Escape (focus returns to its button), on a press outside, when focus leaves the navigation, and, if it was opened by hover and not pinned, when the pointer leaves the navigation. A transparent bridge covers the gap above the panel, so the pointer never leaves on the way down. A hover-opened panel stays while keyboard focus is inside it.

**Current page.** `@current` names a link id. That link is marked `aria-current="page"`, and its parent's button is styled as current.

**Panels.** The default panel is a grid of links with optional descriptions. The `<:panel>` block replaces it with anything, and is yielded the item and a close action.

## Prior art

**Radix `NavigationMenu`** (and shadcn's) has Root, List, Item, Trigger, Content, Link, Indicator and a shared Viewport that animates between panels. **Mantine** composes `HoverCard` and `Menu`. **Ant `Menu mode="horizontal"`** uses menubar semantics for site navigation.

Where Pretui is better: **links are links.** Ant's horizontal Menu gives site navigation `role="menubar"`, so screen readers announce an application menu and arrow keys replace Tab. **Every way of closing** is covered and returns focus. **No viewport animation** to break under reduced motion.

Where it is thinner: **no shared animated viewport** or indicator between panels, and **no arrow-key movement** across the top level; Tab does it. There is **no mobile collapse built in**: below a breakpoint, render the same items in an **Accordion** or a **Drawer**.

## Accessibility

APG **Disclosure Navigation Menu**.

- **A `<nav>` named by `@label`.** The tests assert it.
- **Destinations are `<a href>`.** Panel triggers are `<button>` with `aria-expanded` and `aria-controls` pointing at the panel, and the panel is `hidden` while closed. The tests assert the tag of each, the pairing, and both states.
- **One panel at a time**, which the tests assert.
- **Escape** closes and returns focus to the trigger. A press outside closes it. Focus leaving the nav closes it. The tests assert Escape with focus return, and the outside press.
- **Hover never traps and never drops focus.** A hover-opened panel closes when the pointer leaves the navigation, unless focus is inside it. A click pins it. The tests assert the close, the pin and the kept focus.
- **`aria-current="page"`** on the current link, which the tests assert.

## Theming

`--popover`, `--popover-foreground`, `--pretui-shadow-raised`, `--radius-surface` (the panel), `--pretui-z-dropdown`, `--foreground`, `--muted-foreground` (descriptions), `--primary` (current), `--hover`, `--ring`, `--radius-control`, `--pretui-control-h`, `--pretui-dur-snap` / `--pretui-ease-snap` (the caret), `--font-sans`, `--text-ui-md`, `--text-ui-sm` and `--space-1` to `--space-4`.

The panel spans the navigation's width. The link grid's 12rem minimum column is fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                          | Give them                                     |
| ---------------------------------------------------- | --------------------------------------------- |
| Radix `<NavigationMenu.Trigger>` + `.Content`        | an item with `children`                       |
| Radix `<NavigationMenu.Link>`                        | an item or child with `href`                  |
| Radix `value` / `onValueChange`                      | `@value` / `@onValueChange`                   |
| shadcn `navigationMenuTriggerStyle()` custom content | `<:panel>`                                    |
| Ant `<Menu mode="horizontal">`                       | `<NavigationMenu>`, with links, not a menubar |
