## What it is

**AppShell** is **PageScaffold** under the name Mantine uses (Ant calls it `Layout`). The export is the same component. Import it when a port already says AppShell; the **PageScaffold** writeup carries the depth. The five named regions Mantine AppShell and Ant Layout lay out, header, navbar, main, aside and footer, are the regions PageScaffold already has, with the same landmarks.

A thin wrapper with Mantine's argument shape was considered and deliberately not shipped. Glimmer cannot conditionally forward a named block, so a wrapper would make PageScaffold emit empty `<nav>`, `<aside>` and `<footer>` landmarks for regions the caller never supplied, which is worse than no wrapper. The full reasoning is at the top of `components/app-shell.gts`.

## The contract

```
@preset?, @label?, @navLabel?, @asideLabel?
@navWidth?, @asideWidth?, @maxWidth?
@stickyMasthead?, @divided?, @skipLink?
<:masthead> <:subhead> <:navigation> <:default> <:aside> <:footer>
Element: HTMLDivElement
```

Identical to PageScaffold. Each region renders only when its block is supplied.

## Prior art

**Mantine `AppShell`** takes `header`, `navbar`, `aside` and `footer` config objects (`height`, `width`, `breakpoint`, `collapsed`) with `AppShell.Header`, `.Navbar`, `.Main`, `.Aside`, `.Footer` and `.Section` children. It injects its layout config as a stylesheet on every render. **Ant `Layout`** has `Header`, `Sider`, `Content` and `Footer`.

The mapping: Mantine's `AppShell.Header` is the `<:masthead>` block, `.Navbar` is `<:navigation>` (with **Sidebar** inside it for a collapsible rail), `.Main` is the default block, `.Aside` is `<:aside>` and `.Footer` is `<:footer>`. `AppShell.Section grow` is a **Stack** cell with `flex: 1`. Collapse belongs to **Sidebar**, not to the frame.

## Accessibility

Identical to PageScaffold. Each region is its landmark, `<header>`, `<nav>`, `<main>`, `<aside>` or `<footer>`, named by `@label`, `@navLabel` and `@asideLabel`, and rendered only when supplied, so there are no empty landmarks. `@skipLink` adds a **SkipLink** to the main region, and `<main>` takes `tabindex="-1"` so the skip moves focus, which neither Mantine nor Ant does.

## Theming

Identical to PageScaffold: `--pretui-page-nav-width`, `--pretui-page-aside-width`, `--pretui-page-gap`, `--pretui-page-column-gap`, `--pretui-page-bg`, `--pretui-page-radius`, `--pretui-page-shadow` and `--pretui-page-sticky-top`, with the boxel `--boxel-layout-*` values as fallbacks.

## React ecosystem

| Mantine / Ant                      | Pretui                                   |
| ---------------------------------- | ---------------------------------------- |
| `<AppShell.Header>` / Ant `Header` | `<:masthead>`                            |
| `<AppShell.Navbar>` / Ant `Sider`  | `<:navigation>`, with **Sidebar** inside |
| `<AppShell.Main>` / Ant `Content`  | the default block                        |
| `<AppShell.Aside>`                 | `<:aside>`                               |
| `<AppShell.Footer>` / Ant `Footer` | `<:footer>`                              |
| `navbar={{ collapsed }}`           | **Sidebar**'s `@open` / `@collapsible`   |
| `AppShell.Section grow`            | a **Stack** cell with `flex: 1`          |
