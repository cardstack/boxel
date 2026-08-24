---
name: motion-pattern
description: >-
  Choose the right animation pattern in this repo (Choreo / glimmer-motion).
  Use FIRST whenever adding, changing, or reviewing any animation, transition,
  enter/exit, layout move, drag, scroll effect, or page transition — before
  writing code. Routes to the specific pattern skill.
---

# Choosing the animation pattern

This library is one package (`glimmer-motion`) with two layers:

- **The binding** — Motion's engine (`motion-dom`, untouched) driven through
  Glimmer: the `{{motion}}` modifier plus `<Presence>`, `<LayoutGroup>`,
  `<MotionConfig>`, `<ReorderGroup>`/`<ReorderItem>`.
- **Choreo** — a region-scoped model on top: `<Choreo>` watches a render pass,
  hands you its **changeset** (inserted / removed / kept, with bounds before
  and after), and plays a declared timeline over it.

Pick the smallest pattern that states the intent. Escalation order:
element → presence → layout → Choreo. Page transitions and scroll are side
doors, not steps on that ladder.

## Decision table

| The ask sounds like                                                                                                                                                                              | Pattern                                            | Skill                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------ |
| "fade/slide/scale this in", hover/tap states, keyframes, variants, stagger                                                                                                                       | `{{motion}}` with `initial`/`animate`/`transition` | `motion-element`         |
| "animate it when it's removed", toasts, list add/remove, modal open/close                                                                                                                        | `<Presence>` + `exit`                              | `motion-presence`        |
| "it moved because the layout changed", tab indicator, thumbnail → detail of the SAME thing                                                                                                       | `layout=true` / `layoutId` / `<LayoutGroup>`       | `motion-layout`          |
| "first X, THEN everyone moves, THEN Y" — ordering across several elements; z-index for the span of a move; one element's motion computed from another's box; fly to a place that must not deform | `<Choreo>` timeline (+ `{{beacon}}`)               | `choreo-scene`           |
| more than one `<Choreo>` in a tree; an element flying from one region into another (Boxel card between panels)                                                                                   | nested regions + far matching                      | `choreo-regions`         |
| "when the route/page changes", full-scene morph between screens                                                                                                                                  | `animateView` / `viewTransition`                   | `motion-page-transition` |
| the gallery-card ⇄ demo-page shared-element navigation, or porting that Magic Move recipe                                                                                                        | `animateView` + the pairing recipe                 | `magic-move-navigation`  |
| drag, swipe-to-dismiss, reorderable list/grid, bottom sheet                                                                                                                                      | `drag` / `<ReorderGroup>`                          | `motion-drag`            |
| parallax, scroll progress, reveal-on-scroll, hide-on-scroll header                                                                                                                               | `scrollProgress` / `InView`                        | `motion-scroll`          |
| writing or fixing a test that involves motion                                                                                                                                                    | `glimmer-motion/test-support`                      | `motion-testing`         |

## The classic wrong reaches

- **View transition for live content.** The gallery filter is a layout
  animation, not a view transition: `startViewTransition` snapshots the page
  into bitmaps, so running demos/videos/canvases freeze for the crossfade.
  `layout=true` moves the real elements. (See the comment in
  `test-app/app/components/gallery.gts`.)
- **`layoutId` to fly a row into a trash can.** `layoutId` pairs two real
  elements and morphs one into the other — the bin would stretch into a row
  shape. A destination that is a _place_, not an identity, is a
  `{{beacon}}` + `<c.Move @to={{c.beacon 'trash'}}>` (`choreo-scene`).
- **`setTimeout` to sequence animations.** That is exactly what `<Choreo>`'s
  `c.Sequence` exists to replace — its "after" is computed from real
  durations, including a spring's settle time.
- **`<Choreo>` for a single element.** If only one element animates and
  nothing depends on ordering or another element's measurement, it's
  `motion-element` (or `motion-presence` if it exits).

## Ground truth

Every gallery demo is a real component in
`test-app/app/components/examples/` — read the matching one before inventing
an approach. `test-app/app/lib/catalog.ts` maps demo → group → source file, and
`test-app/app/components/notes/*.gts` are the per-demo Deep Dives — the
_reasoning_ behind each pattern choice (why the inbox uses beacons, how the
interruption model holds, what the playhead samples). Read the note when
modifying its demo.
Docs: `docs/guide.md` (tutorial), `README.md` (API reference),
`docs/choreography.md` + `docs/nested-choreo.md` (Choreo design).
