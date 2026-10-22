// Pretui — AppShell: the Mantine / Ant Layout name for PageScaffold.
//
// Mantine AppShell and Ant Layout are the five regions PageScaffold already
// has — header, navbar, main, aside, footer — with the same landmarks, so
// AppShell is PageScaffold re-exported under that name, not a wrapper.
// A wrapper with Mantine's argument shape would be worse than none: Glimmer
// cannot conditionally forward a named block, so it would make PageScaffold
// emit empty <nav>, <aside> and <footer> landmarks for regions the caller
// never supplied. Collapse belongs to Sidebar inside the navigation block.
//
//   Mantine / Ant                       →  Pretui
//   ─────────────────────────────────────────────────────────────────────
//   AppShell.Header  / Layout.Header    →  <:masthead>
//   AppShell.Navbar  / Layout.Sider     →  <:navigation>, Sidebar inside it
//   AppShell.Main    / Layout.Content   →  the default block
//   AppShell.Aside                      →  <:aside>
//   AppShell.Footer  / Layout.Footer    →  <:footer>
//   AppShell.Section grow               →  a Stack cell with flex: 1
export { PageScaffold as AppShell } from './page-scaffold';
