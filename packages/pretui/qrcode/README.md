# qrcode/ — the `qrcode` encoder core, vendored

`index.js` is the **encoder core** of
[node-qrcode](https://github.com/soldair/node-qrcode) bundled to a single
self-contained ES module. **21 KB min / 8.0 KB gzip.** Its one runtime
dependency reached by this entry — `dijkstrajs`, used for segment-mode
optimisation — is inlined; no bare specifier survives.

## Provenance

| | |
|---|---|
| **Source** | **npm registry** — `npm install qrcode@1.5.4` |
| **Why not a local checkout** | there is **no** `node-qrcode` checkout under `~/Projects` (checked). Local checkouts are preferred where they exist, because they are often ahead of the published release; here npm is the only source. |
| **Version** | `qrcode@1.5.4`, published release — so the version string alone identifies these bytes, and no commit SHA is needed |
| **Bundled dep** | `dijkstrajs@1.0.3` |
| **SPDX** | **MIT** (qrcode, Copyright (c) 2012 Ryan Day) and **MIT** (dijkstrajs, Copyright (C) 2008 Wyatt Baldwin) — both verified from the packages' own licence files |

Both licences are concatenated verbatim into `LICENSE`.
`--legal-comments=none` strips the notices out of the bundle, so the MIT notice
clause is satisfied by that file plus the one-line banner at the top of
`index.js`.

If a `node-qrcode` checkout is ever added under `~/Projects`, rebuild from it
and replace this table with source / commit SHA / `git describe` / tree state —
and note that an untagged commit is identified only by its SHA, not by any
published version.

**This replaces a runtime CDN import.** The two prior in-tree implementations
(`boxel-catalog/fields/qr-code/qr-code.gts` and the `catalog-source` copy) did
`import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm'` — a
third-party network fetch on every module load, which breaks offline, pins us
to jsDelivr's uptime, and is an unpinned supply-chain surface. Same library,
same version, now resolved from the realm.

## Exports

    create(data, options) -> QRCodeSymbol

That is the whole surface, deliberately:

    { modules: BitMatrix, version, errorCorrectionLevel, maskPattern, segments }

`options` accepts `errorCorrectionLevel` (`'L' | 'M' | 'Q' | 'H'`), `version`,
`maskPattern`, `toSJISFunc`. `BitMatrix` is `{ size, data, get(row,col), … }`.

Built with:

    esbuild lean-qrcode.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --banner:js="<licence banner>" --outfile=index.js

where `lean-qrcode.js` is `export { create } from '<pkg>/lib/core/qrcode.js';`

## Why only the core, and not `qrcode/lib/browser.js`

The upstream browser entry drags in the canvas renderer, the SVG-tag renderer,
a promise shim and the arity-sniffing callback API — and both renderers bake a
fixed colour and margin into a string we would immediately have to regex apart
(the CDN version did exactly that: it string-replaced `width=`/`height=` out of
the returned markup). Taking `create` instead gives us the module matrix and
lets `qr-code.gts` emit **one `<svg>` with one `<path>`**, so the quiet zone
lives in the `viewBox` where CSS cannot reach it, the accessible name is real
markup, and no HTML is ever assembled from a string.

## Three things to know before using it

- **Import is DOM-free and so is `create()`.** Evaluating this module and
  calling `create()` touch no DOM API (verified under plain Node). The bundle
  contains **zero** `setTimeout` / `setInterval` / `requestAnimationFrame` /
  `Date.now` / `Math.random` / `document.` / `window.` references — grep it.
  That makes `create()` legal in a `@cached get`, which is why `QrCode` needs
  no modifier at all.

- **It throws on overflow.** Data longer than the chosen version + error
  correction level can hold raises `The amount of data is too big to be stored
  in a QR Code`. Callers must catch; `qr-code.gts` renders an error state.

- **Empty string is not encodable** — `create('')` throws. Treat blank input as
  "nothing to show", not as an error.

## Reference vector

`create('HELLO WORLD', { errorCorrectionLevel: 'Q', version: 1 })` reproduces
the standard worked example (version 1, 21×21, mask pattern 6): three canonical
finder patterns, the alternating timing row, and the dark module at
`(4V + 9, 8)` set. The full 21×21 matrix is pinned as a golden fixture in
`qr-code.test.gts` so a future rebuild of this bundle cannot drift silently.

Consumer: `qr-code.gts`.
