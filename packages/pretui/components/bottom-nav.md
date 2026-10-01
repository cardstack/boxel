## What it is

**The mobile tab bar docked to the bottom of its pane**: three to five top-level destinations with an icon and a label each. Use it for the primary navigation of a card app on a narrow screen.

Reach for a neighbour when the job is different:

- **Tabs** switches content in the flow of a page.
- **Sidebar** is the desktop rail.
- **NavigationMenu** is a site's top navigation.

## The contract

```
@items ({ id, label, href?, badge?, badgeLabel?, disabled? }[])
@value?, @defaultValue?, @onChange? (id)
@label? (default 'Primary'), @position? ('sticky' | 'static'; default 'sticky')
<:icon as |item current|>
Element: HTMLElement (a <nav>)
```

**Navigation, not a widget.** It is a named `<nav>` landmark holding a list. Each item is a link when it has an `href`, and a button that reports `@onChange` when it doesn't. The current item is marked `aria-current="page"`. Button items default to the first. Link items wait for `@value`, because the component can't know the current page.

**Labels are always visible.** An icon-only bar makes every reader guess. MUI's `showLabels` defaults to false, and this refuses that default. A `badge` ("3", "New") sits by the label. The visible mark is hidden from assistive technology, and `badgeLabel` gives its meaning, so the item reads "Lots, 3 new" rather than a bare "3".

**Docked to the pane.** `position: sticky` at the bottom of the scroll container, not `fixed` to the viewport, because a card is rarely the viewport. The bar is padded with `env(safe-area-inset-bottom)` so it clears a phone's home indicator. `@position='static'` leaves it in flow.

A disabled item is shown dimmed, marked `aria-disabled` and refuses the change, and keeps its place. A disabled link keeps `role="link"` and a tab stop, so it doesn't drop out of the accessibility tree.

## Prior art

**MUI `BottomNavigation`** takes `value`, `onChange` and `showLabels`, with `BottomNavigationAction` children (`label`, `icon`, `value`). It is `position: static` by default and usually made `fixed` by the caller. **Ant Mobile `TabBar`** and **Chakra** recipes are similar. Most are built as tabs, with `role="tab"` semantics.

Where Pretui is better: **navigation semantics.** A bottom bar switches between destinations, so a `<nav>` with `aria-current` says that honestly. MUI's buttons announce nothing about which is current. **Labels are always on.** **Pane docking** needs no `position: fixed` workaround.

Where it is thinner: **no hide-on-scroll** and **no ripple**. For more than five destinations, use **Sidebar** or a menu. The component doesn't cap the count, but the layout crowds.

## Accessibility

No APG widget pattern. It is a navigation landmark with links or buttons.

- **A `<nav>` named by `@label`.** The tests assert the tag and the name.
- **`aria-current="page"`** marks the current item. The tests assert the default, a change, and controlled `@value`.
- **Links are `<a href>`, and buttons are `type="button"`,** so each works with its native keyboard behaviour. The tests assert both.
- **Disabled items** carry `aria-disabled="true"` and refuse, which the tests assert.
- **Icons are `aria-hidden`.** The label names the item.
- **Touch targets** are at least 3.5rem tall.

## Theming

`--pretui-bottomnav-bg` (default `--card`), `--pretui-bottomnav-current` (default `--primary`), `--border` (the top hairline), `--muted-foreground` and `--foreground` (items), `--destructive` (the badge), `--ring`, `--pretui-z-sticky`, `--font-sans`, `--text-ui-xs`, `--space-1` and `--space-2`.

The current indicator (a 2px bar at the top of the item) and the 3.5rem height are fixed.

## React ecosystem

| Agent types                                     | Give them                             |
| ----------------------------------------------- | ------------------------------------- |
| MUI `<BottomNavigation value onChange>`         | `<BottomNav @items @value @onChange>` |
| MUI `<BottomNavigationAction label icon value>` | an item `{ id, label }` + `<:icon>`   |
| MUI `showLabels`                                | always on                             |
| `sx={{ position: 'fixed', bottom: 0 }}`         | the default sticky docking            |
| Ant Mobile `<TabBar>`                           | `<BottomNav>`                         |
