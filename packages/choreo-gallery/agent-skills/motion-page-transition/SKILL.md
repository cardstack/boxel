---
name: motion-page-transition
description: >-
  Page and route transitions with the View Transitions API via animateView /
  viewTransition — full-scene morphs between screens, Magic Move-style
  navigation. Use for route changes; also covers when a view transition is
  the WRONG tool (live/animated content) and the veil pattern this app uses.
---

# Page transitions: `animateView` / `viewTransition`

Two exports, one platform API:

- **`animateView(update, options?)`** — Motion's document-level builder:
  returns a `ViewTransitionBuilder` with `.add()`, `.class()`, `.crop()`,
  `.group()`, `.layout()`, `.old()`, `.new()`, `.enter()`, `.exit()`, auto
  names, spring-driven groups, queued interrupts. The `update` callback may
  be async (this wrapper runs it inside Ember's runloop for you).
- **`viewTransition(update, root?)`** — plain `startViewTransition`,
  optionally scoped to an element so a study morphs inside its own box
  without snapshotting the rest of the page. Falls back to just applying the
  update when unsupported, and **skips the transition entirely under
  prefers-reduced-motion** — you don't handle that.

Tag the elements that should fly with `view-transition-name` /
`view-transition-class` in CSS, then style `::view-transition-old/new/group`
pseudo-elements or drive them through the builder.

## The Keynote vocabulary

Think in three casts: **MOVES** (elements tagged on both sides — they morph),
**LEAVES** (only in the old page — fade out first), **ARRIVES** (only in the
new — fade in last). Sequencing those fades around the morph is what makes
it read as Magic Move instead of a crossfade soup.

## When a view transition is the WRONG tool

`startViewTransition` snapshots the page into **bitmaps** and animates the
bitmaps. Anything alive — running animations, video, canvas — freezes for
the duration. The gallery's filter deliberately uses `layout=true` +
`<LayoutGroup>` instead so two dozen live demos keep running while their
cards fly (see the comment block in `test-app/app/components/gallery.gts`).
Rule: **same-page state change → layout animation; cross-page navigation →
view transition.**

## Patterns already in this app (read before touching)

`test-app/app/routes/application.ts` orchestrates route transitions:

- The **veil**: `html.is-crossing` blanks `body` during the morph so the
  root snapshot is empty rather than a photograph of the old page — and it
  is theme-aware (`html[data-theme='light'].is-crossing > body { opacity: 1 }`)
  because blanking to the html background reads as a white flash in light
  mode. Do not "simplify" this.
- Non-tweening elements fade out before the morph and back in after it
  settles (`VEIL_OUT_MS` / `VEIL_IN_MS`).
- The grain texture fades out before and back in after, so the transition
  happens on a clean ground.
- Shared tiles: the demo card on the gallery and the stage on the demo page
  carry matching view-transition names; both sides must render the element
  at a size that holds the same proportions or the morph ghosts (the
  Presence tile bug — sized in container units for exactly this reason).

## When NOT

- Filtering/reordering/toggling within a page → `motion-layout`.
- One element morphing into another with real DOM continuity → `layoutId`.
- Anything that must keep animating during the transition → `motion-layout`.
