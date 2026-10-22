# wavesurfer/ — wavesurfer.js, vendored

`index.js` is [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js)
**7.12.11** plus its **regions** plugin, bundled to a single self-contained ES
module.

## Provenance

| | |
|---|---|
| **Source** | **npm**, `wavesurfer.js@7.12.11`. |
| **Commit SHA** | n/a — built from the published tarball, not a git tree. |
| **Version** | 7.12.11 (and the regions plugin shipped inside that same package). |
| **Licence** | **`BSD-3-Clause`**, read from the package's own `LICENSE` file, copied here verbatim as `LICENSE`. Copyright (c) 2012-2023, katspaugh and contributors. |

BSD-3 carries **two** clauses that travel with a copy, not one: the copyright
notice must be retained (as MIT requires), **and** the third clause forbids
using the names of the copyright holder or contributors to endorse or promote
derived products. Both are restated in the banner at the top of `index.js`,
because `--legal-comments=none` strips the originals out of the bundle.

## Exports

```js
import WaveSurfer, { RegionsPlugin } from './wavesurfer/index.js';
```

- `default` / `WaveSurfer` — the engine class. `WaveSurfer.create({...})`.
- `RegionsPlugin` — `RegionsPlugin.create()`, then pass it in `plugins: []`.

Built with:

    esbuild ws.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --banner:js="<the licence banner>" \
      --outfile=index.js

where `ws.js` is:

```js
export { default } from 'wavesurfer.js';
export { default as WaveSurfer } from 'wavesurfer.js';
export { default as RegionsPlugin } from 'wavesurfer.js/dist/plugins/regions.esm.js';
```

- 57 KB minified, **17 KB gzipped**
- No bare specifier survives the bundle.

## Five things to know before using it

- **Import is DOM-free; `create()` is not.** Evaluating this exact file under
  plain Node succeeds and touches no DOM API (the decisive test — run it
  before trusting any future bundle). `WaveSurfer.create()` needs `document`,
  an `AudioContext` and a real container, so it must be built inside an
  `ember-modifier` and nowhere else.
- **`destroy()` is mandatory and it is enough.** `wavesurfer.destroy()` aborts
  the in-flight fetch, cancels its single `requestAnimationFrame` playback
  loop, disconnects its ResizeObserver, unsubscribes every emitter and removes
  the media element it created. The rAF ruling is satisfied by calling it from
  the modifier's destructor — which `media-wave.gts` does.
- **It creates its own `<audio>` unless you hand it one.** Pass
  `media: someAudioElement` to share an element with `MediaPlayer`; otherwise
  wavesurfer owns an element you never see. Either way the engine, not the
  caller, is responsible for tearing it down.
- **No CSS at all.** wavesurfer paints into a `<canvas>` inside a shadow root
  it creates itself, and its only visual knobs are constructor options
  (`waveColor`, `progressColor`, `cursorColor`, `barWidth`, `height`). There is
  no stylesheet to inline — the PhotoSwipe/Cropper CSS budget does not apply
  here. Because the options are read at construction time, Pretui resolves its
  tokens to concrete colours with `getComputedStyle` in the modifier and
  rebuilds when the theme changes.
- **`Math.random` and `Date.now` appear in the bundle** (1 and 4 occurrences —
  ids and playback timing). That is fine: the determinism law is about *our*
  module code being evaluated by the indexer, and none of this runs at import.
  Do not copy the pattern into realm source.

## Audited counts in the bundle

**1 `requestAnimationFrame`, 6 `setTimeout`, 0 `setInterval`, 4 `Date.now`,
1 `Math.random`.** All of them live behind `create()`.

## What is not in here

Only the **regions** plugin is bundled. `timeline`, `minimap`, `spectrogram`,
`hover`, `record` and `zoom` are all excluded; add one to `ws.js` and rebuild if
a component ever needs it. `Filmstrip` deliberately needs none of them.
