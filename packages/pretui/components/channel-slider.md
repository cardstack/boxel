## What it is

One colour channel as a slider, with a live gradient track showing what moving it will do.

It is a building block of **ColorPicker** rather than a standalone control — reach for it when composing a colour tool, not when asking for a colour.

## The contract

```
@label (required)     — the channel's name
@valueText (required) — spoken text: a SENTENCE, not a number
@value, @min, @max, @step (all required)
@wrap?     — whether the value wraps at the ends
@track (required) — how to paint the track; a typed ChannelTrack spec, not a CSS string
@checker?  — show the alpha checkerboard behind the track
@disabled?
@onInput (required) — fires as the value moves
@onCommit? — called once when a gesture ends — where announcements belong
```

**`@track` is a typed spec rather than a CSS gradient string.** The caller describes the channel; the component builds the paint. A CSS string here would be caller text reaching a style attribute, and it would also put the gradient maths in every call site.

**`@valueText` is required and must be a sentence.** A hue slider announcing "212" is technically correct and useless; "hue 212 degrees, cyan" is what a listener can act on.

**`@wrap` exists because hue is circular** and the other channels are not — a hue slider that stops at 360 instead of rolling to 0 is wrong in a way a generic slider cannot know.

**`@onInput` and `@onCommit` are separate for a reason**: input fires continuously through a drag, commit fires once at the end, and an announcement belongs on the commit or it fires hundreds of times.

## Prior art

**hdr-color-input.**

Where Pretui is better: the typed track spec, and the separation of continuous input from gesture commit. Most channel sliders take a gradient string and fire one event, which leaves the caller either announcing on every pixel or not announcing at all.

Where it is thinner: no two-thumb range, no logarithmic channels, and no per-channel gamut warning — that lives on **ColorPicker**, which owns the whole colour.

## Accessibility

- **A real slider with a name and a value text.** The name is the channel; the value text is the sentence.
- **`@onCommit` is where announcements belong**, and calling it out in the contract is the component telling the caller where to put them.
- **The checkerboard is presentation** — it makes alpha legible for sighted readers, and the value text carries alpha for everyone else.
- **`@wrap` changes keyboard behaviour at the ends**, so arrowing past the end of a hue channel continues rather than stopping, which is what the underlying value actually does.
- **`@disabled` inerts the control** while leaving it announced.

## Theming

`--pretui-slider-track`, `--pretui-slider-thumb` and `--pretui-slider-h` — shared with every other slider-shaped control in the colour module — plus `--pretui-checker` for the alpha ground.

Sharing the three slider tokens across **ChannelSlider**, the sliders inside **ColorPicker** and **GradientEditor**'s stop controls is what keeps a colour tool reading as one instrument rather than as three widgets that happen to be adjacent.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
