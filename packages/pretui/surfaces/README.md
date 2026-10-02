# surfaces/ — the Cardstack surfaces bundles, vendored

Built ES modules of two Cardstack surface packages, copied in so Pret UI's
NodeCanvas and PageScaffold can import them by relative path. Only
host-provided modules (`@ember/*`, `@glimmer/*`, `@cardstack/boxel-ui`,
`ember-modifier`, `@floating-ui/dom`) stay external.

| Directory  | Package                  | Version         | Built (manifest)         | Used by      |
| ---------- | ------------------------ | --------------- | ------------------------ | ------------ |
| `canvas/`  | `@cardstack/boxel-canvas` | 0.1.0-alpha.0  | 2026-05-14T22:19:52.706Z | NodeCanvas   |
| `layout/`  | `@cardstack/boxel-layout` | 0.1.0-alpha.0  | 2026-05-14T22:19:53.000Z | PageScaffold |
| `grid/`    | `@cardstack/boxel-grid`   | 0.1.0-alpha.0  | 2026-05-14T22:19:52.862Z | Sheet        |

## Licences

- The Cardstack packages are MIT, under the repository's `LICENSE`.
- `canvas/` is a Glimmer port of xyflow (React Flow) and inlines
  `@xyflow/system@0.0.76`. Its MIT notice ships beside the bundle as
  `canvas/LICENSE.xyflow`, verbatim from the npm package.

## Notes

- Do not hand-edit or reformat the `index.js` bundles; they are
  build output. `lint-staged.config.mjs` and `.prettierignore` keep the
  autofix away from them.
- The canvas stylesheet is not imported from the bundle. A side-effect CSS
  import fails at realm indexing, so `../surfaces-canvas-css.ts` carries it as
  a string, and `../internal/surfaces-canvas.gts` injects it.
