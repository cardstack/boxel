## What it is

The video skin over **MediaPlayer**: the same transport, wrapped in a `<figure>` so the picture and its caption are one thing to assistive technology.

It is a skin, not a rewrite. Every arg except `@kind` is forwarded straight through, and all three blocks are re-yielded. Reach for it whenever the media is video; reach for **MediaPlayer** directly only if you do not want the figure wrapper, and for **MediaViewer** when the kind is decided by the asset rather than by you.

## The contract

```
every MediaPlayer arg except kind — @src, @label, @poster, @placeholder,
  @aspectRatio, @tracks, @thumbnails, @transcript, @transcriptOpen,
  @captionsDefault, @chrome, @seekOffset, @autoHide, @loop, @muted,
  @preload, @crossOrigin, @quietStatus, @onSnapshot
@caption? — caption under the picture, rendered as a <figcaption>

<:overlay>, <:controls>, <:footer> — forwarded to MediaPlayer
```

**The kind is fixed to `'video'` and cannot be passed**, which is the whole difference between this and its base: the type omits that arg rather than accepting and ignoring it.

**The wrapper is a real `<figure>` with a real `<figcaption>`**, not a div with a styled line under it. That association is the reason to use this rather than laying out a caption yourself.

**The aspect ratio is reserved before the poster resolves.** Switching the source changes the box without a flash of collapsed layout — the defect the catalog sweep found three separate times in hand-rolled players, and the reason `@aspectRatio` has a default rather than being optional in practice.

## Prior art

**Vidstack** (MIT, web-components build) is the reference for this layer, over **Media Chrome** underneath. Both ship a video player; neither ships the figure/figcaption pairing, which is left to the caller and therefore usually skipped.

Where Pretui is better: the figure semantics come for free, and the reserved ratio is enforced rather than documented.

Where it is thinner: everything **MediaPlayer** lacks is lacking here too — no playlist, no quality selector, no chapters menu — and this layer adds no video-specific affordances of its own. There is no thumbnail-scrubbing UI beyond what `@thumbnails` gives Media Chrome, and no poster-to-first-frame transition.

## Accessibility

- **The `<figure>`/`<figcaption>` pairing is the point.** A caption laid out as a sibling paragraph is loose text; inside a figure it is the picture's caption, and assistive technology can say so.
- **`@caption` does not name the player.** The accessible name still comes from `@label`, forwarded to MediaPlayer. A video with a caption but no label is still an unnamed region — the caption is *about* the media, not the name *of* it.
- **Everything else is MediaPlayer's**: the polite live region that speaks only on failure, the seekable transcript as an APG disclosure, the `aria-current` cue, the status line whose glyph is hidden and whose text carries the meaning.
- **Captions need `@tracks`, and cross-origin track files need `@crossOrigin='anonymous'`** or the browser drops them with no error and no captions button.

## Theming

The figure adds `--text-ui-sm` for the caption and an 8px gap between picture and caption; everything else is **MediaPlayer**'s — `--pretui-media-aspect`, `--pretui-media-radius`, `--pretui-media-ink`, `--pretui-media-scrim`, `--pretui-destructive-ink`, `--pretui-shadow-card`, `--pretui-shadow-hairline`.

There is deliberately no video-specific token surface: a season that retunes the player retunes this with it, and a video that looked different from an audio player in the same season would be a bug.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
