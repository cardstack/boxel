# model-viewer/ — @google/model-viewer, vendored

`index.js` is [`<model-viewer>`](https://github.com/google/model-viewer) built
from source as a single self-contained ES module: GLTF/GLB loading, orbit
camera, environment lighting, animation and AR, as one custom element.

**Read `NOTICE` before touching this directory.** Apache-2.0 is not MIT: it
requires a statement of changes as well as an attribution notice, and this
bundle *is* a modified distribution.

## Provenance

| | |
|---|---|
| **Source** | A git checkout of [google/model-viewer](https://github.com/google/model-viewer). |
| **Commit SHA** | **`297ed2bd`** — `git describe --tags` reports `v4.3.1-12-g297ed2bd`, i.e. **12 commits after the v4.3.1 tag**, the count `NOTICE` and the `index.js` banner give. **10 of them change `packages/model-viewer/src`**; the other two are the version bump of the sibling packages (#5173) and a docs-deployment workflow fix (#5183), which ship nothing. Not a published release. |
| **Version** | `@google/model-viewer` **4.3.1** as declared, plus those 10 source commits. Bundled deps: **three 0.183.2** (MIT), **lit 3.3.3** (BSD-3-Clause), **@monogrid/gainmap-js 3.4.0** (MIT). |
| **Licence** | **`Apache-2.0`**, read from the checkout's own `LICENSE`, copied here verbatim. Each bundled dependency's licence is copied alongside as `LICENSE-three`, `LICENSE-lit`, `LICENSE-gainmap-js`. |

**Why the commit matters, concretely.** The ten source commits ahead of
the tag are not noise — they include *"fix: emit finished event for one time
animation"*, *"fix: apply orientation to extra-model elements"*, *"fix: don't
warn with 'Invalid repetitionCount value: 1'"*, *"Remove leftover debug
console.log statements"* and *"fix: enable Quick Look AR in third-party iOS
browsers"*. Bundling npm 4.3.1 would ship every one of those bugs, which is why this is built from a commit rather than the release.

- 1.01 MB minified, **292 KB gzipped** — by far the heaviest bundle in the
  realm, and unavoidable: it is a WebGL renderer. `media-model.gts` is the
  only module that imports it, so nothing else pays for it.

## The build

    esbuild src/model-viewer.ts --bundle --format=esm --minify \
      --line-limit=500 --legal-comments=none --tsconfig=<see below> \
      --outfile=out.js
    cat banner.js out.js footer.js > index.js

The sources were copied out of the checkout into a scratch directory beside a
`node_modules` holding `three@^0.183.0`, `lit@^3.2.1` and
`@monogrid/gainmap-js@^3.1.0`, so nothing was installed into, or changed in,
the user's checkout.

**A tsconfig is required and its absence is a silent trap.** model-viewer uses
**TypeScript experimental decorators** (`@property()` from lit). esbuild
without a tsconfig leaves `@xe({type:String})` in the output *without erroring*
— the bundle builds, looks fine, and throws `SyntaxError: Invalid or unexpected
token` the moment anything evaluates it. The tsconfig used is minimal:

```json
{ "compilerOptions": {
    "target": "es2017",
    "experimentalDecorators": true,
    "useDefineForClassFields": false } }
```

## The server-safe globals shim, and why it is temporary

Evaluating the plain bundle under Node throws — first `HTMLElement is not
defined`, then `document`, then `createTreeWalker`. model-viewer ships **no**
server-safe globals shim of its own (the import-under-Node test, and the point
on which Media Chrome and model-viewer differ most).

So the banner installs a small fake DOM and **the footer removes it again**:

```js
const __pretuiShim = typeof globalThis.HTMLElement === 'undefined';
if (__pretuiShim) { /* … install Node, Element, document, customElements, … */ }
/* … 1 MB of library … */
if (__pretuiShim) { for (const k of […]) delete globalThis[k]; }
```

Install-and-remove rather than install-and-leave, for a reason worth stating:
an ES module body runs synchronously top to bottom, so the footer has run
before any *other* realm module is evaluated. A permanent `globalThis.document`
would make every subsequent module in the realm believe it was running in a
browser — a far worse bug than the one being fixed, and one that would surface
somewhere else entirely. In a real browser the guard is false and the whole
thing is dead code.

Verified: the exact file in this directory evaluates clean under
`node --input-type=module`, exports `ModelViewerElement`, and leaves
`typeof document === 'undefined'` behind it.

## Exports

```js
import './model-viewer/index.js';                    // defines <model-viewer>
import { ModelViewerElement } from './model-viewer/index.js';
```

Also re-exported by the upstream entry, incidentally rather than usefully:
`CanvasTexture`, `FileLoader`, `Loader`, `NearestFilter` (three internals).

## Four things to know before using it

- **No stylesheet.** All of model-viewer's CSS lives in its shadow root.
  Theming is attributes and custom properties (`--poster-color`,
  `--progress-bar-color`, `--progress-mask`). There is no stylesheet to install.
- **It runs a render loop, and it stops it.** `disconnectedCallback` cancels
  the `requestAnimationFrame` loop and disconnects its observers, so Glimmer
  tearing the element down is enough — the same argument the Media Chrome
  README makes. `media-model.gts` still owns the element through a modifier,
  because the *listeners* it attaches are its own.
- **`reveal='manual'` + `dismissPoster()` is the no-autoplay path.** Left to
  itself the element starts loading and animating on its own; Pretui reveals
  only on an explicit action, which is also what makes the poster the reserved
  space rather than a flash of empty canvas.
- **`Math.random` (22) and `Date.now` (1) appear in the bundle.** None at
  module scope; they are three's uuid generation and frame timing. The
  determinism law is about realm module code the indexer evaluates.

## Audited counts in the bundle

**13 `requestAnimationFrame`, 13 `setTimeout`, 0 `setInterval`, 1 `Date.now`,
22 `Math.random`** — all behind the element's own lifecycle. (A raw grep of
`index.js` reports 15 for `requestAnimationFrame`: two of those are the shim's
own stub and its name in the teardown list, not library code.)

## What is not in here

`@google/model-viewer-effects` (the post-processing pass) is a separate package
and is not vendored.
