---
name: choreo-scene
description: >-
  Scene-level choreography with <Choreo>: changeset-driven timelines over a
  whole render pass. Use in glimmer-motion / Choreo code in this repo
  (packages/glimmer-motion, packages/choreo, the Choreo gallery and test app,
  host UI that animates with them) when several elements must be sequenced
  ("fade out, THEN move, THEN fade in"), when z-index must hold for the span
  of a step, when one element's motion derives from another's measured bounds,
  or when something flies to/from a beacon (a place, not an element).
---

# A whole scene: `<Choreo>`

`{{motion}}` animates elements one at a time; what the screen does is
emergent. `<Choreo>` is for statements about a **render pass**: it watches
its region, computes the changeset — inserted / removed / kept participants
with bounds before and after — and plays your declared timeline over it.

```gts
import { beacon, Choreo } from '@cardstack/choreo';
import { motion, spring } from 'glimmer-motion';

<Choreo as |c|>
  {{#each @rows key='id' as |row|}}
    <article {{motion id=row.id role='row'}}>{{row.subject}}</article>
  {{/each}}

  <c.Sequence>
    <c.Tween @of={{c.removed 'row'}} @opacity={{0}} @duration={{0.16}} />
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
  freely. Steps: `c.Tween`, `c.Spring`, `c.Move` (FLIP kept sprites; by
  default it animates size too — `@size={{false}}` to move only, `'crop'` /
  `'scale'` to resize by transform), `c.Hold` (set properties for a window —
  **this is the whole z-index story**; `@fill={{true}}` to keep after),
  `c.Wait`. `c.Crossing` (the canned route crossing), `c.Gate`, `c.Follow`,
  `c.Tether`, `c.Raise`, `c.Scroll`, `c.Perform`, `c.Attach` and the camera
  steps are in `choreo-create/references/advanced-orchestration.md` and
  `spatial-and-film.md`.
- **Every time arg is seconds**: `@duration`, `@delay`, `@stagger` (the
  `@ms` / `@overlap` spellings throw, naming the seconds arg). Name a step
  with `@name` and place another against it with `@at={{at 'name' 0.4}}`
  or `{{after 'name'}}` (`at` / `after` from `@cardstack/choreo`).
- Selectors: `c.all` / `c.kept` / `c.inserted` / `c.removed` (optional role
  arg), `c.role 'card'`, `c.id 'card-1'`, `c.still` / `c.moved` (kept whose
  bounds did not / did change), `c.received` / `c.counterpart` (the two
  halves of a counterpart match — so a flight step fires only on flight
  passes, never on a plain resize). `c.onstage (query)` narrows a query to
  what the viewport can see.

## Values computed from other elements

Any property may be a function `(sprite, changeset) => value`, resolved at
run time. A keyframe pair states the start and the end in one value:

```ts
import type { Changeset, Sprite } from '@cardstack/choreo';

leftRange = (_s: Sprite, cs: Changeset) => {
  const bar = cs.sprite({ id: 'split-bar' });
  return [bar?.initial?.parent.width ?? 0, bar?.final?.parent.width ?? 0];
};
```

```hbs
<c.Spring @of={{c.id 'split-content'}} @left={{this.leftRange}} />
```

`cs.sprite()` returns null when the element is not in this changeset — a
region reconciling after its card unmounted, say — so never assert it away
with `!`: a throw inside the measure pass takes every region on the page
down with it (`split-view.gts` explains the incident).

## Beacons — a point, not an identity

When the destination is a _place_ that must not move or stretch (the trash
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
in another), and cross-region measurement: `choreo-regions`, and
`packages/choreo-gallery/docs/nested-choreo.md`.

## When NOT

One element, no ordering, no cross-element measurement → `motion-element` /
`motion-presence`. A pure layout move → `motion-layout`. Live route crossings → `magic-move-navigation`; intentional snapshots →
`motion-page-transition`.

Canonical demos, in `packages/choreo-test-app/app/components/examples/`:
`inbox.gts` (beacons), `sequence.gts`, `interrupt.gts`,
`slides.gts`, `far-match.gts`, `split-view.gts` (function values),
`lists.gts`. Design doc: `packages/choreo-gallery/docs/choreography.md`.
