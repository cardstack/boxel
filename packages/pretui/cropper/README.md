# cropper/ — Cropper.js v2, vendored

`index.js` is [Cropper.js](https://github.com/fengyuanchen/cropperjs) **2.1.1**
bundled to a single self-contained ES module. v2 is a **Web Component** suite,
not the v1 jQuery-era class: importing this module defines eight custom
elements and you write them as plain tags in a `<template>`.

## Provenance

| | |
|---|---|
| **Source** | **npm**, `cropperjs@2.1.1`. |
| **Commit SHA** | n/a — built from the published tarball, not a git tree. |
| **Version** | `cropperjs@2.1.1`. It is a monorepo façade: the bundle also contains **`@cropper/element` 2.1.1**, **`@cropper/elements` 2.1.1** and **`@cropper/utils` 2.1.1**, all at the same version and all MIT under the same copyright. |
| **Licence** | **`MIT`**, read from the package's own `LICENSE` file, copied here verbatim as `LICENSE`. Copyright 2015-present Chen Fengyuan. |

## Exports

```js
import './cropper/index.js';                    // side effect: defines the elements
import { CropperSelection } from './cropper/index.js';  // types/instanceof only
```

Elements defined on import:

    cropper-canvas   cropper-image     cropper-selection  cropper-shade
    cropper-handle   cropper-grid      cropper-crosshair  cropper-viewer

Also exported: the element classes, the `ACTION_*` / `EVENT_*` constants, and
the geometry helpers (`getAdjustedSizes`, `multiplyMatrices`, …).

Built with:

    esbuild cr.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --banner:js="<licence banner + the HTMLElement shim>" \
      --outfile=index.js

where `cr.js` is `export * from 'cropperjs';`.

- 41 KB minified, **12 KB gzipped**
- No bare specifier survives the bundle.

## The one adaptation, stated rather than hidden

**Cropper.js fails the import-under-Node test as published, and the banner is what
fixes it.** Evaluating the plain bundle under Node throws
`ReferenceError: HTMLElement is not defined` — every element class is
`class … extends HTMLElement` at module scope, and unlike Media Chrome,
Cropper.js ships no server-safe globals shim. Since the realm indexer evaluates
modules outside a browser, that is a hard block, not a nuisance.

The banner therefore prepends exactly one line:

```js
if (typeof globalThis.HTMLElement === "undefined") { globalThis.HTMLElement = class {}; }
```

One line is genuinely enough, and it is worth knowing why: Cropper computes
`IS_BROWSER` from `typeof window !== 'undefined' && window.document !== undefined`,
and `$define()` — the only thing that would call `customElements.define` — is a
no-op when that is false. So under Node the classes are *declared* and nothing
else happens. The shim is inert in a browser (guarded by `typeof`), and it does
**not** fabricate a `window`, so `IS_BROWSER` stays honestly `false` outside a
browser instead of being tricked into `true`. Verified: the exact file in this
directory evaluates clean under `node --input-type=module`.

If Cropper.js ever gains its own shim, delete the banner line and re-verify.

## Four things to know before using it

- **No stylesheet.** Every element emits its CSS inside its own shadow root, so
  the CSS-import trap that PhotoSwipe has to work around does not arise. Theming crosses the shadow boundary through `theme-color`
  attributes and `--theme-color`.
- **Glimmer binds dynamic attributes through the property.** `movable={{''}}`
  sets `el.movable = ''`, which is falsy, so the element silently stays
  immovable. Bind Cropper's boolean attributes as `true | undefined` — this bit
  the media territory once already and Cropper has a dozen of them
  (`movable`, `resizable`, `rotatable`, `scalable`, `translatable`, `bordered`,
  `covered`, `centered`, `plain`, `background`, `outlined`, `zoomable`).
- **`cropper-selection` is the state.** Its `x/y/width/height` are in the
  image's own coordinate space, it fires `change` with them in `event.detail`,
  and `$toCanvas()` renders the crop to a `<canvas>` — that is the whole
  export path, no server round trip.
- **Its keyboard support is partial and Pretui adds the rest.**
  `cropper-selection` handles arrow keys when focused, but has no modifier
  step, no Home/End, no `role='slider'` semantics and no announced value.
  `media-cropper.gts` supplies those on top rather than forking the library.

## Audited counts in the bundle

**0 `requestAnimationFrame`, 3 `setTimeout`, 0 `setInterval`, 0 `Date.now`,
0 `Math.random`.** Cleanest of the four media libraries on this axis.
