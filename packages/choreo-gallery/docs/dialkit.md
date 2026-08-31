# dialkit, and whether Choreo can use it

**Status:** an evaluation, and a spike that is now built. See "The spike, as
built" below for what it settled.

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

|                                              |  lines | vendorable?                                                             |
| -------------------------------------------- | -----: | ----------------------------------------------------------------------- |
| `dialkit/store` + `dialkit/timeline` + utils | ~3,560 | **no need** — published, framework-free, motion-free subpath exports    |
| `styles/theme.css`                           |  2,221 | **shared verbatim** — every port emits the same `dialkit-*` class names |
| `icons.ts`                                   |     54 | already a core entry                                                    |
| React port                                   |  4,215 | no — would be rewritten, not copied                                     |
| Solid port                                   |  4,724 | "                                                                       |
| Svelte port                                  |  4,332 | "                                                                       |
| Vue port                                     |  4,520 | "                                                                       |

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
→ stiffness/damping mapping, so that a scrubbed position _approximates_ what
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

|                          |       lines |
| ------------------------ | ----------: |
| `DialTimeline`           |       1,654 |
| `Slider`                 |         432 |
| `DialRoot`               |         259 |
| `ShortcutListener`       |         250 |
| `TransitionControl`      |         210 |
| the other 15 controls    | median ~137 |
| `Toggle` / `ButtonGroup` |     34 / 22 |

A minimum-useful panel — `DialRoot`, `Panel`, `Folder`, `ControlRenderer`,
`Slider`, `SpringControl`, `SpringVisualization`, and one tracked bridge in
place of the two React hooks — is about **1,500 lines**, and less than that in
Ember, where `useDialKit` and `useDialStorePanel` collapse into a single
`subscribe → tracked` adapter.

`Slider` is the one genuinely large control and the one where this repo has an
unfair advantage: it is 432 lines of hand-rolled pointer maths in React, and we
own a drag library. `{{motion drag="x"}}` should take most of it out.

## The spike, as built

Built and landed. 379 lines: 150 for the bridge (`test-app/app/lib/dial.ts`),
229 for a sliders-only panel (`app/components/dial-panel.gts`), wired to the
`Hang` stage's slide spring.

Four things it settled:

**The bridge works, and it is small.** `DialStore.subscribe(id, listener)` maps
onto one `@tracked revision` counter, with `@cached` on the derived getters so
a render sees ONE snapshot. That cache is load-bearing rather than an
optimisation: without it `resolveDialValues` rebuilds a fresh tree per read and
a template touching `values` twice hands Choreo two structurally-identical
springs with different identities.

**Choreo tolerates it exactly as hoped.** `treePrint` is `JSON.stringify`, so a
rebuilt-but-unchanged spring prints the same and the pass is declined as noise;
a spring whose numbers moved prints differently and replays. Idle re-renders
cost nothing, and dragging a slider mid-flight re-runs the score against the
new value.

**The stylesheet claim is true.** 287 dialkit selectors applied to markup
written in Ember, with the spike writing 8 lines of CSS of its own. The two
things that must be right are `data-mode="inline"` (dialkit's own embedded
mode; the panel is `position: fixed` otherwise) and `.dialkit-panel-inner`,
which is the element carrying the glass surface.

**The slider is much cheaper here than in React.** `Slider.tsx` is 432 lines,
most of it hand-rolled pointer maths. Ours is a `{{motion drag="x"}}` with
`dragConstraints={left: 0, right: 0}` — zero-width constraints give the gesture
without the movement, since `PanInfo.offset` is measured from the POINTER and
not from where the element ended up. React's version has to drive a MotionValue
into the track and rubber-band it back instead.

Verified end to end against the arithmetic: at damping 57 (coast 0.57) an
831 px/s throw rests at 91.0%, and at damping 4 (coast 0.04) a 705 px/s throw
rests at 29.9% — both matching `at + v·coast/width` to four significant
figures.

### Two traps worth recording

**Embroider claims every `@import` in app.css.** A bare `dialkit/styles.css`
throws "unexpected @embroider/virtual specifier"; a sibling relative path is
captured too and answered with a 300-byte stub. The stylesheet is copied into
`public/` at config time and linked from index.html, exactly as the Draco
decoder is (`vendorDialkit` in vite.config.mjs).

**`event.target` in a drag callback is not the element.** The pan session hands
its callbacks the last POINTERMOVE, whose target is whatever the move was
dispatched on — the window, once the gesture leaves the element. So
`event.target.closest(...)` throws, and it throws INSIDE a frame callback,
taking the rest of that frame's queue with it. The visible symptom is not an
error near the mistake: it is `onDragStart` firing, `onDrag` never firing, and
a control that will not move. Hold the element; do not re-derive it.

