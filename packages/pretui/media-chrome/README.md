# media-chrome/ — Media Chrome, vendored

`index.js` is [Media Chrome](https://github.com/muxinc/media-chrome) **4.19.2**
bundled to a single self-contained ES module. Licence **MIT**
(`SPDX-License-Identifier: MIT`), verified from the package's own `LICENSE`
file — copied here verbatim as `LICENSE`, because the MIT notice clause
requires the copyright notice to travel with the copy and the bundle is built
with `--legal-comments=none`. `index.js` also carries a short banner naming the
version, the SPDX id and the copyright holder.

- 179 KB minified, **43 KB gzipped**
- No bare specifier survives the bundle: the realm loader resolves the whole
  library from this one file, exactly like `plot/index.js`.

Built with:

    esbuild lean.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --banner:js="<the licence banner>" \
      --outfile=index.js

where `lean.js` is `export * from 'media-chrome';` — the package's own `index`
entry, which is already the lean one (the menu, extras and experimental
entrypoints are NOT included; see "What is not in here").

## What it gives you

Importing this module **defines the custom elements**. There is no `define()`
call to make and nothing to instantiate: after the import, the tags below are
plain HTML that Glimmer can write in a `<template>`.

    media-controller       media-container        media-control-bar
    media-play-button      media-mute-button      media-volume-range
    media-time-range       media-time-display     media-duration-display
    media-captions-button  media-fullscreen-button media-pip-button
    media-seek-backward-button  media-seek-forward-button
    media-playback-rate-button  media-loop-button  media-airplay-button
    media-cast-button      media-live-button      media-poster-image
    media-loading-indicator media-error-dialog    media-preview-thumbnail
    media-preview-time-display  media-preview-chapter-display
    media-text-display     media-tooltip          media-gesture-receiver
    media-chrome-button    media-chrome-range     media-chrome-dialog
    media-keyboard-shortcuts-dialog

The named JS exports (`MediaController`, `MediaPlayButton`, …, plus
`constants`, `timeUtils`, `t`) are the element classes. Pretui does not use
them directly — importing for the side effect is the whole integration:

```js
import './media-chrome/index.js';
```

## Five things to know before using it

- **Import is DOM-free — by design, not by luck.** Media Chrome ships
  `utils/server-safe-globals.js`, a document/customElements/ResizeObserver shim
  it swaps in when `window.customElements` is missing. Evaluating the bundle
  under plain Node succeeds and defines nothing, so it is safe anywhere in the
  realm graph — including under the indexer. (Verified by running the exact
  copy in this directory under `node --input-type=module`.) This is a genuine
  difference from most Web Component libraries, which throw on
  `customElements.define` outside a browser.
- **No side-effect CSS import.** Every element's stylesheet is emitted *inside*
  its own shadow root, so the `import 'x.css'` trap that breaks realm indexing
  does not arise here. Nothing to inline, nothing to inject into
  `document.head`. Theming is 100% custom properties (`--media-*`), which cross
  the shadow boundary for free.
- **The engine cleans up after itself.** `disconnectedCallback` on
  `media-container` clears its inactivity timeout, disconnects its
  ResizeObserver and MutationObserver and removes every listener;
  `media-time-range` stops its `RangeAnimation` (the library's single
  `requestAnimationFrame` loop, used only while media is playing). Because
  Glimmer destroys the elements when the template tears down, that runs
  without an `ember-modifier` wrapper — the rAF ruling is satisfied by the
  element lifecycle itself. Audited counts in the bundle: **1
  `requestAnimationFrame`, 7 `setTimeout` (six are 0 ms deferrals, one is the
  controls auto-hide), 0 `Date.now`, 0 `Math.random`.**
- **Styling reaches in through custom properties, never selectors.** Scoped CSS
  cannot cross a shadow boundary, so `--media-*` is the only channel — see
  `../components/media-player.gts` for the full Pretui token mapping. One exception worth
  remembering: rules in the outer tree that target a *slotted* light-DOM child
  (`media-control-bar`) beat the shadow root's `::slotted()` rules, whatever
  their specificity. That is how Pretui re-shows auto-hidden controls on
  `:focus-within`.
- **`autohide` is on by default and hides focusable controls.** Set
  `noautohide` on `media-controller` unless you want cinema behaviour; Pretui
  defaults to `noautohide` and only opts in when the caller asks.

## What is not in here

Deliberately excluded to keep the bundle at 43 KB gzipped:

- `media-chrome/menu` — the settings/captions/audio-track **menus**
  (`media-settings-menu`, `media-captions-menu`, …). `media-captions-button`
  toggles the default text track, which meets the accessibility floor; add the
  menu entry if per-track selection is ever needed.
- `media-chrome/extras` — `media-theme-*`, `<media-chrome-listbox>`.
- `media-chrome/experimental`.
- The React bindings (`media-chrome/react`) — unusable here in any case.

## Hotkeys the library already ships

Read off `media-controller.js`, so this is what actually happens, not what the
docs claim: **Space / k** play-pause, **m** mute, **f** fullscreen, **c**
captions, **← / j** seek back, **→ / l** seek forward, **↑ / ↓** volume,
**Shift+/ (?)** keyboard-shortcuts dialog. Seek and volume offsets are
attributes (`keyboardforwardseekoffset`, `keyboardbackwardseekoffset`,
`keyboardupvolumestep`, `keyboarddownvolumestep`); individual keys are opted
out through `hotkeys="noarrowleft nospace …"`, and `nohotkeys` disables the
lot. There is no page-seek hotkey — Pretui gets that from the native
`<input type=range>` inside `media-time-range`, where PageUp/PageDown move by
a large step for free.
