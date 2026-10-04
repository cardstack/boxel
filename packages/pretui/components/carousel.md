## What it is

A scroll-snap track with previous/next buttons, a dot strip, a keyboard path and a live status line.

It is composed **on** **Scroller** rather than beside it, so edge detection is not reimplemented here.

## The contract

```
@items (required) — the slides, yielded back in the caller's own row type
@label?      — accessible name for the carousel as a whole. Strongly recommended
@index?, @onIndexChange? — controlled index; the callback fires whenever the reader
             moves by ANY means — button, dot, keyboard, or their own thumb on the track
@loop?       — wrap past the ends instead of stopping. Default false
@hideControls? — hide the previous/next buttons. The keyboard path is unaffected
@hideDots?   — hide the dot strip. The status line is unaffected
@perView?    — slides visible at once. Default 1

<:slide> — one slide; receives the item and its zero-based index
```

**`@onIndexChange` fires for every means of moving**, including a thumb drag on the track. A carousel that only reports its own buttons leaves a controlled caller out of sync the moment someone swipes. The other direction holds too: a parent that sets `@index` itself scrolls the viewport to that slide.

**`@loop` defaults to false**, because stopping is the honest default when the control also disables itself at the end — a button that looks available and wraps is a different promise from one that stops.

**Hiding a control never hides the path behind it.** `@hideControls` leaves the keyboard working; `@hideDots` leaves the status line. The affordances are presentation; the paths are not.

**There is no autoplay**, and no timers anywhere.

## Prior art

The carousel in every kit.

Where Pretui is better: composition on Scroller, movement reported from every source, and the absence of autoplay — which is the feature that makes most carousels an accessibility problem rather than a component.

Where it is thinner: no thumbnail navigation, no variable slide widths, no infinite virtualised track, and no per-slide lazy loading.

## Accessibility

- **`role='group'` with `aria-roledescription='carousel'`**, and each slide a group with `aria-roledescription='slide'` and its own label — the APG's shape.
- **The status line is what "slide 3 of 7" attaches to**, and it is why `@label` is strongly recommended: it is what a rotor lists.
- **The alternative — `aria-live` on the track itself — reads the whole slide on every move**, which is why the status line is a separate, terse region instead.
- **No autoplay means no moving target.** A carousel that advances on its own is unusable for anyone reading slowly, and the kit does not offer one.
- **`@loop={{false}}` disables the controls at the ends**, so the boundary is perceivable rather than being a button that silently does nothing.
- **The keyboard path survives `@hideControls`**, which matters because hiding the buttons is a visual decision that should not remove an input method.

## Theming

`--pretui-carousel-slide` is the CSS knob `@perView` writes; the edge treatment, dots and buttons all come from **Scroller** and the kit's shared control tokens.

Keeping `@perView` as a custom property rather than a computed width is what lets a container query change slides-per-view responsively without the component re-measuring anything.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
