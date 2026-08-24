---
name: choreo-regions
description: >-
  Nested <Choreo> regions and far matching: composing multiple scenes in one
  tree, and flying one identity from one region into another (Boxel-style
  card moves between panels, workspaces, bays). Use when a UI has more than
  one <Choreo>, when deciding where region boundaries go, or when an element
  leaving one region must arrive in another as one continuous flight.
---

# Regions and far matching

## A region is a scene, not a provider

`<Choreo>` belongs around the machine it choreographs — the workspace, the
modal, the panel, the list. **Never wrap `body`**: one root region makes
every `id`/`role` in the app one changeset. Site-wide route motion stays on
`viewTransition`/`animateView` (`motion-page-transition`).

Discovery is nearest-wins: a `{{motion id= role=}}` registers with the
nearest `<Choreo>` ancestor, and a region's timeline collection skips any
child region. Two stacked `<Choreo>`s are two scenes, each with its own
snapshot, changeset, orphan layer, and run. Queries do not leak
(`shell.kept 'card'` never sees the panel's cards) and there is no shared
clock — the shell's `Sequence` does not wait for the panel's `Move`.

Where the boundary goes:

| Situation                                                | Region(s)                              |
| -------------------------------------------------------- | -------------------------------------- |
| Sidebar + main + drawer sharing one sequence             | one Choreo                             |
| A list with its own enter/leave inside a moving panel    | panel outer, list inner                |
| A modal with its own orphans over a page that also moves | page outer, modal inner                |
| "I need the trash can's box from the list"               | not a region question — a `{{beacon}}` |

Put `id`/`role` only on nodes that scene should see. An inner region
measures its own pass correctly even while an outer region is translating
the box it lives in — that is the intended answer to "a card controls its
own contents while a layout above moves it".

## Far matching — one identity, two regions

Without it, an element leaving region A and appearing in region B is a
death here and an unrelated birth there. With it, the two halves are paired
and the move reads as one continuous flight — the Boxel case: a card moving
between panels/stacks that are separate scenes on purpose.

**It is implicit — the API is the `id`.** Give the element the same bare id
in both regions (`atlas`, not `kiln-atlas`) and the barrier pairs an
inserted id in one region with a removed id in another. Region-scoping the
id is precisely how you turn it off.

Mechanics (all in `src/choreo/far.ts`):

- Every region animating this pass parks at a render-pass barrier, then
  three synchronous phases run with **no frame painted between them**:
  MEASURE (every region builds its changeset) → MATCH (inserted ids paired
  against removed ids in _other_ regions) → RUN (each region plays its own
  timeline).
- **The receiver flies.** It takes the sender's bounds (in PAGE space — the
  only space two regions agree on) as an `initial` it never had, and lands
  in the changeset as a `kept` sprite carrying the sender as its
  `counterpart`. The sender is dropped, not orphaned.
- Because the receiver is `kept`, every step that understands `kept` works
  across the boundary with nothing extra:

```gts
<c.Parallel>
  {{! one rule covers neighbours closing a gap AND the cross-region
      arrival — the arrival just has a bigger delta }}
  <c.Move @of={{c.moved 'piece'}} @spring={{carry}} @size={{false}} />
  <c.Hold @of={{c.moved 'piece'}} @zIndex={{layer}} />

  {{! these fire only when there was NO match (or matching is off):
      a matched sender is released quietly, a matched receiver is kept }}
  <c.Tween @of={{c.removed 'piece'}} @opacity={{0}} @ms={{200}} />
  <c.Tween @of={{c.inserted 'piece'}} @opacity={{1}} @from={{hidden}} @ms={{260}} />
</c.Parallel>
```

- Discriminate the flyer with a property function —
  `const layer = (s: Sprite) => (s.counterpart ? 6 : 1);` — so it passes
  over other regions' panels while gap-closers stay put.
- Selectors: `c.received 'piece'` matches far-match receivers (and
  same-region counterpart receivers); `c.counterpart` is same-region only,
  because a far match's sender is released to its own region.
- A missing pair is safe: no match means the ordinary inserted/removed
  steps handle it.

## Far match vs. its look-alikes

| Problem                                                        | Tool                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| Same identity, two regions, both real elements                 | far matching (same bare id)                          |
| Destination is a _place_ that must not deform (trash, compose) | `{{beacon}}` + `@from`/`@to` (see `choreo-scene`)    |
| Same identity, two elements, no Choreo involved                | `layoutId` (see `motion-layout`)                     |
| Cross-region _measurement_ only (read a box, nothing flies)    | beacon, or a `(sprite, changeset) => value` function |

## Testing

Interruption across the barrier is the risky case: after clicking
mid-flight, assert `orphanCount() === 0` and `strandedTransforms()` is
empty (`motion-testing`). `setupMotion(hooks)` resets the far-match
barrier between tests — required, or passes leak across tests.

Ground truth: `test-app/app/components/examples/far-match.gts` (three bays,
the on/off switch is just id scoping) and its Deep Dive note
`test-app/app/components/notes/far.gts`; design in `docs/nested-choreo.md`.
