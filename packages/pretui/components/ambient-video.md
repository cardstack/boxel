## What it is

A muted, inline, looping video that starts on its own while it is on screen: the hero loop, the product demo set into an article, the "background video" every marketing page has.

Reach for it when the motion is part of the page rather than something the reader chose to watch. For a video someone is actually watching, with sound and a scrubber, that is **VideoPlayer**. For a thumbnail that previews on hover, that is **HoverVideoPlayer**.

## The contract

```
@src (required)          — the clip; muted, so it should carry no audio worth hearing
@poster?                 — the still shown before the first frame and while paused
@label?                  — what it shows; given, the video is informative and names the figure
@fallback?               — an animated image (WebP, GIF) shown when autoplay is refused
@ratio?                  — aspect ratio reserving the box. Default '16 / 9'
@fit?                    — 'cover' (default) | 'contain'
@loop?                   — loop the clip. Default true
@load?                   — 'visible' (default) attaches near the viewport; 'eager' at once
@loadMargin?             — how far ahead to start loading. Default '800px 0px'
@threshold?              — visible fraction at which it plays. Default 0.25
@respectReducedMotion?   — start paused under prefers-reduced-motion. Default true
@respectSaveData?        — start paused, and fetch nothing, under Save-Data. Default true
@onStateChange?          — fires on every state change

<:overlay> — content laid over the frame: a title, a credit
```

The figure carries `data-state`, one of: `idle`, `loading`, `playing`, `paused`, `user-paused`, `reduced-motion`, `save-data`, `blocked`, `fallback`, `error`. `paused` is the page's pause (scrolled away, tab hidden). `user-paused` is the reader's, and scrolling never undoes it.

**It fetches nothing until it is near.** The source is attached only as the frame comes within `@loadMargin` of the viewport, so a phone does not spend its data on a clip at the bottom of a page nobody scrolls to. Use `@load='eager'` for a hero above the fold.

**It plays only while it can be seen.** Playback follows an IntersectionObserver at `@threshold` and the tab's visibility. A pause that happens while `play()` is still pending waits for it to settle, because pausing mid-request rejects it with AbortError.

**A refused autoplay is detected, not guessed.** Low Power Mode on iPhone and Safari's "Never Auto-Play" reject `play()` with `NotAllowedError`, even for muted video. That verdict, and only that one, moves the frame to `fallback` (if `@fallback` was given) or `blocked` (a centred play button). An `AbortError` is not a refusal.

**`muted` is set as a property.** The attribute only seeds the initial value when a parser creates the element. A framework-built video that carries the attribute can still be unmuted at `play()` time, and then it is refused.

**Under a service worker it plays from a `blob:` URL.** Safari cannot play media whose byte-range requests a service worker answers: the element fails with MediaError 4, which covers every page a worker controls, including published Boxel sites. When one is in control, the clip is fetched whole and played from a `blob:` URL, which no worker sees. Keep such clips small, a few MB, which an ambient loop should be anyway.

**A load failure is retried once**, then the frame settles on `error` with its poster and a centred play button that retries again.

## Prior art

**Apple's marketing pages** are the bar: their videos load ahead of the viewport, play inside a scroll window, detect Low Power Mode with a probe and fall back to a still end-frame, and carry a labelled play/pause button per video. **Webflow's Background Video** pauses under reduced motion and ships a WCAG 2.2.2 pause control. **Video.js `<background-video>`**, **Mux `<mux-background-video>`** and **next-video's BackgroundVideo** autoplay muted loops. **Cloudinary** plays "on scroll". **Vimeo `background=1`** autoplays with no pause control at all.

Where Pretui is better: it combines load-when-near, play-when-visible, an honest refused-autoplay state with an animated fallback, a pause the reader owns, reduced-motion and Save-Data defaults, and the service-worker workaround. No single one of those products does all of that.

Where it is thinner: one `@src` (no `<source>` list for AV1/HEVC/WebM, and no `media`-keyed sources per breakpoint), no adaptive streaming, and no page-wide autoplay probe to skip the download when autoplay is known to be refused.

## Accessibility

- **WCAG 2.2.2:** the clip loops, so there is always a pause control. It's a real `<button>` whose name says what pressing it will do ("Pause the campus map"), with `aria-pressed` while playing.
- **The video element is decorative.** It is out of the tab order and the accessibility tree; the figure carries the name (`@label`), and the button drives it, so there is one control, not two.
- **Reduced motion starts paused.** That covers first paint and a live change: turning the preference on mid-visit pauses it. The button still plays it, because the preference is about ambient motion, not about consent.
- **The fallback image moves too**, so it has the same pause. Paused, the frame shows the still poster.
- **Coarse pointers get a 44px control.**

## Theming

`--pretui-ambient-ratio` (from `@ratio`), `--pretui-ambient-radius` (default `0`: an ambient clip is usually full-bleed), `--pretui-ambient-ground` (behind the poster, default `--muted`), `--pretui-media-control` and `--pretui-on-neutral` for the control's scrim and ink, and `--ring` for focus.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
