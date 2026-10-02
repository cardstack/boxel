## What it is

An animated image — GIF, animated WEBP, animated PNG — that can actually be stopped.

Browsers expose no pause API for animated images, which is why almost every one on the web runs until the page closes. This component supplies the missing control, and it is the component to reach for whenever an animation is content rather than decoration.

## The contract

```
@src (required)   — source of the animated image
@alt (required)   — alternative text, describing the CONTENT
@playing?         — controlled playback; omit for uncontrolled
@defaultPlaying?  — initial playback; defaults to false under reduced motion, true otherwise
@onPlayingChange? — fires with the next playback state
@hideControl?     — hide the built-in control
```

**Pausing paints the current frame onto a canvas and lays it over the image.** That is what makes resuming frame-accurate rather than a rewind. The two common workarounds both lose the reader's place: reassigning `src` restarts the animation, and `display: none` discards it.

**It starts paused when the reader has asked for reduced motion.** Not merely pausable — paused, on first paint, without anyone touching the control.

**`@alt` must describe the content, not the medium.** "An animation of…" is what the control beside it already says.

**`@hideControl` is for callers supplying their own, and nothing else.** An animation with no pause affordance fails WCAG 2.2.2.

## Prior art

**Web Awesome's `wa-animated-image`** is the source — the same frozen-frame trick, re-cut on this kit's bones.

Where Pretui is better: **reduced-motion users get a still frame by default.** The upstream honours its own control but not the media query, so a reader who has asked the whole operating system for less motion still gets an animation until they find the button. That is the difference between a pause affordance and an accessible animation. The control is also the kit's own button with the kit's tone tokens rather than a bespoke shadow-DOM one, and `@onPlayingChange` lets a gallery coordinate several.

Where it is thinner: no scrubbing, no frame count, no loop count or "play once" mode, and no poster — the first paint is the image's own first frame, paused or not. There is also no lazy decode: the animated source loads whether or not it will play.

## Accessibility

- **WCAG 2.2.2 is the requirement this component exists to meet**: anything that moves for more than five seconds must be pausable. Hiding the control without replacing it re-breaks that.
- **Reduced motion is honoured at the default, not only at the control.** This is the part upstream skips, and it is the part that matters for a reader who never interacts.
- **The frozen-frame canvas is `aria-hidden`.** It is a visual stand-in for the image beside it and must not be announced as a second graphic.
- **The state change is announced through a polite `role='status'` line**, so pressing the control tells a screen-reader user what happened rather than leaving the change silent.
- **The control's accessible name follows the state** — it says what pressing it will do — and its glyph is `aria-hidden`, so the meaning is never carried by a symbol alone.
- **`@alt` is required by the type.** An undescribed animation is worse than an undescribed still, because the reader cannot even tell what they are missing.

## Theming

The control rides the kit's shared surface and shadow tokens — `--pretui-shadow-control` for the button, `--pretui-shadow-hairline` for the frame — rather than carrying a token surface of its own.

That is deliberate: an animated image should look like an image with a button on it, not like a media player. A season retunes the button everywhere and this follows, so the pause control here matches the controls on every other overlay in the product.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
