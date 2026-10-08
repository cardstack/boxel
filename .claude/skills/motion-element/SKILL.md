---
name: motion-element
description: >-
  Single-element animation with the {{motion}} modifier: initial/animate,
  transitions, keyframes, variants, stagger, hover/tap/focus gestures, motion
  values, SVG. Use when one element animates on its own — including the three
  Glimmer-specific rules that silently break motion when violated.
---

# One element: the `{{motion}}` modifier

`{{motion}}` goes on the element you already have — any HTML or SVG element,
no wrapper. Named args are Motion's props, same names and types.

```gts
import { motion, to, spring } from 'glimmer-motion';

<article
  {{motion
    initial=(to opacity=0 y=12)
    animate=(to opacity=1 y=0)
    transition=(spring visualDuration=0.4 bounce=0.2)
  }}
>…</article>
```

- Helpers `to`, `spring`, `tween`, `inertia`, `stagger`, `ease`, `styles` are
  plain functions used as template helpers — they exist so Glint typechecks
  the target. `(hash …)` also works.
- A target used more than once belongs in a module constant, not inline —
  the gallery is written that way throughout:
  `const soft = spring({ bounce: 0.14, visualDuration: 0.48 });`
- `animate` is a **target, not an event**: it re-runs whenever its value
  changes. Drive it from a getter.
- Transforms are values: animate `x`, `y`, `scale`, `rotate` — never compose
  a `transform` string yourself; the engine owns `transform`.
- Keyframes: pass arrays (`animate=(to x=(array 0 40 0))` or a constant).
- Variants, `custom`, `staggerChildren`/`delayChildren`, `when:` all work as
  in Motion; `inherit` controls propagation.
- Gestures: `whileHover`, `whileTap`, `whileFocus`, `whileInView` plus their
  handlers. Keyboard activates tap.
- `<MotionConfig @transition @reducedMotion …>` sets tree-wide defaults.
  `@reducedMotion` defaults to `"user"` here (not React's `"never"`):
  `prefers-reduced-motion` is honoured by default — transform/layout
  animation off, opacity/colour still animate. Don't "fix" that.

## Motion values: per-frame data without re-render

Anything updating at pointer/frame rate (a follower, a scrub readout, a
progress fill) must NOT go through tracked state — that is a render per
frame. Make a `motionValue`, bind it once through an object passed to
`style=`, and drive it: `.set(v)` writes a value, `animate(this.x, v, transition)` animates
to one (a spring chasing the pointer), `.jump(v)` teleports and stops what
was driving it (the scrub case):

```gts
import { animate, motionValue, spring } from 'glimmer-motion';

const tight = spring({ visualDuration: 0.2, bounce: 0 });

x = motionValue(0);
dot = { x: this.x };
follow = (to: number) => void animate(this.x, to, tight);
// template: {{motion style=this.dot}}
```

Bind motion values through a plain object field, as the demos do. The
`styles` helper's value type is `MotionValue<never>`, which a
`MotionValue<number>` doesn't satisfy, so `(styles x=this.x)` fails Glint
even though it runs.

glimmer-motion re-exports motion-dom's imperative surface (`motionValue`,
`MotionValue`, `animate`, `transformValue`, `styleEffect`, `frame`); import
those from `glimmer-motion`, not `motion-dom` or `motion`, so they share the
engine `{{motion}}` runs on. That curated list is glimmer-motion API: adding a
name to it is an API change.

`follow-pointer.gts` (springs chasing a value) and `playhead.gts`
(`.jump()` on scrub — a scrubbed frame is a still, nothing in flight) are
the two reference implementations. Both demos import `motionValue` from
`motion-dom` and `animate` from `motion`; write new code against the
`glimmer-motion` re-exports instead.

Global tempo: durations you hand-roll (a `setTimeout` matching a spring)
must respect `motionSpeed()` — use `scaleTransition`/`onMotionSpeed` from
`glimmer-motion` the way the demos do, or better, don't hand-roll (see
`choreo-scene`).

## The three Glimmer rules (each costs an afternoon when broken)

1. **Motion owns the inline style.** Never put a bound `style="…"` attribute
   on a motion element — Glimmer rewrites the whole declaration on re-render
   and wipes the transform Motion just wrote. Symptom: a card that won't
   drag/animate while the code around it runs perfectly.
   ```gts
   {{! ✗ }} <div style={{this.accent}} {{motion drag=true}} />
   {{! ✓ }} <div {{motion style=(styles background=this.accent) drag=true}} />
   ```
2. **Declare what you want tweened/corrected.** A stylesheet
   `border-radius` is invisible to the engine, so a layout-animating tile
   grows with oval corners. Pass it through the modifier:
   `{{motion layout=true style=(styles borderRadius='14px')}}`.
3. **A leaving child stays live** (see `motion-presence`) — exit content must
   ride on the yielded item, not be re-read from moved-on state.

## Canonical demos

`packages/choreo-test-app/app/components/examples/`: `stagger.gts`, `trail.gts`,
`keyframes.gts`, `gestures.gts`, `enter.gts`, `path-draw.gts` (SVG
`pathLength`), `follow-pointer.gts` (motion values + springs).

Escalate: element leaves the DOM → `motion-presence`; position/size change
caused by layout → `motion-layout`; multi-element ordering → `choreo-scene`.
