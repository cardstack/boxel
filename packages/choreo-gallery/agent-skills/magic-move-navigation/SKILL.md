---
name: magic-move-navigation
description: >-
  The Magic Move route transition (gallery card ⇄ demo page): shared-element
  navigation built on animateView, and every subtlety that makes it hold
  60fps without flashing, freezing, or ghosting. Use when touching the route
  transition, adding a new paired element, porting the pattern to another
  app, or designing the future first-class Choreo tag for it.
---

# Magic Move navigation

The gallery ⇄ demo transition (`test-app/app/routes/application.ts`) is the
reference implementation: a route change captured as one shared-element
Magic Move on `animateView`. **The plan of record is to grow a first-class
Choreo component for this** — a route-level tag that absorbs the
orchestration below. Until it exists, this recipe IS the API: copy
`application.ts`, don't improvise.

## The cast (Keynote's grammar)

- **MOVES** — the same object in both scenes, paired with
  `.add(old, new)`: one layer that travels. Both renderings are stretched
  into that one box and crossfaded inside it — glyphs cannot morph into
  other glyphs, but one box can hold both while it grows. Here: the stage
  (`.card-stage` ⇄ `.stage-wrap`) and the three type lines (title, lede,
  group/kicker), each its own pair.
- **LEAVES** — old-scene-only furniture: fades out first (`.old`).
- **ARRIVES** — new-scene-only: fades in once the move is nearly home
  (`.new`, and `arriveLate` for the code panel and pager).
- **STEADY** — chrome identical on both pages (topbar, footer): one layer
  held at full opacity, not two snapshots dissolving into each other.
  Steady is conditional: the API pills are steady demo-to-demo but must
  crossfade when coming from the gallery, where there are none to be steady
  against — a "steady" layer with no old half arrives finished while
  everything else is still travelling.

## The load-bearing subtleties

Each of these was a shipped bug. In rough order of how expensive they were:

1. **Never name a container of named things.** The View Transitions API
   does not allow a named element to have independently-named descendants
   without nested-group setup. Pairing `.card-meta` while its children
   (title/lede/group) were named froze the ENTIRE page — not a glitch, an
   unrecoverable no-paint freeze, hard reload only.
2. **Never name the grid — the root snapshot is the point.** An element
   snapshot captures the element at full size; the gallery grid is
   twenty-six cards tall, and naming it hands the compositor a texture
   several screens high to fade every frame (measured: a fraction of
   60fps). The root snapshot is clipped to the viewport: one screen-sized
   texture, no names, no bookkeeping.
3. **Don't pair coextensive layers.** `.ex` fills its stage to within 2px;
   pairing both gave four large scaling blits a frame instead of two —
   the difference between 60fps and presenting every other frame. The
   inner element rides inside the outer's snapshot, unnamed.
4. **Veil the page BEFORE the snapshot.** The real page is blanked
   (`html.is-crossing > body`) so the root snapshot is a blank ground, not
   a frozen photograph of the old page. The `setTimeout(VEIL_OUT_MS)`
   before `animateView` must match the CSS veil duration, or the snapshot
   captures a half-veiled page. The veil is **theme-aware**: in light mode
   blanking to the html background reads as a white flash, so light keeps
   the body visible (`html[data-theme='light'].is-crossing > body`). Do
   not simplify either rule.
5. **The counterpart card is toggled, not named.** The card the stage
   flies from/to _contains_ four named pairs, so it cannot be named itself
   (rule 1) — but left alone its shell sits in the grid the whole flight:
   the "black box already in the right place" bug. `is-veiled` drops its
   background/border instantly (no CSS transition in either direction —
   removal lands on the exact frame the browser hands the DOM back), and
   it is unveiled on the morph's own clock (`setTimeout(morph * 1000)`),
   NOT from the completion callback — the poll behind that callback can
   fire a whole morph early mid-retarget.
6. **Overlap arrive and leave.** `leave` runs 0–42%, `arrive` 18–73%. A
   gap between them leaves a stretch where nothing covers the screen —
   unmistakable in slow-mo, a flash at speed. Likewise inside each pair:
   `fadeIn` (34%, easeOut) completes before `fadeOut` (62%, easeIn), so
   the pair covers its box the whole way and never dips toward the page.
7. **Pause everything else** (`quietTheRest`): every running document
   animation except `::view-transition*` pseudos is paused for the
   duration and resumed after. Two dozen live demos compositing under the
   morph is not dropped frames, it's erratic pacing (6 units, then 1,
   then 8). Pause, not cancel — loops resume where they were, so it is
   safe to do to work you didn't write. Run it twice: once before, and
   again inside the update for the arriving page's animations.
8. **Scroll inside the update.** The route swaps AND the window is placed
   where the new page wants it before the second snapshot — the scroll is
   part of the move, not something after it. Every arrival goes to the
   top (including demo→demo, reachable from the pager at the page's
   foot); only back-to-gallery restores the saved scroll position.
9. **Completion is polled, not awaited** (`whenEnded`): Motion retimes a
   transition by replacing its animations, so the set collectable at
   ready-time is not the set that finishes — awaiting it lifts the veil
   mid-morph. Poll `getAnimations()` for live `::view-transition` effects
   — slowly (≥250ms; the walk itself costs visible frames mid-morph),
   with a `morph + 800ms` deadline as backstop.
10. **Tempo composes in.** `morph = BASE * factor()`; every time in the
    choreography derives from `morph`, so the tempo control retimes the
    whole move coherently. `factor() === 0` means truly instant: no
    snapshot, no one-frame animation pretending to be none — just the
    route change plus a next-frame scroll. `--gm-morph` is set on the
    root as the CSS floor for any layer Motion isn't given keyframes for.
11. **Suppress landing entrances.** The gallery's cards check
    `isCrossing()` and mount already-at-rest — twenty-six entrance
    springs firing the moment the shared element arrives is the kink at
    the end of an otherwise smooth move.
12. **Both ends must hold proportions.** The pair is stretched into one
    box and crossfaded; if an element fills 91% of its card but 53% of
    its page stage, the two renderings cannot land on each other and the
    move ghosts. Size such content in container units (`cqw`/`cqh`) so it
    keeps one fraction at both scales (the Presence-demo fix).
13. **`crop(false)` throughout.** Motion's crop is `object-fit: cover`,
    which clips whatever changes aspect; the stylesheet's locked box
    stretches instead. `.group(false)` likewise — the pairs are flat
    layers, not nested groups.

## Known bug (open)

Returning from the Shared Layout demo (`tabs`) hard-freezes the page — DOM
and layout stay correct, nothing paints, only reload recovers. Best lead:
`SharedTabs` runs its own `layoutId` FLIP on the same frame the page
transition captures — the two layout engines may be fighting over one
element. See the comment above `pair()` before touching either side.

## Adding a paired element (checklist)

Same conceptual element on both pages? → add to `moves` with old/new
selectors via `ends()` and a `gm-move` class; confirm it has no named
descendants and no named ancestor (rule 1); confirm it isn't coextensive
with an existing pair (rule 3); check both ends hold proportions
(rule 12); test at slow tempo, in light mode, and the return trip.

Related: `motion-page-transition` (the general API), `choreo-scene`
(Choreo timelines — what the eventual route tag will compile this into).
