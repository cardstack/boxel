# gridstack/ — gridstack.js, vendored

`index.js` is [gridstack.js](https://github.com/gridstack/gridstack.js) bundled
to a single self-contained ES module. gridstack has **zero runtime
dependencies**, so nothing had to be inlined and no bare specifier survives —
the realm loader resolves the whole engine from this one file.

## Provenance

| | |
|---|---|
| **Source** | local checkout, **not** npm |
| **Commit** | `d9c9bc41e73fd1a0164bf6760f2834269d0cf8af` (`git describe`: `v13.1.2-18-gd9c9bc41`, working tree clean, authored 2026-08-10) |
| **Version** | `package.json` says **13.1.2**; the commit is **18 ahead** of that tag |
| **Licence** | **MIT** (SPDX `MIT`) — verified by reading the repo's `LICENSE`: "MIT License / Copyright (c) 2019-2025 Alain Dumesny. v0.4.0 and older (c) 2014-2018 Pavel Reznikov, Dylan Weiss"; the full notice ships beside the bundle as `LICENSE` |
| **Size** | 87 KB minified / 24 KB gzipped |

Three commits land in `src/` between the tag and this one, and one of them is
directly load-bearing here: **`c1d0978d` "fix: detach resize-handle document
listeners on destroy before move threshold"** — a listener leak on the exact
teardown path this component drives from a modifier destructor. Bundling the
published 13.1.2 would have shipped that leak.

**The trade-off, stated:** an untagged commit does not correspond to any
published release, so "gridstack 13.1.2" is not enough to reproduce these
bytes. The SHA above is what makes it reproducible — never omit it, and
re-record it on every rebuild.

**No build step was skipped.** gridstack publishes TypeScript source in `src/`
and its npm `main` points at a webpack UMD build; the recipe below compiles
the TypeScript directly with esbuild, so bundling from a checkout needs
nothing the published package would have done for us. There was no fallback
to npm.

Exported (a lean entry — not gridstack's full `export *` surface):

    GridStack        the DOM grid: init, makeWidget, removeWidget, update,
                     save, column, cellHeight, margin, float, setAnimation,
                     batchUpdate, on/off, destroy
    GridStackEngine  the DOM-FREE layout engine: collision resolution,
                     packing, float, column re-flow
    Utils            gridstack's own helpers (kept for `Utils.getElement`)

Built with, from the checkout root:

    esbuild lean.ts --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --target=es2022 --outfile=index.js

where `lean.ts` is three re-export lines pointing at that checkout's
`src/gridstack`, `src/gridstack-engine` and `src/utils`.

## Six things to know before using it

- **Import is DOM-free.** Evaluating this module touches no DOM API (verified
  under plain Node: `dd-touch`'s `isTouch` probe is guarded by
  `typeof window !== 'undefined' && typeof document !== 'undefined'`), so it is
  safe anywhere in the realm graph. `GridStack.init()` needs `document` and may
  only be called from an `ember-modifier` or other browser context.

- **`GridStackEngine` runs headless.** `new GridStackEngine({column, float})`
  plus `addNode()` resolves collisions and packs with no DOM at all. That is
  what lets read-only mode and the unit tests share one layout truth with the
  interactive grid. Use it for anything that only needs coordinates.

- **The stylesheet is NOT bundled.** `src/gridstack.scss` is not imported by
  the TS sources, and a side-effect CSS import would fail realm indexing (the
  loader parses CSS as JS). The engine-required rules are restated in Pretui
  tokens in `../structure-dashboard-css.ts` and injected into `document.head`
  by a refcounted modifier. Only what the engine genuinely needs is kept —
  absolute positioning, the `--gs-*` variable contract, the placeholder and
  the resize handle. gridstack's own look (grey placeholder, grey SVG arrow
  handle, print rules, rtl loop, `!important` blocks) is dropped.

- **Timers are the engine's, and are owned.** gridstack schedules
  `setTimeout`s around drag/animation and one `requestAnimationFrame`
  auto-scroll loop while dragging; both are cancelled on drag end. Per the
  matrix's Appendix M.3 ruling, that is legal because the modifier that
  creates the instance calls `grid.destroy(false)` in its destructor.
  **Always pass `false`** — `destroy(true)` removes the container from the
  DOM, which is Glimmer's node.

- **`auto: false` at init is mandatory here.** Item elements already exist
  (Glimmer rendered them, and child modifiers install before parent ones), so
  letting gridstack auto-adopt `.grid-stack-item` children would race the
  explicit `makeWidget()` registration. See the DOM-ownership header in
  `../internal/structure-dashboard.gts`.

- **`_sortDom()` must be neutralised.** After every change gridstack
  re-`appendChild`s each item so DOM order matches visual order. There is no
  option for it, it moves nodes Glimmer owns and has bounds for, and moving a
  node blurs anything focused inside it — which killed the keyboard move path
  on its very first arrow key. `internal/structure-dashboard.gts` overrides the method
  per instance and says why; the render proof asserts focus survives an
  engine move, so a future upgrade cannot quietly undo it.

## Not wired

`acceptWidgets` / drag between grids, nested subgrids, `lazyLoad`,
`sizeToContent`, `removable` trash zones, `columnOpts` responsive breakpoints
(Pretui owns its own `ResizeObserver` so gridstack never installs one of its
own), and `GridStack.addGrid()` / `load()` markup generation — all of the
paths where gridstack would create or destroy DOM Glimmer believes it owns.
