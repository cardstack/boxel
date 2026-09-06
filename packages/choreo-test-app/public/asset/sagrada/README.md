# Assets for the Sagrada film

The separately maintained `../sagrada-model.html` uses Three.js **0.185.1**,
vendored in `r185/` from the installed npm package. Both ES-module build
files and the upstream MIT license are included; no CDN request is needed.
This renderer requires WebGL2. Directional, hemisphere and ambient light
intensities retain the old legacy-light PI factor explicitly. Film shots
and score timing are not part of this renderer migration.

The façade pass is documented in `docs/sagrada-web-model.md` at the repo
root. `facade-craft.js` builds merged sculptural surface detail;
`relief-atlas.js` is an optional, on-demand height-field recipe. The
`textures/` files replace the old inline base64 table. This is still
a procedural interpretation, not a surveyed reconstruction.

`sagrada.html` beside this folder is GENERATED — by the scene's own repo,
`~/Projects/sagrada-familia`, with

    node build/build.mjs --lean <path to this test-app>/public/sagrada.html

Never hand-edit it; edit the parts there and rebuild.

Narration goes in `vo/<beat-id>.mp3`, one file per beat, as the Towers
film does; a missing file is silence. Photographs a beat names in
`photo.src` are resolved here, and the plate removes itself when a file
is absent. Nothing is downloaded: credits and licences are yours to
settle before any of it goes anywhere public.
