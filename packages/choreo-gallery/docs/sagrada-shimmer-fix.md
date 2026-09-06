# Sagrada shader stability pass

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
