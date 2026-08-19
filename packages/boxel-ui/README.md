## How to build this addon

Run these from `packages/boxel-ui`.

### `pnpm build`

Runs the rollup build that produces the consumable v2 addon format in `dist/`. Only publishing uses it (`prepack` runs this build); in-repo consumers such as the host resolve to `src/` directly via the package exports.

### Or... `pnpm start`

Serves the QUnit suite in `tests/` — there is no app entry at `/`, so go to `/tests/`. It takes vite's default port 4200, the same one the host app uses; with `strictPort` unset vite walks up until it finds a free port, so read the terminal for the URL rather than assuming.

For a headless run instead, `pnpm test` builds and drives the same suite via testem on a free port.

To browse components, run the ember-freestyle explorer: `cd docs-app && pnpm start`, then visit http://localhost:4220/. Note its `/tests` covers the explorer itself — the integration and unit files live in this package's `tests/`.

## CSS layers

`src/styles/global.css` declares the cascade order, lowest priority first:

```css
@layer vendor, reset, utilities, boxelComponentL1, boxelComponentL2,
  boxelComponentL3, boxelComponentL4;
```

The contract is **consumer > boxel-ui > vendor**. A consuming app's own
unlayered CSS beats every layer here, so apps override boxel-ui without
fighting specificity. A consumer's own *named* layers land above boxel-ui's
too: a layer name absent from the order statement joins the order at its
first appearance, which is after every declared layer — that is how
`packages/base`'s `baseComponent` layer outranks all four component tiers.

**The copy in `global.css` is not the one that takes effect.** Every app entry
repeats the same statement in an inline `<style>` at the top of `<head>`, and
that is the copy that decides the order — `packages/host/index.html`,
`packages/host/tests/index.html`, `tests/index.html`,
`docs-app/index.html`, and `docs-app/tests/index.html`. Change the order in one
place and you have to change it in all of them —
`bin/check-css-layer-order-sync.mjs` (run as part of `pnpm lint`) fails if any
copy drifts from `global.css`.

The duplication is not decorative. A layer's precedence is fixed by where its
name *first* appears, and in a bundled build that is not the order the source
files are written in: component `<style>` blocks are extracted into the CSS
bundle in JS module-graph order, which routinely puts them ahead of
`global.css`. esbuild then prunes any layer name from an order statement it has
already seen declared earlier in the bundle, so a statement that lands
mid-bundle is reduced to nothing and the layers keep whatever order they
happened to fall into. That is how `vendor` ended up outranking all four
component tiers. A statement in the document `<head>`, ahead of every
stylesheet link, is outside the bundle and cannot be reordered or pruned.

Three things to know when adding or editing component CSS:

**Pick a component tier by what you wrap: one tier above it, or L1 if you wrap
nothing.** The tiers are load-bearing, not decorative. A component that wraps
another and restyles it has to outrank it, because a wrapper passing its own
class onto the wrapped component's root collapses them onto a single element —
`CardHeader` renders `ContextButton` renders `IconButton` renders `BoxelButton`,
so one DOM node carries all four classes. They are single-class selectors of
equal specificity, so without the tiers they tie and source order decides, and
the inner component wins arbitrarily. Hence `button` is L1, `icon-button` L2,
`context-button` L3, `card-header` L4.

Note this is not yet true across the board — roughly half the components have
`<style>` blocks with no layer at all, and because unlayered styles win over
layered ones those components currently outrank the layered ones. Layer
anything you touch; the remaining sweep is tracked separately.

**Never leave a `@layer` block anonymous.** `@layer { … }` creates an unnamed
layer that can't appear in the order statement, and unnamed layers sort
*above* all named ones — so an anonymous block silently outranks everything,
which is the opposite of what the order above implies.

**Third-party stylesheets must be imported into the `vendor` layer**, via a
CSS `@import … layer(vendor)` in `global.css` — not a JS `import` in a
component. Unlayered author styles beat layered ones regardless of
specificity, so a vendor sheet that arrives unlayered can never be overridden
by a component rule. That is what made `--boxel-dropdown-background-color`
inert: `BoxelDropdown` set `background-color` inside a layer while
ember-basic-dropdown set it unlayered, so the documented hook did nothing.

A JS import such as `import 'ember-power-select/styles'` injects the CSS
unlayered and cannot be given a layer, so those imports belong in
`global.css` instead:

```css
@import url('ember-power-select/vendor/ember-power-select.css') layer(vendor);
```

## Notes on rebuild scripts

These scripts do not run as part of the build steps above and should be run when changes you have made dictate.

### `pnpm rebuild:icons`

Icon components in `src/icons/` are code-generated from the svg files in `raw-icons/`. This script also generates `src/icons.gts`, the module that re-exports the icons for consumers of this addon.

Run it when an icon is added, removed, updated, or renamed. Edit the svg in `raw-icons/` — never the generated `.gts`, which is overwritten.

Icons follow the lucide grid that `@cardstack/boxel-icons` uses: a `0 0 24 24` viewBox with the drawing inset two units per side, so every icon reads at the same optical size for a given `width`/`height`. An icon drawn edge-to-edge on a smaller box renders visibly larger than its neighbours.

### `pnpm rebuild:usage`

This script generates `src/usage.gts`, the module that re-exports the usage modules `docs-app` lists in its component explorer.

Run it when a usage file is added, removed, or renamed.
