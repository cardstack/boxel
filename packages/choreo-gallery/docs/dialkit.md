# dialkit, and whether Choreo can use it

**Status:** an evaluation, not a build. Nothing below exists yet.

[dialkit](https://github.com/joshpuckett/dialkit) is a real-time parameter
panel — sliders, spring and easing visualisations, presets, persistence,
keyboard shortcuts — for React, Solid, Svelte and Vue. It is MIT, actively
pushed, and its README pitches "a scrubbable animation Timeline".

The question that started this: it is built on Motion and so is Choreo, so can
it be vendored across?

The short answer is that both halves of that question are the wrong shape. The
Motion lineage is not what makes it portable, and the portable half needs no
vendoring at all.

## The Motion connection is chrome, not architecture

`motion` is dialkit's one non-optional peer dependency (`>=11.0.0`; React,
Solid, Svelte, Vue and `motion-v` are all marked optional). That reads like
evidence of a deep shared foundation. It is not.

Motion appears in 22 files and every one of them is panel chrome — the folder
that expands, the panel you drag, the dropdown, the slider, the preset menu:

```
src/store/  src/timeline/  timeline-core.ts  transition-math.ts   0 motion imports
src/components/   (React)                                         motion/react
src/solid/                                                        motion
src/vue/                                                          motion-v
```

The tell is the fourth port. **The Svelte port does not use Motion at all** —
it reaches for `svelte/motion`'s own `Spring` and a hand-written
`svelte/transition`. Motion is not required by the design; it is what three of
the four ports happen to animate themselves with.

And the imports that do exist are `motion.div`, `AnimatePresence`,
`useMotionValue`, `useTransform` — React components and hooks. glimmer-motion
is a parallel port of Motion to Ember, not the same API surface. A shared
upstream does not make those interchangeable, any more than it makes the Vue
port runnable in Solid.

## Vendoring is the wrong verb in both directions

dialkit is not one library with framework bindings. It is a framework-free core
with **four independent full reimplementations** of the same twenty controls:

| | lines | vendorable? |
| --- | ---: | --- |
| `dialkit/store` + `dialkit/timeline` + utils | ~3,560 | **no need** — published, framework-free, motion-free subpath exports |
| `styles/theme.css` | 2,221 | **shared verbatim** — every port emits the same `dialkit-*` class names |
| `icons.ts` | 54 | already a core entry |
| React port | 4,215 | no — would be rewritten, not copied |
| Solid port | 4,724 | " |
| Svelte port | 4,332 | " |
| Vue port | 4,520 | " |

The half worth having does not need vendoring: `dialkit/store` and
`dialkit/timeline` are separate tsup bundles that do not list `motion` in their
externals, because they never import it. `npm install dialkit` and import them.

The half that would need vendoring cannot be: components do not cross
frameworks. Four ports exist because four ports had to be written.

**The seam is good, though.** `DialStore` is a plain class with
`subscribe(panelId, listener) => unsubscribe`, and the Svelte port consumes it
through the published `dialkit/store` path like any other consumer. Nothing
about it is privileged. An Ember port would be a fifth port against a stable
public core — new code, not a fork.

## The stylesheet is the part that makes this cheap

All four ports render the same class names — 124 distinct `dialkit-*` classes
in the React port, 129 in Svelte and Vue. `theme.css` is 2,221 lines and it is
shared verbatim.

That matters more than it sounds. On most UI ports the styling is where the
time actually goes; here an Ember port that emits the same markup inherits the
entire visual design for free, and inherits future upstream refinements to it.

## What NOT to take

**Not the timeline.** `DialTimeline.tsx` is 1,654 lines — 37% of the React
port on its own — and `transition-math.ts` exists to support it: a closed-form
damped-harmonic-oscillator solution with Motion's own `visualDuration`/`bounce`
→ stiffness/damping mapping, so that a scrubbed position *approximates* what
Motion would have played.

It re-derives the maths because it has no way to seek a real animation. Choreo
does: `ChoreoRun.seekTo`, `t.delivery.seek`, and the camera-fold reconstruction
that makes a random-access seek agree to the pixel with having played there.
Importing dialkit's timeline would be a downgrade for that job, and it would
leave two timeline models competing for authority over one scene.

Dropping the timeline, its toggle and its hook removes ~1,800 lines before any
work starts.

**The clean split: dialkit owns parameters, Choreo owns time.**

## What IS worth having

The panel. Choreo has no answer for tuning, and the gap is not theoretical —
the `Hang` stage shipped with

```ts
const SLIDE = { damping: 28, stiffness: 100 } as const;
const COAST = SLIDE.damping / SLIDE.stiffness;
```

tuned by editing a constant and rebuilding, several times, with the correctness
of the whole stage resting on those two numbers and their derived relationship.
A dial over them with a live spring curve is exactly the missing instrument.

`copy-instruction.ts` is the other half of that loop: it emits a prompt telling
an agent to write the tuned values back into the config. Tune in the browser,
paste the instruction, and the constants land in the source.

## What a port actually costs

The React port is 4,506 lines, but it is top-heavy and most of the weight is in
the parts to skip:

| | lines |
| --- | ---: |
| `DialTimeline` | 1,654 |
| `Slider` | 432 |
| `DialRoot` | 259 |
| `ShortcutListener` | 250 |
| `TransitionControl` | 210 |
| the other 15 controls | median ~137 |
| `Toggle` / `ButtonGroup` | 34 / 22 |

A minimum-useful panel — `DialRoot`, `Panel`, `Folder`, `ControlRenderer`,
`Slider`, `SpringControl`, `SpringVisualization`, and one tracked bridge in
place of the two React hooks — is about **1,500 lines**, and less than that in
Ember, where `useDialKit` and `useDialStorePanel` collapse into a single
`subscribe → tracked` adapter.

`Slider` is the one genuinely large control and the one where this repo has an
unfair advantage: it is 432 lines of hand-rolled pointer maths in React, and we
own a drag library. `{{motion drag="x"}}` should take most of it out.

## The recommendation

Not a port. A **spike**, ~250 lines: `{{dial}}` over `dialkit/store`, sliders
only, no timeline and no visualisations, pointed at `Hang`'s two springs.

It answers the one question that cannot be answered by reading the source —
whether `subscribe(panelId, listener)` bridges to tracked state cleanly, without
tearing during a Choreo measure pass — and it produces something immediately
useful on the way. If the seam holds, the rest is filling in controls against a
stylesheet we already have. If it does not, that is an afternoon rather than a
fortnight.

Open question for whoever picks this up: whether the test app is the right home
for a new runtime dependency, or whether the panel belongs in its own package
alongside `choreo-player`.

## Notes on versions

dialkit's `motion >=11` peer and its `^12` devDependency bind only the UI ports,
which we would not use. This repo being on `motion ^13.1.1` is irrelevant to
`dialkit/store`, which imports nothing.

No Ember anywhere in dialkit's `peerDependencies`, `exports` map or keywords.
There is no port to adopt; there is a core to build against.
