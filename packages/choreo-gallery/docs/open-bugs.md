# Open bugs and unfinished work

Rewritten 2026-08-23, after the Ember-idiom pass: `glimmer-motion/test-support`,
the plain-function helpers, `reducedMotion: "user"`, and the interruption suite
moved onto `animationsSettled()`. Self-contained: it
assumes you have not read the session it came out of. Everything here is either
reproduced and pinned by a test, or reported and not yet reproduced — each item
says which.

The parent documents are [choreography.md](choreography.md),
[nested-choreo.md](nested-choreo.md) and [guide.md](guide.md).

- [0. What changed since the last version of this file](#0-what-changed-since-the-last-version-of-this-file)
- [1. Reported, not yet fixed](#1-reported-not-yet-fixed)
- [2. A design question, not a bug](#2-a-design-question-not-a-bug)
- [3. Demos never built](#3-demos-never-built)
- [4. Capability gaps from the audits](#4-capability-gaps-from-the-audits)
- [5. Package work not done](#5-package-work-not-done)
- [6. Recently fixed — do not re-investigate](#6-recently-fixed--do-not-re-investigate)

Current state: **476 tests, 474 pass, 2 skip, 0 fail.** Lint and types clean.
Nothing committed or pushed — all in the `wip` commit.

---

## 0. What changed since the last version of this file

The previous version opened with **eight failing interruption tests** and
treated them as three classes of engine leak. All eight were the test, not the
library. They are now green, and the reasons are worth keeping because each one
is a trap the next suite could fall into.

**Three were the harness measuring too early.** `Sequence`, `Lists` and `Enter`
"stranded a leaver in slow motion". The soak waited `sleep(600)` after resetting
the clock, which is not long enough for a run that was born at ÷5 and is still
finishing. Under `animationsSettled()` all three pass. There was never anything
stranded; there was a test that looked before the end.

**Three were the stage being left open.** `Sequence` "accumulated 3 DOM nodes".
The three nodes were `span.study-details` and its two children — the open card's
own content. Ten clicks at a given spacing leave the demo in whatever state they
leave it in, and the baseline had been captured with everything closed.

**Two were a shared-element follower doing its job.** `Lightbox` "kept a
transform" — `span.shot-card` at `scale(21.3, 11.1)`. Dumping the layoutId stack
showed the lightbox still mounted, still the lead, and the thumbnail behind it a
follower. A follower is projected onto the lead's box on purpose; that is what
makes the crossfade possible. It is the correct rest state of an open lightbox.

The fixes were to the test, in two places, and both are now documented where
they live:

- each `Stage` may declare a `rest` selector — something to click until it is
  gone — so the invariants are checked against the state the baseline was taken
  in (`interruption-test.gts`)
- `strandedTransforms()` excludes an element whose projection node is a
  non-lead member of a stack with a live lead (`test-support/index.ts`)

The lesson worth carrying: **an invariant that only holds in one UI state is not
an invariant.** Two of the three classes were unfalsifiable as written, and both
produced failures that read exactly like engine leaks.

A second round then found three defects the suite could _not_ have caught,
because all three are mid-transition and every invariant here is a rest state.
They were found by driving the gallery at ÷10 and reading positions frame by
frame. All three are fixed and listed in §6. If there is a next lesson it is
that the soak and the contract suite between them still do not watch anything
happen — they only check what is left afterwards.

---

## 1. Reported, not yet fixed

### 1a. A counterpart is only released when a step names `c.removed`

Found while building the interruption demo. A timeline with a single
`<c.Move @of={{c.kept 'x'}}>` and nothing naming `c.removed` leaves the old copy
parked in the orphan layer forever — two elements on screen, one of them dead.
Adding `<c.Hold @of={{c.removed 'x'}} @opacity={{0}} />` fixes it, which is what
the Lists demo has always done, so the bug has been masked by every existing
timeline happening to name the removed side.

`finishPass` does add a named sprite's `counterpart` to the run, and `execute`
does propagate a row end onto it, so on the face of it the release should fire.
Somewhere between those two it does not. **Reproduce with**: two slots, one
element moving between them by `id`, and a timeline containing only a `kept`
Move.

### 1b. Variant orchestration on a `<Presence>` child — UNRESOLVED

Two demos were attempted on `when` / `staggerChildren` / `staggerDirection` and
both were cut. A panel that drives its subtree by variant label
(`variants` + `initial`/`animate` as strings) mounted in its `initial` pose and
never advanced: parent stuck, children stuck.

**This is NOT yet established as a library bug.** A three-case isolation test
(variant parent outside `<Presence>`, inside it, and with
`when: 'beforeChildren'`) failed all three — including the plain case that the
Stagger demo exercises successfully in the gallery — which means the test was
almost certainly wrong, not the library. It asserted on the literal
`style.transform` string, and a value that settles at zero is written as `none`.
The test was deleted rather than left to mislead.

**Redo it properly**: assert on measured bounds via `bounds()` from test-support,
not on transform strings, and start from the case the gallery already proves
(Stagger's `variants` + `staggerChildren`) so a green baseline exists before the
`<Presence>` variable is added.

### 1c. Drag "stopped working" — NOT REPRODUCED

Reported, but could not be reproduced. Verified working two ways on `/drag`:

- synthetic PointerEvents: moved `-48,-24`, constraints respected, stayed put
  after release
- real input via CDP (`left_click_drag`): `translateX(-277px) translateY(-137px)`

The demo renders correctly and no console errors are logged. **Needs a
description of the failure** before it is worth more time. One candidate worth
checking: `dragTransition` (`power: 0.28`) throws the still hard on a fast
flick — a quick drag can fling it to the constraint edge, where it sits showing
empty frame, which could read as "broken".

---

## 2. A design question, not a bug

### Sequence: reopening a card slides its details in instead of fading them

Open a card in the Sequence demo, close it, open it again — from the second time
onwards the details arrive from the side rather than fading in.

This is counterpart matching working as specified. `study-details` carries a
Choreo `id`, and the id comes back every time the same card is reopened. If the
previous copy is still in the orphan layer finishing its fade, the returning one
**counterpart-matches it**, so it is classified `kept` rather than `inserted` —
which means `<c.Tween @of={{c.inserted 'card-content'}}>` no longer selects it,
and it inherits the old copy's seat as an `initial`.

The demo works around it by deliberately _not_ giving `.study-details` a
`layout=true` of its own; there is a comment in
`test-app/app/components/examples/sequence.gts` saying so.

**The question to settle** is whether a returning id should match a leaver that
is already on its way out, or whether counterpart matching should skip sprites
mid-exit. It cannot simply be switched off: the Lists demo depends on
counterpart matching, and the contract suite pins the undo case
(`contract-test.gts`, "a leaver that returns mid-flight is one element, not
two") which relies on exactly this pairing to avoid a duplicate.

A plausible answer is a third state — matched for _cleanup_ (one element, no
orphan) but still reported as `inserted` to the query layer, so a step written
for arrivals still fires. That is a changeset-vocabulary change, not a bug fix,
which is why it lives here rather than in §1.

---

## 3. Demos never built

| Demo                         | Why it matters                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Far matching**             | Implemented (`choreo/far.ts`), pinned by four contract tests, and invisible. This is the headline capability of the release and there is nothing in the gallery to look at.                         |
| **Interruptibility**         | Currently only visible by accident, by putting Split view in ÷10. It is the thing the engine does best and it deserves a stage: a target you can re-aim mid-flight and watch bend rather than snap. |
| **Deck animation on Choreo** | Was implemented with view transitions; the plan was to redo it as a choreography.                                                                                                                   |
| **"Animate the header out"** | Requested, never clarified — the site chrome, or the `hide-header` demo? Ask before building.                                                                                                       |

---

## 4. Capability gaps from the audits

Three audits (ember-animated, legacy boxel-motion, motion.dev) agreed that
glimmer-motion is a near-superset of all three. What is left, in priority order,
is recorded in the memory note `superset-audit` and in
[choreography.md](choreography.md#phases). Briefly:

1. ~~Far matching across regions~~ — **done**.
2. **Closed step vocabulary** in `<Choreo>` — no custom step kind, which also
   blocks `follow` / derived tweens (one cue reading another's live value).
3. **Pre-render computed-style snapshots** — the only true regression against
   the legacy. It should be opt-in (`<Choreo @styles={{array 'backgroundColor'}}`)
   because the per-participant `getComputedStyle` is exactly why it was dropped.

Also open, from the Framer audit: `<MotionConfig>` and `<LayoutGroup>` render a
real wrapper element (`display: contents`) where React's render no DOM. It is
mostly layout-transparent but breaks direct-child selectors (`.grid > .item`),
`:nth-child`, and `parentElement` walks.

---

## 5. Package work not done

The Ember-idiom pass covered helpers, named exports, `test-support`,
`reducedMotion: "user"` and the guide. What it did not cover:

- **`0.1.0`, a changelog, and npm.** Still `0.0.0` and consumed by `workspace:*`.
  Publishing is a decision, not a task — it is what stops Boxel depending on a
  path.
- **`ember-try` against LTS** (5.12 / 6.4 / release). The peer range already
  says `>= 5.4`; nothing proves it.
- **`ember-a11y-testing` on the gallery.** `reducedMotion` now defaults to
  `"user"`, which was the substantive half. A smoke pass over the gallery is the
  other half and needs a new dev dependency.
- **A memory pass.** Every `{{motion}}`, Choreo run, scroll/inView and beacon
  should unregister on destroy. The `activity.ts` probes give this a lever it
  did not have: a leaked node keeps answering a probe forever, so a test can
  assert `whatIsBusy()` is empty after teardown.

---

## 6. Recently fixed — do not re-investigate

### A leaver in a stack of one never completed its exit

Filtering the gallery from All to a category and back left twenty cards in the
DOM at `opacity: 0` with their `initial` transform still on them. Stamping the
cards showed `dom=26 stamped=26` — the same elements throughout, never removed.

A shared-layout leaver is deliberately NOT completed by its own animation: the
element it hands over to owns when it goes, because a crossfade has to outlive
the values of the copy it is replacing. `node.ts` expressed that as "this node
has a stack, so someone else will report it". A leaver holding a `layoutId`
that nothing else shares is in a stack of ONE — itself. There is no counterpart
and no crossfade, so nobody ever reported it, the registration stayed open, and
`Entry.checkComplete()` never released the entry.

The fix is to ask whether anyone _else_ is in the stack:

```ts
const others = stack?.members.filter((m) => m !== projection) ?? [];
if (!others.length) presenceContext?.onExitComplete?.(this.layoutPresenceKey);
```

Traced by instrumenting the exit path and tallying it over a real filter:
`pop: 20`, `relegate false: 54`, `exitComplete? members=nostack: 45`,
**`exitComplete? members=1: 9`** — nine nodes reaching the guard with a stack of
one and falling through it.

Pinned by `tests/integration/motion/gallery-filter-test.gts`, which fails
without the fix and passes with it, deterministically. Note that the reductions
in `presence-roundtrip-test.gts` do NOT pin it: a three-item round trip, one
interrupted mid-exit, a leaver with a motion descendant, and a leaver holding a
lone `layoutId` all pass either way. Whatever else the gallery brings — depth,
twenty leavers at once, nested `<Presence>` and `<Choreo>` regions — is part of
the trigger and is not yet isolated.

Listed so the next session does not re-derive them.

- **`releaseForMeasure` measured with stale transforms.** It used a batched
  `scheduleRender()`, so `final` was measured while the transform being undone
  was still applied — the FLIP delta came out as distance-travelled _plus_
  distance-remaining, and the element jumped. Now renders synchronously.
  (`choreo/run.ts`)
- **Interrupted animations lost their velocity.** A run now hands its
  velocities to the run replacing it, so a reversed move overshoots and bends
  instead of restarting from rest. (`choreo/run.ts`, `Velocities`)
- **Slow motion did not reach layout animations.** A projecting element with no
  `transition` of its own fell through to a constant the engine keeps private.
  Now supplied, scaled, but only while slowed — at normal speed nothing changes.
  (`node.ts`, `DEFAULT_LAYOUT_TRANSITION`)
- **`popLayout` collapsed multiple simultaneous leavers onto one seat.**
  Applying `position:absolute` to the first leaver reflowed the rest, so each
  subsequent one measured an already-shifted box. Measurement and application
  are now batched. (`node.ts`, `pendingPops`) This was the Trail bug.
- **Sequence label smeared.** The card scales non-uniformly (square tile →
  16:9 hero) and dragged its text with it. The label has its own `layout` now,
  so projection undoes the parent's scale. Verified at scale 1.0/1.0 throughout.
- **Orphan accumulation in Sequence** — fixed as a side effect of the
  `releaseForMeasure` fix; verified 0 orphans across click patterns, rapid
  bursts, and slow motion.
- **The eight "interruption leaks"** — see §0. All test artefacts.
- **popLayout pinned leavers where they had never stood.** The seat was measured
  after the render that removed the element, by which time the container had
  grown around the arrivals and, if centred, moved. React measures in
  `getSnapshotBeforeUpdate`; `<Presence>` now measures from its own diff, before
  the patch. This was the Enter replay-ghosts report. (`presence.gts`,
  `node.ts` `measureForPop`)
- **`<Presence>` did not snapshot projection when it unmounted a leaver.** That
  render is driven by Presence's own bookkeeping, not by a `<LayoutGroup>`
  re-render, so nobody asked for a snapshot and the newcomer covered the last
  stretch in a single frame. This was the `sync` 41px snap. (`presence.gts`)
- **Scale correctors were never registered.** React registers them alongside
  MeasureLayout; without them `borderRadius` and `boxShadow` are stretched by
  whatever scale a layout animation applies, so a square tile growing into a
  wide hero came out with oval corners. Registered in `features.ts` — and note
  the correction only reaches values the element _has_, so a radius that lives
  in the stylesheet is invisible to it. Sequence and Lightbox now declare theirs
  through the modifier.
