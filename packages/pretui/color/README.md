# color/ — colorjs.io, vendored

`index.js` is [colorjs.io](https://colorjs.io) bundled to a single
self-contained ES module.

## Provenance

|                  |                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Source**       | **npm** — `colorjs.io`                                                                                                               |
| **Version**      | **0.7.1**                                                                                                                            |
| **Licence**      | **MIT**, SPDX `MIT` — read from the package's own `LICENSE` file, copied here verbatim as `LICENSE`                                  |
| **Copyright**    | © 2021 Lea Verou, Chris Lilley                                                                                                       |
| **Runtime deps** | **none** — nothing else is inlined and no bare specifier survives, so the realm loader resolves the whole library from this one file |
| **Size**         | 52 KB minified, **22 KB** gzipped                                                                                                    |
| **Node-safe**    | **verified** — see below                                                                                                             |

`index.js` carries a one-line banner naming the version, the SPDX id and the
copyright holder, because the bundle is built with `--legal-comments=none` and
the MIT notice clause requires the notice to travel with the copy. The
`LICENSE` file beside it is the same notice in full.

> An npm build and a checkout build produce different bytes. This table is
> what distinguishes them; do not rebuild without updating it.

## Node-safety (the decisive test)

The realm indexer evaluates modules **outside a browser**, so the question that
decides whether a bundle may sit anywhere in the realm graph is whether it
evaluates under plain Node — not whether it _looks_ pure.

Verified against **the exact copy in this directory**, with `document`,
`window` and `customElements` all forced to `undefined`: the module evaluates,
registers its 17 colour spaces, and converts correctly. Nothing here touches a
DOM API at any point, at module scope or later — colorjs.io is pure
computation, and this confirms it rather than assuming it.

    node -e "globalThis.document=undefined; globalThis.window=undefined;
             import('./index.js').then(C =>
               console.log(C.serialize(C.to(C.parse('#ff0000'), C.OKLCH))))"
    # → oklch(62.796% 0.25768 29.234)

## Why vendored rather than ported

Colour-space conversion is the one part of a colour picker that must not be
hand-written. Getting OKLCH ↔ sRGB ↔ Display-P3 ↔ Rec. 2020 right, plus CSS
Color 4 gamut mapping, is a research project; colorjs.io is that research
project, written by the editors of the CSS Color specifications. The UI on top
is ported (Pretui idiom, Glimmer, scoped CSS, Pretui tokens); only the maths is
vendored.

## What is registered

The bundle is a **lean entry**, not the whole library — spaces are registered
explicitly, so the bundle carries only what Pretui's colour surfaces expose:

    xyz-d65  xyz-d50  srgb-linear  srgb  hsl  hsv  hwb
    oklab    oklch    lab   lch    p3-linear  p3
    rec2020-linear    rec2020      rec2100pq

Exported functions (the procedural `colorjs.io/fn` API, plus the space objects
by name):

    ColorSpace  parse  to  serialize  display  inGamut  toGamut  toGamutCSS
    getAll  setAll  get  set  clone  distance  deltaE
    contrastAPCA  contrastWCAG21  getLuminance  mix  range  steps

## Build

`lean.js` (below) built with:

    esbuild lean.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none \
      --banner:js="/*! colorjs.io v0.7.1 | SPDX-License-Identifier: MIT | Copyright (c) 2021 Lea Verou, Chris Lilley | https://colorjs.io | see ./LICENSE */" \
      --outfile=index.js

```js
// lean.js
import {
  ColorSpace,
  parse,
  to,
  serialize,
  display,
  inGamut,
  toGamut,
  toGamutCSS,
  getAll,
  setAll,
  get,
  set,
  clone,
  distance,
  deltaE,
  contrastAPCA,
  contrastWCAG21,
  getLuminance,
  mix,
  range,
  steps,
} from "colorjs.io/fn";

import sRGB from "colorjs.io/src/spaces/srgb.js";
import sRGBLinear from "colorjs.io/src/spaces/srgb-linear.js";
import HSL from "colorjs.io/src/spaces/hsl.js";
import HSV from "colorjs.io/src/spaces/hsv.js";
import HWB from "colorjs.io/src/spaces/hwb.js";
import OKLab from "colorjs.io/src/spaces/oklab.js";
import OKLCH from "colorjs.io/src/spaces/oklch.js";
import P3 from "colorjs.io/src/spaces/p3.js";
import P3Linear from "colorjs.io/src/spaces/p3-linear.js";
import REC2020 from "colorjs.io/src/spaces/rec2020.js";
import REC2020Linear from "colorjs.io/src/spaces/rec2020-linear.js";
import Lab from "colorjs.io/src/spaces/lab.js";
import LCH from "colorjs.io/src/spaces/lch.js";
import XYZ_D65 from "colorjs.io/src/spaces/xyz-d65.js";
import XYZ_D50 from "colorjs.io/src/spaces/xyz-d50.js";
import REC2100PQ from "colorjs.io/src/spaces/rec2100-pq.js";

for (let space of [
  /* …in dependency order… */
])
  ColorSpace.register(space);

export /* …everything above… */ {};
```

## Traps

- **`parse()` returns `{ spaceId, coords, alpha }`, NOT `{ space, … }`.**
  Everything else (`to`, `toGamut`) returns `{ space, coords, alpha }` with a
  ColorSpace _object_. Every consumer accepts either, so reading `.space` off a
  parse result yields `undefined` with no error — and every colour in the UI
  silently becomes null. Read `space?.id ?? spaceId`.

- **`toGamut()` MUTATES the colour it is handed.** Passing the same object as
  both the mapping input and the ΔE reference reports a distance of 0 for every
  clamp. Build two independent plain colours.

- **Non-finite coordinates are legal.** An achromatic colour has an undefined
  hue, which arrives as `NaN`. `NaN` renders as the literal text "NaN" in a
  template and poisons every comparison — coerce at the boundary.

- **`serialize({ precision })` counts SIGNIFICANT digits**, not decimals.

- **Do not add `preact/signals`.** Upstream `hdr-color-input` uses it; Glimmer's
  `@tracked` is this realm's reactivity and a second reactive system in the
  realm is a liability.

## Consumers

`color-engine.ts` is the ONLY module that imports this bundle. Everything
visual goes through the engine's typed, total, DOM-free API — in particular
`cssFor()`, which is the parse-and-reserialize guard that keeps caller strings
out of inline styles.
