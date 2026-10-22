# photoswipe/ — PhotoSwipe, vendored

`index.js` is [PhotoSwipe](https://github.com/dimsemenov/PhotoSwipe) **5.4.4**
(core + the `lightbox` entry) bundled to a single self-contained ES module.
`style.ts` carries its stylesheet as a string — see "The CSS problem" below.

## Provenance

| | |
|---|---|
| **Source** | **npm**, `photoswipe@5.4.4`. |
| **Commit SHA** | n/a — built from the published tarball, not a git tree. |
| **Version** | 5.4.4 |
| **Licence** | **`MIT`**, read from the package's own `LICENSE` file, copied here verbatim as `LICENSE`. Copyright (c) 2014-2022 Dmitry Semenov, https://dimsemenov.com. |

The MIT notice clause requires the copyright notice to travel with the copy and
`--legal-comments=none` strips it out of the bundle, so `index.js` carries a
banner naming the version, the SPDX id and the copyright holder.

## Exports

```js
import { PhotoSwipe, PhotoSwipeLightbox } from './photoswipe/index.js';
```

- `PhotoSwipeLightbox` — the deferred-loading wrapper. Bind it to a gallery
  selector, `init()`, `loadAndOpen(index)`, `destroy()`.
- `PhotoSwipe` — the viewer itself, if you want to open without a gallery.

Built with:

    esbuild ps.js --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --banner:js="<the licence banner>" \
      --outfile=index.js

where `ps.js` re-exports `photoswipe` and `photoswipe/lightbox`.

- 73 KB minified, **19 KB gzipped**
- No bare specifier survives the bundle.

## The CSS problem, and how it is solved here

PhotoSwipe ships an ordinary stylesheet (`photoswipe/dist/photoswipe.css`) and
its own docs tell you to `import 'photoswipe/style.css'`. **That import fails
realm indexing outright** — the loader parses `.css` as JS. Glimmer's
`<style scoped>` is no help either, because PhotoSwipe appends its root to
`document.body`, outside every component subtree.

So both roads are closed and the stylesheet travels as a **string**:

- `style.ts` exports `PHOTOSWIPE_CSS`, a **verbatim** copy of the 5.4.4
  stylesheet inside a `String.raw` template. Verbatim on purpose: an upgrade is
  a re-copy, never a re-derivation.
- It also exports `PSWP_THEME_CSS`, a short Pretui overlay kept in a *separate*
  string so the verbatim copy never has to be hand-merged. PhotoSwipe declares
  every colour it uses as a `--pswp-*` custom property on `.pswp`, so the
  overlay only redeclares those properties — no `!important`, no selector
  fights, and dark mode follows the Pretui tokens for free.
- `media-lightbox.gts` installs both into `document.head` **once**, refcounted,
  and removes the `<style>` when the last `Lightbox` is destroyed. Refcounting
  rather than a module-level "install once" flag, because a leaked stylesheet
  between test modules is exactly the kind of state that makes one test file's
  failure depend on another's.

## Four things to know before using it

- **Import is DOM-free.** Evaluating this exact file under plain Node succeeds
  (the decisive test). PhotoSwipe is not a Web Component library, so there
  is no `customElements.define` at module scope to survive; the `new
  PhotoSwipeLightbox()` call is what needs a browser, and it happens in a
  modifier.
- **`destroy()` is mandatory.** `lightbox.destroy()` closes any open viewer,
  removes the delegated click listener and drops its DOM. Called from the
  modifier's destructor.
- **It already implements most of the dialog pattern.** PhotoSwipe 5 sets
  `role="dialog"` with `aria-modal`, traps Tab inside the viewer, closes on
  Escape, and — with `returnFocus: true`, its default — returns focus to the
  element that opened it. It does *not* lock page scroll permanently: the class
  it adds to `<html>` is removed on close, and it is removed by `destroy()`
  too, so a destroyed-while-open lightbox cannot strand the page.
- **`Date.now` (5) and `setTimeout` (11) appear in the bundle.** None run at
  import; they are open/close animation timing and gesture velocity. The
  determinism law is about realm module code the indexer evaluates.

## What is not in here

The optional plugins — `photoswipe-dynamic-caption-plugin`,
`photoswipe-video-plugin`, deep-linking — are separate packages and none is
vendored. Captions in Pretui's `Lightbox` are rendered by PhotoSwipe's own
`uiRegister` hook against the asset's own `alt`/`name`, so the caption plugin
is not needed.
