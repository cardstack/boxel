# Note — planes as iframes (research lead, not a plan)

Chris, 2026-08-27: look at whether planes can be **iframes**.

**Research first:** the iframe **sandboxing branch in the boxel monorepo
host app** — especially its **surface API** — before designing anything
here. That branch is the prior art for the isolation contract.

**Why it's attractive:** cross-DOM choreography buys us more
**processes** (each frame is its own renderer/compositor budget — a
heavy demo can't starve the world) and more **control over clocks**
(each surface gets a clock we own the seam of, instead of one page's rAF
carrying everything — see the two-clocks bug the loop protocol caught).

**What it costs, eyes open:**

- It demands being **super-disciplined about the coordinate contract**.
  `toPage`/`toLocal` (src/choreo/space.ts) would become the law at a
  process boundary, not just a convention inside one DOM — nothing can
  cheat with a stray `getBoundingClientRect` across the seam.
- A sprite crossing planes becomes a **teleport**: you pay the cost of
  redrawing the thing on the far side (serialize enough state to re-render
  it there; the far-match pair becomes a handoff message, and the
  counterpart crossfade is what hides the redraw).
- Probably **not one plane per iframe sandbox**. Expect an **n-to-m
  mapping of planes to frames, grouped by z-index** — planes that
  interleave in the stack must share a frame, planes that never cross
  can be isolated.

**Next step when picked up:** read the boxel sandboxing branch's surface
API, then write the smallest cross-DOM experiment: one world frame + one
overlay frame, a shared clock seam, and a single far-match teleport with
the crossfade hiding the redraw.
