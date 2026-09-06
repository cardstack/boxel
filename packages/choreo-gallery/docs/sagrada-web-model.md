# Sagrada web-model pass

## Scope and fidelity

This is a procedural interpretation, **not a surveyed or museum-grade
reconstruction**. No film shot definitions, timing or score were edited.
Nativity foliage remains original procedural artwork; narrative figures
are simplified and are not reproductions of the individual sculptures.
The projected Glory façade is not an as-built representation.

This pass adds curved Passion intrados, projecting sculpture ledges,
six smooth leaning supports with fan-shaped crowns and eighteen flared
upper bones terminating on the two sloping canopy rails,
larger Passion stone courses, layered Nativity botanical carving, correctly
outward-facing façade figures, a vertically oriented rose-window pane,
and Subirachs' numbered magic square.

## Web delivery

- Three.js 0.185.1, pinned local ES modules; WebGL2 required.
- Texture files are independently cacheable rather than base64 in the HTML.
  Only the two textures used by current materials are requested.
- Fine botanical relief is a 2 KB dynamic module, requested near a
  close-up. It generates one shared 1024 × 1024 linear height texture.
  This is roughly 5.3 MiB GPU storage with mipmaps, not a 2 KB GPU texture.
- A failed optional detail request retains the base materials. It does not
  reject model initialization. The debug API exposes detail state and a
  promise for deterministic capture: `__film.streaming()` and
  `await __film.detailReady()`.
- Existing close-up geometry is visibility-gated; it is **not** yet a
  spatially streamed mesh or compressed glTF LOD system.
- All added carving merges into campaign/material batches. More triangles
  still cost GPU work even when the batch count remains similar.

## Verify

Start the gallery on port 4202, then run:

```sh
node scripts/sagrada-model-review.mjs /absolute/path/to/baseline.html
pnpm --filter test-app build
git diff --check
```

The review script uses macOS headless Chrome/SwiftShader and captures 13
standard matching pairs plus an oblique column view from the model HTML,
never the film route. It checks 16
lighting/construction-year combinations, finite geometry attributes and
shader/runtime errors. It is not a native-GPU or mobile FPS benchmark.

## References and remaining acceptance gate

- [Official Nativity scenes](https://blog.sagradafamilia.org/en/nativity-scenes/)
- [Official Passion scenes](https://blog.sagradafamilia.org/en/meaning-passion-facade-sagrada-familia/)
- [Nativity photograph](https://www.espaciodelocio.es/Fotos/Catalunya/Barcelona/Barcelona19.jpg)
- [Passion photograph, Timothy Dignan, 2017](https://dignanstudio.com/2017-10-24-barcelona-spain-spire-church)
- [UPC documentation of the actual Nativity survey](https://cit.upc.edu/en/portfolio-item/sagrada_familia_3d/)

Photos are references, not embedded material maps. Different lenses and
construction dates preclude pixel-difference scores against these photos.
The authoritative UPC survey combines scanning, photogrammetry and
topography; the project page does not provide an openly downloadable mesh.
Two downloadable Sketchfab candidates inspected during this pass were
not acceptable substitutes (simplified façade / photographed scale model).
Neither was incorporated.

Before claiming museum fidelity: registered architectural views, correct
individual sculptures and inscriptions, measured façade depth, dated
construction-state validation, and native-device performance tests are
still required. More procedural ornament does not satisfy that gate.
