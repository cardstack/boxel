# surfaces/ — the Cardstack surfaces bundles, vendored

Built ES modules of two Cardstack surface packages, copied in so Pret UI's
NodeCanvas and PageScaffold can import them by relative path. Only
host-provided modules (`@ember/*`, `@glimmer/*`, `@cardstack/boxel-ui`,
`ember-modifier`, `@floating-ui/dom`) stay external.

| Directory  | Package                  | Version         | Built (manifest)         | Used by      |
| ---------- | ------------------------ | --------------- | ------------------------ | ------------ |
| `canvas/`  | `@cardstack/boxel-canvas` | 0.1.0-alpha.0  | 2026-05-14T22:19:52.706Z | NodeCanvas   |
| `layout/`  | `@cardstack/boxel-layout` | 0.1.0-alpha.0  | 2026-05-14T22:19:53.000Z | PageScaffold |

## Licences

- The Cardstack packages are MIT, under the repository's `LICENSE`.
- `canvas/` is a Glimmer port of xyflow (React Flow). It inlines
  `@xyflow/system@0.0.76` (MIT) and nine d3 packages: `d3-color@3.1.0`,
  `d3-dispatch@3.0.1`, `d3-drag@3.0.0`, `d3-ease@3.0.1`,
  `d3-interpolate@3.0.1`, `d3-selection@3.0.0`, `d3-timer@3.0.1`,
  `d3-transition@3.0.1` and `d3-zoom@3.0.0` (ISC; `d3-ease` is BSD-3-Clause
  for Robert Penner's easing equations). Their notices ship beside the bundle,
  verbatim from each npm package: `canvas/LICENSE.xyflow` and
  `canvas/LICENSE.d3`.
- `layout/` inlines no third-party package.

## Notes

- Do not hand-edit or reformat `canvas/index.js` or `layout/index.js`; they are
  build output. `lint-staged.config.mjs` and `.prettierignore` keep the
  autofix away from them.
- The canvas stylesheet is not imported from the bundle. A side-effect CSS
  import fails at realm indexing, so `../surfaces-canvas-css.ts` carries it as
  a string, and `../internal/surfaces-canvas.gts` injects it.
