---
name: choreo-scene
description: >-
  Scene-level choreography with <Choreo>: changeset-driven timelines over a
  whole render pass. Use when several elements must be sequenced ("fade out,
  THEN move, THEN fade in"), when z-index must hold for the span of a step,
  when one element's motion derives from another's measured bounds, or when
  something flies to/from a beacon (a place, not an element).
---

# A whole scene: `<Choreo>`

`{{motion}}` animates elements one at a time; what the screen does is
emergent. `<Choreo>` is for statements about a **render pass**: it watches
its region, computes the changeset — inserted / removed / kept participants
with bounds before and after — and plays your declared timeline over it.

```gts
import { Choreo, motion, spring } from 'glimmer-motion';

<Choreo as |c|>
  {{#each @rows key='id' as |row|}}
    <article {{motion id=row.id role='row'}}>{{row.subject}}</article>
  {{/each}}

  <c.Sequence>
    <c.Tween @of={{c.removed 'row'}} @opacity={{0}} @ms={{160}} />
    <c.Move @of={{c.moved 'row'}} @spring={{spring stiffness=300 damping=24}} />
  </c.Sequence>
</Choreo>
```

- Participants are normal motion elements with two extra args: `id`
  (identity) and `role` (the group a step selects). Everything else about
  them (`animate`, `drag`, `layout`) still works.
- **Leavers are handled for you**: a removed participant stays on screen,
  locked where it stood, exactly as long as the timeline names it. No
  `<Presence>` inside a Choreo scene.
- Blocks: `c.Sequence` (one after another — including after a spring, whose
  length is computed with the engine's generator) and `c.Parallel`; nest
  freely. Steps: `c.Tween`, `c.Spring`, `c.Move` (FLIP kept sprites;
  `@size={{false}}` to move only), `c.Hold` (set properties for a window —
  **this is the whole z-index story**; `@fill={{true}}` to keep after),
  `c.Wait`.
- Selectors: `c.all` / `c.kept` / `c.inserted` / `c.removed` (optional role
  arg), `c.role 'card'`, `c.id 'card-1'`, `c.still` / `c.moved` (kept whose
  bounds did not / did change), `c.received` / `c.counterpart` (the two
  halves of a counterpart match — so a flight step fires only on flight
  passes, never on a plain resize).

## Values computed from other elements

Any property may be a function `(sprite, changeset) => value`, resolved at
run time:

```ts
contentLeft = (_s: Sprite, cs: Changeset) =>
  cs.sprite({ id: 'sidebar-container' })!.initial!.context.width;
```
```hbs
<c.Spring @of={{c.id 'sidebar-content'}} @left={{this.contentLeft}} />
```

## Beacons — a point, not an identity

When the destination is a *place* that must not move or stretch (the trash
can, the compose button):

```gts
<span class='trash' {{beacon 'trash'}}>…</span>
<c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} @spring={{toss}} />
```

A beacon never joins a changeset; it only says where it is. The registry is
document-global on purpose (chrome and outlet are separate regions).
`layoutId` is the wrong tool here — it would morph the bin.

## Nesting

An inner `<Choreo>` is a separate scene — the outer region does not see its
participants. Regions, far matching (an id leaving one region and appearing
in another), and cross-region measurement: `docs/nested-choreo.md`.

## When NOT

One element, no ordering, no cross-element measurement → `motion-element` /
`motion-presence`. A pure layout move → `motion-layout`. Route changes →
`motion-page-transition`.

Canonical demos: `inbox.gts` (beacons), `sequence.gts`, `interrupt.gts`,
`slides.gts`, `far-match.gts`, `split-view.gts` (function values),
`lists.gts`. Design doc: `docs/choreography.md`.
