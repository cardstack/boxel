# Page Transitions and Live Crossings

Navigation can preserve context by connecting the previous page to the next. The library supports browser view transitions through `animateView` and `viewTransition`, as well as live crossings through Choreo. They solve related problems with different rendering behavior, so choose based on whether the content must remain interactive and animated during the transition.

## Understanding the Snapshot Boundary

A browser view transition captures representations of the old and new page. This is useful for a static page change, but the captured content does not continue behaving like the original controls, canvas, or video during the transition. The repository therefore uses layout motion or a live Choreo crossing when the moving content must remain live.

`viewTransition` wraps the update in the browser mechanism. `animateView` adds a builder for controlling the transition animations. Read their exported `ViewTransitionOptions`, `ViewTransitionBuilder`, and `ViewTransitionUpdate` contracts when integrating with a router. The update callback is the state or route change that produces the new view; it should not be a second independent animation scheduler.

## Keeping Identity Stable

A shared element needs a consistent identity on both pages and compatible geometry. Decide what is genuinely the same subject: a gallery stage and its expanded demo can share identity, while a row and a trash button are different subjects. The latter needs a destination beacon rather than a shared-element morph.

For live navigation, put the changing outlet inside a persistent region:

```gts title="Component template excerpt"
import { Choreo, spring } from 'glimmer-motion';
const flight = spring({ stiffness: 260, damping: 30 });

<template>
  <Choreo @route={{true}} @scroll='top' as |c|>
    {{outlet}}
    <c.Crossing @spring={{flight}} />
  </Choreo>
</template>
```

The region applies scroll intent before measuring the arriving layout. That ordering matters: measuring the new page at one scroll position and then jumping the window produces a flight toward the wrong destination.

## Reviewing Navigation

Test forward navigation, back navigation, repeated clicks during the move, and a destination whose content takes time to mount. Focus should land at an appropriate heading or control, and reduced-motion settings should preserve the navigation's meaning. Avoid launching entrance animations underneath the crossing if they compete with the shared subject's movement; the arming guide explains how a host can coordinate that boundary.

A successful navigation is more than a smooth camera-like move. The departing view must release ownership, the arriving controls must be usable, and no orphaned element should keep intercepting input after the transition finishes. Test those outcomes explicitly instead of judging only a recording of the first successful click.

## API Coverage

**glimmer-motion**: `ViewTransitionBuilder`, `ViewTransitionOptions`, `ViewTransitionUpdate`, `animateView`, `viewTransition`.

Read the implementation: [`view-transition.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/view-transition.ts).
