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

## Material-first film grade

The model HTML now attenuates the film's authored looks at the final uniform
boundary. The shot list, camera paths, chapter timing and transition logic are
unchanged.

- Grain, chromatic aberration and milky black lift: off.
- LUT strength: 12% of the authored amount.
- Saturation, contrast and brightness deviations from neutral: 20%.
- Sepia, hue rotation and split-tone strength: 15%.
- Vignettes: 20%; paper wash: 30%; cloud overlay: 15%.
- HDR highlight handling, physical lighting, annotation dimming and seams: kept.

Before/after render checks use `SAGRADA_REVIEW_GRADE=1` with the model-review
script. This deliberately enables a strong stock, wash and grade so the comparison
tests the changed path rather than neutral inspection settings.

## Sagrada shader stability pass

The reported mobile shimmer affects more than grass. The stone bump shader
previously differentiated heights containing `fwidth`-based filtering. Nested
screen derivatives have undefined results; filtering now multiplies the slope
after the raw height derivatives are calculated. Masonry colour variation also
fades out with unresolved courses instead of retaining its unfiltered block hash.

Grass uses continuous alpha coverage and a derivative-based subpixel fade,
without temporal dithering, extra textures or a new full-screen pass. Thin blades
no longer receive shadow-map detail; the terrain still receives shadows.

The HDR target now selects a sample count supported by its actual attachment
format. The bundled Three.js r185 **does** retain `capabilities.isWebGL2`; that
flag was not the cause. The change avoids assuming that two-sample RGBA16F is
supported on every device.

Validation: run `scripts/sagrada-model-review.mjs` with the pre-fix HTML baseline.
It renders the whole model and close-ups, three nearby grass camera positions,
and all 16 year/theme combinations. Desktop software rendering is not a substitute
for a retest on the reporting iPhone's GPU. Shots and timeline are untouched.
