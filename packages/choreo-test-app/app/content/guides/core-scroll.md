# Scroll Progress and Viewport Observation

A scroll-driven effect answers a different question from an entrance triggered by visibility. Parallax asks how far a target has traveled through a range. A reveal asks whether the target has entered the viewport. The library exposes both models so the effect can use the smallest amount of state it needs.

## Tracking Continuous Progress

`scrollProgress()` creates four MotionValues: horizontal and vertical positions, and normalized progress for each axis. Its `container`, `target`, and `track` modifiers connect those values to the relevant elements. Use `track` for document scrolling, or attach a container and target when the effect belongs to a specific scrollable region.

```ts title="Component logic excerpt"
import { scrollProgress, InView } from 'glimmer-motion';

// Fields on a component instance:
scroll = scrollProgress({ offset: ['start end', 'end start'] });
visible = new InView({ once: true });
```

Place `{{this.scroll.container}}` on the scrolling element and `{{this.scroll.target}}` on the measured section. Bind a derived MotionValue through `styles()` for the visual effect. The offset pair describes the target's travel relative to the container; it does not mean a fixed number of pixels. Check it against the actual height and overflow behavior of the page.

## Observing an Entrance

Place `{{this.visible.observe}}` on the target and read the tracked `isInView` property. `once=true` retains the entered state, while repeatable observation changes it when the target leaves. The initial state, root, margin, and required visible amount let you choose when an entrance is meaningful.

The older `useScroll` and `useInView` names are compatibility aliases. There are no React hook rules in a Glimmer class; new examples should use `scrollProgress()` and `new InView()` so the ownership model is clear.

## Using the Lower-Level Functions

The `scroll`, `scrollInfo`, and `inView` exports support hosts that need the underlying subscription APIs. Their callbacks and returned cleanup functions belong to the host's lifecycle. The higher-level modifiers already manage attachment and cleanup, so do not add a duplicate global scroll listener around them.

Use continuous progress for a visual mapping and a discrete tracked flag for a state transition. Updating tracked application state for every pixel of scroll can trigger unnecessary rendering and layout measurement. Conversely, starting a one-time animation from a visibility flag will not produce reversible parallax when the user scrolls back.

Test short pages, nested scroll containers, a resized viewport, and a target already visible at mount. Confirm reduced-motion behavior without removing access to the content itself. A reveal should enhance reading rather than making essential text depend on successful animation.

## API Coverage

**glimmer-motion**: `scroll`, `scrollInfo`, `ScrollInfo`, `ScrollOffset`, `ScrollOptions`, `InViewOptions`, `inView`, `ScrollValues`, `UseInViewOptions`, `UseScrollOptions`, `InView`, `scrollProgress`, `useInView`, `useScroll`.

Read the implementation: [`scroll.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts). `scroll()`, `scrollInfo()` and `inView()` are Motion's own, re-exported from `framer-motion/dom`; `scroll.ts` adds the modifiers that bind them to elements.
