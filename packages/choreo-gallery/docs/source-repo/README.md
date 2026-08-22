# glimmer-motion

framer-motion's React glue re-implemented for Glimmer on the unchanged `motion-dom` engine:
`{{motion}}`, `<Presence>` (AnimatePresence), `<LayoutGroup>`, `<ReorderGroup>`/`<ReorderItem>`, drag.
Fidelity is pinned by ports of framer-motion's own Jest suites and Cypress fixtures in `test-app`
(319 cases). See `packages/glimmer-motion/VENDORED.md` for the verbatim-copied engine pieces.

```
pnpm install && pnpm test
```
