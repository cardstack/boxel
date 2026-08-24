---
name: motion-presence
description: >-
  Enter/exit animation with <Presence> (AnimatePresence): animating elements
  as they are added to or removed from the DOM — lists, toasts, modals,
  wizards. Use whenever an element must animate OUT, or when choosing between
  sync/wait/popLayout modes.
---

# Arriving and leaving: `<Presence>`

An element Glimmer has removed is gone — there is no frame left to animate.
`<Presence>` keeps a removed item rendered until its `exit` finishes.

```gts
import { motion, Presence, to } from 'glimmer-motion';

const keyOf = (todo) => todo.id;

<Presence @items={{@todos}} @key={{keyOf}} as |todo h|>
  <li
    {{motion
      presence=h
      initial=(to opacity=0 x=-20)
      animate=(to opacity=1 x=0)
      exit=(to opacity=0 x=20)
    }}
  >{{todo.title}}</li>
</Presence>
```

- `@key` decides identity (same job as `key` on `{{#each}}`). The block
  yields the item and a **handle**; the handle goes into `presence=` on the
  element that owns the exit. `h.isPresent` is tracked.
- Single conditional element? Model it as a 0-or-1-item array
  (`get panel() { return this.open ? [{ id: 'panel' }] : NO_PANEL; }` — see
  `gallery.gts`).
- `@mode`: `"sync"` (default — leavers and newcomers together), `"wait"`
  (newcomer holds until the leaver finishes), `"popLayout"` (leaver out of
  flow immediately so siblings close up; `@anchorX`/`@anchorY` available).
- `@initial={{false}}` skips the first-render entrance. **Caution:** the
  presence context is inherited — blocking the first entrance blocks it for
  every motion node inside the block too. If children animate on mount,
  prefer a tracked getter for `initial` (the gallery's `entrance` getter)
  over `@initial={{false}}`.
- `@onExitComplete`, `@custom` (for exit-direction), nested presence under a
  leaving parent: `@propagate={{true}} @parent={{outerHandle}}`.

## The rule that bites

**A leaving child stays live.** React freezes a leaver's tree; a Glimmer
block re-runs from live tracked state while the leaver plays its exit. So
anything the exit needs — the label the panel showed, the row the modal flew
from — must ride on the item `<Presence>` yields, not be read back out of
state that has already moved on. The modifier freezes an exiting element's
*props*, but your template's own bindings are yours to keep stable.

## When NOT

- Many elements whose exits/moves/entrances must be **ordered** relative to
  each other → `<Choreo>` handles leavers itself (removed participants stay
  on screen for as long as the timeline names them; no `<Presence>` needed).
  See `choreo-scene`.
- The element isn't leaving, just moving → `motion-layout`.

Canonical demos: `presence-modes.gts` (the three modes side by side),
`shared-tabs.gts` (presence + layoutId handover), `sheet.gts`.
