# plot/ — Observable Plot, vendored

`index.js` is [Observable Plot](https://github.com/observablehq/plot) **0.6.17**
(licence **ISC**) bundled to a single self-contained ES module. Its
dependencies — `d3@^7.9.0`, `interval-tree-1d@^1.0.0`, `isoformat@^0.2.0` —
are inlined; no bare specifier survives, so the realm loader resolves the
whole thing from this one file.

The bundle is built with `--legal-comments=none`, so the notices ship beside it
instead, each verbatim from its npm package: `LICENSE` (Plot 0.6.17, ISC),
`LICENSE.d3` (d3 7.9.0, ISC), `LICENSE.interval-tree-1d` (1.0.4, MIT) and
`LICENSE.isoformat` (0.2.1, ISC).

Exported marks (the lean entry, not all of Plot):

    plot line lineY areaY barY barX rectY binX dot cell waffleY
    ruleY gridX gridY axisX axisY frame

Built with:

    esbuild lean.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --outfile=index.js

where `lean.js` is a single re-export line from `@observablehq/plot`.

## Two things to know before using it

- **Import is DOM-free; `plot()` is not.** Evaluating this module touches no
  DOM API (verified under Node), so it is safe anywhere in the realm graph.
  `plot()` itself needs `document` and must be called from a modifier or
  other browser context — never from a getter that the indexer might
  evaluate outside a rendering pass.
- **Plot ships no pie/donut/arc mark.** Radial work needs a different tool.

See `../components/chart.gts` for the Glimmer binding and the token-theming recipe.