## What Drift needed on top, and what it cost

The spike answered its question and stopped there: sliders, one flat list,
pointed at two numbers. `Drift` is the demo that made the rest of it necessary,
and it is worth recording what the second pass actually cost — the estimate
above said "filling in controls against a stylesheet we already have", and that
was right about the stylesheet and wrong about one control.

**Folders were an afternoon, and they were already in the data.** `ControlMeta`
carries `children?: ControlMeta[]`, and a nested object in a `DialConfig`
becomes `type: 'folder'` with `defaultOpen` (store `index.js:569`). The spike's
`get sliders()` filtered the tree to `type === 'slider'` and threw every branch
away — which cost nothing when the config was two flat numbers and cost the
whole shape once it was a macro over four groups. `dial-controls.gts` walks the
tree and recurses; the collapse state is a `Map<string, boolean>` rather than a
`Set` because there are three states and not two — open, shut, and never
touched, the last of which has to fall through to the config's own
`defaultOpen` so that `_collapsed: true` in the source decides what a folder
looks like the first time anyone sees it.

**Presets were smaller than folders, because they are entirely the store's.**
`savePreset` / `loadPreset` / `deletePreset` / `getPresets` /
`getActivePresetId` are all on `DialStoreClass` and none of it is in any UI
port. What was missing was a row of chips and a text field. Two things about
the store's design are worth knowing before building that row:

- **Persistence of presets is a separate switch.** `persist: true` keeps
  values; presets need `persist: { presets: true }`. A panel whose saved tunes
  vanish on reload is worse than one that never offered to save them.
- **While a preset is active, every slider edit is written into it**
  (`updateValues`, store `index.js:220`). That is not a quirk to work around —
  it is the arc a tuning panel wants. You load a character, you move one
  number, and the thing you come back to is the car you ended up with rather
  than the one you started from. Nothing has to be pressed to keep it.

`Drift` still ships four hand-written characters as source constants rather
than as seeded presets, and that is deliberate. A character is a thing the
stage ships and can always be got back to; a preset is a thing you made. Seeding
the store with the four would put four editable copies of the source in
localStorage with no way home. They sit in one row because to a player they are
one question — what am I driving — but only one of them can be deleted.

**`type: 'spring'` is NOT cheap, and the plan that said it was got the name
wrong.** `docs/drift.md` proposed one spring control per pair instead of two
sliders, "cheap once folders exist". The store does not emit `'spring'` for a
`SpringConfig` at all: it emits `type: 'transition'` (store `index.js:552`),
whose value is the whole spring object plus a companion `path.__mode` that
switches between an easing curve, a two-number "simple" form and a five-number
"advanced" one. Drawing it means drawing three modes and the switch between
them, and there are `updateSpringMode` / `getSpringMode` / `updateTransitionMode`
/ `getTransitionMode` on the store to drive from. Folders of ordinary sliders
get the same nesting for none of that, so that is what Drift uses. The real
control is still worth having; it is a separate afternoon, not a free one.

**The stylesheet claim, revised once.** It still holds — the second pass added
folders, a chevron, a preset row and a scaled overlay rail, and the folder
markup came straight from dialkit's own classes (`.dialkit-folder`,
`-header`, `-header-top`, `-title-row`, `-title`, `-content`, `-inner`). Two
corrections to the earlier claim, both of the same kind:

- **Some of dialkit's design is not in `theme.css`.** `.dialkit-slider-handle`
  gets `top: 50%` from the stylesheet and nothing else; its centring translate
  and its resting scale live in the React component's inline `style` and
  `animate` props (`y: '-50%'`, `scaleX: isActive ? 1 : 0.25`). A port that
  emits the class and nothing else gets a fat handle hanging below the track.
- **The chevron has to be drawn.** dialkit rotates one glyph rather than
  swapping two, which is right, but at the size the row wants, `▸` renders as a
  dot in most of the faces on this stack. It is a border triangle here.

**Where the panel goes is a design problem the package does not solve.** A
gallery card is about 550 by 350. dialkit's `data-mode="inline"` puts the panel
in flow, which is correct on a demo page and ruinous in a card — a 280px panel
beside the stage leaves half a stage. Drift lays it over the track instead,
translucent, scaled to whatever room the card gave it, scrolling inside itself,
withdrawing while a finger is on the track and with a tab to put it away. All of
that is ours; none of it is dialkit's fault. Worth saying because it is the part
that took the longest, and a future port should budget for placement rather than
assuming `inline` is the answer.

## The recommendation, as it was made

Kept as written, because it was the call that led here and it was roughly
right — the seam held, and the second pass was indeed filling in controls
against a stylesheet we already had, with the one exception noted above.

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
