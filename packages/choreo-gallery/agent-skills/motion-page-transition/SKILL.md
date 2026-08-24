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

## This app's route transition

The gallery ⇄ demo navigation is a full Magic Move recipe with a dozen
load-bearing subtleties (the veil, the root-snapshot rule, the
container-naming freeze, pausing live animations, polled completion, …).
That has its own skill: **`magic-move-navigation`**. Read it before
touching `test-app/app/routes/application.ts` or adding a paired element.

## When NOT

- Filtering/reordering/toggling within a page → `motion-layout`.
- One element morphing into another with real DOM continuity → `layoutId`.
- Anything that must keep animating during the transition → `motion-layout`.
