---
name: motion-pattern
description: >-
  Choose the right animation pattern with glimmer-motion and Choreo
  (packages/glimmer-motion, packages/choreo, the Choreo gallery and test app,
  and host UI that animates with them). Use FIRST whenever adding, changing, or
  reviewing an animation, transition, enter/exit, layout move, drag, scroll
  effect, or page transition there — before writing code. Routes to the
  specific pattern skill.
---

# Choosing the animation pattern

The library is two layers, one package each:

- **The binding** (`glimmer-motion`, `packages/glimmer-motion`) — Motion's engine (`motion-dom`, untouched) driven through
  Glimmer: the `{{motion}}` modifier plus `<Presence>`, `<LayoutGroup>`,
  `<MotionConfig>`, `<ReorderGroup>`/`<ReorderItem>`.
- **Choreo** (`@cardstack/choreo`, `packages/choreo`) — a region-scoped model on top: `<Choreo>` watches a render pass,
  hands you its **changeset** (inserted / removed / kept, with bounds before
  and after), and plays a declared timeline over it.

Pick the smallest pattern that states the intent. Escalation order:
element → presence → layout → Choreo. Page transitions and scroll are side
doors, not steps on that ladder.

## Decision table

| The ask sounds like                                                                                                                                                                              | Pattern                                                                    | Skill                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------- |
| "fade/slide/scale this in", hover/tap states, keyframes, variants, stagger                                                                                                                       | `{{motion}}` with `initial`/`animate`/`transition`                         | `motion-element`                                   |
| "animate it when it's removed", toasts, list add/remove, modal open/close                                                                                                                        | `<Presence>` + `exit`                                                      | `motion-presence`                                  |
| "it moved because the layout changed", tab indicator, thumbnail → detail of the SAME thing                                                                                                       | `layout=true` / `layoutId` / `<LayoutGroup>`                               | `motion-layout`                                    |
| "first X, THEN everyone moves, THEN Y" — ordering across several elements; z-index for the span of a move; one element's motion computed from another's box; fly to a place that must not deform | `<Choreo>` timeline (+ `{{beacon}}`, both from `@cardstack/choreo`)        | `choreo-scene`                                     |
| more than one `<Choreo>` in a tree; an element flying from one region into another (Boxel card between panels)                                                                                   | nested regions + far matching                                              | `choreo-regions`                                   |
| Route/page change                                                                                                                                                                                | Live DOM crossing: `<Choreo @route>`; intentional snapshots: `animateView` | `magic-move-navigation` / `motion-page-transition` |
| the gallery-card ⇄ demo-page shared-element navigation, or porting that Magic Move recipe                                                                                                        | `<Choreo @route>` + paired identities                                      | `magic-move-navigation`                            |
| drag, swipe-to-dismiss, reorderable list/grid, bottom sheet                                                                                                                                      | `drag` / `<ReorderGroup>`                                                  | `motion-drag`                                      |
| parallax, scroll progress, reveal-on-scroll, hide-on-scroll header                                                                                                                               | `scrollProgress` / `InView`                                                | `motion-scroll`                                    |
| writing or fixing a test that involves motion                                                                                                                                                    | `glimmer-motion/test-support`                                              | `motion-testing`                                   |

## The classic wrong reaches

- **View transition for live content.** The gallery filter is a layout
  animation, not a view transition: `startViewTransition` snapshots the page
  into bitmaps, so running demos/videos/canvases freeze for the crossfade.
  `layout=true` moves the real elements. (See the comment in
  `packages/choreo-gallery/realm/shell/gallery-grid.gts`.)
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
`packages/choreo-test-app/app/components/examples/` — read the matching one
before inventing an approach. `packages/choreo-test-app/app/lib/catalog.ts`
maps demo → group → source file, and
`packages/choreo-test-app/app/components/notes/*.gts` are the per-demo Deep
Dives — the
_reasoning_ behind each pattern choice (why the inbox uses beacons, how the
interruption model holds, what the playhead samples). Read the note when
modifying its demo.
Docs: `packages/choreo-gallery/docs/guide.md` (tutorial), the package READMEs
`packages/glimmer-motion/README.md` and `packages/choreo/README.md` (API
reference), `packages/choreo-gallery/docs/choreography.md` +
`packages/choreo-gallery/docs/nested-choreo.md` (Choreo design).

A card in a realm imports the same libraries through host's realm shims, under
different rules (no direct motion-dom imports, state shared with host). For
card authoring, follow the `card-motion` skill in boxel-skills instead.

## Beyond the basic patterns

For gates, Follow/Tether, commands, delivery and custom steps, read
`.claude/skills/choreo-create/references/advanced-orchestration.md`.
For 3D coordinates, cameras, picture actors and Film clocks, read
`.claude/skills/choreo-create/references/spatial-and-film.md`.
These routes extend the table; they do not require loading every specialist.
