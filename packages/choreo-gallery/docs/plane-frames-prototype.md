# Planes as iframes — the four-plane drag prototype

Live at `/_planes`. The smallest real answer to the research lead in
[planes-as-iframes-note.md](planes-as-iframes-note.md): four same-origin
documents composited into one screen, with a card dragged between two of
them. Styled and behaving like **bento-boxel** (its tokens, card grammar,
invite/hot states) so the prototype reads as a sibling of the real app.

## The cast

| plane | document | job |
| ----- | -------- | --- |
| 1 | `?role=app` | inert app chrome, its own process and rAF clock |
| 2 | `?role=panel&name=a` | **Panel A** — three bays, cards drag out and adopt in |
| 3 | `?role=panel&name=b` | **Panel B** — its twin; drops travel both ways |
| 4 | `?role=overlay` | the carried card and nothing else; `pointer-events: none` |

Files: host `test-app/app/components/plane-host.gts`; child (all four
roles) `test-app/public/planes/plane.html`; probe
`videos/choreo-sequence-reel/scripts/probe-planes.mjs`.

## The three laws the prototype proves

**The wire speaks page space.** Each plane converts at its own edge with
`toPage`/`toLocal` using the ONE rect the host assigns it
(`plane-geometry`). No child may read its own placement from ambient DOM —
the note's "nothing can cheat with a stray getBoundingClientRect across
the seam", enforced by construction: a child document simply has no way to
know where its iframe sits.

**A cross-plane move is a teleport, and a crossfade hides each redraw.**
Two teleports per drag: at pickup the overlay redraws the card at the
source's page rect (only once it confirms does the source ghost its
original), and at the drop the receiver redraws the card hidden in its
bay, reports the landed rect, the overlay flies there and fades OVER the
receiver's reveal. What crosses the boundary is an inert card record plus
page-space geometry — never DOM, never a live object.

**The gesture never moves; the visual does.** Pointer capture keeps
`pointermove` flowing to the source document even when the pointer is far
outside its iframe (clientX/Y just runs negative or past the edge, and
`toPage` still holds). The overlay is a visual, never an input surface.
This dissolves the "who owns the pointer mid-flight" problem entirely.

## Protocol (shaped on the boxel sandbox surface API)

Borrowed directly from the boxel monorepo's `sandbox-child-work` branch
(`sandbox-surface-transport.ts`, `sandbox-render-transport.ts`,
`sandbox-runtime-process.ts`):

- **Bootstrap announce:** child posts `plane-listening` up through
  `window.postMessage`; host answers `plane-connect` transferring one end
  of a private `MessageChannel`; all later authority rides the port.
- **Envelopes:** every message wears `kind` + `protocolVersion` and is
  type-guarded before dispatch; unknown messages are ignored.
- **Confirms time out:** requests that must not hang (`carry-start`,
  `adopt`, `land`, `carry-cancel`) carry a `requestId` and reject after
  3s of silence — boxel's "silence after render() resolves is a protocol
  violation". On any failure the host restores the source card.
- **Capability asymmetry:** panels can only report gestures and answer
  adoption; the overlay can only paint; geometry flows one way,
  host → child.

Message flow for one drag:

```
panel(src) → host   drag-start {card, bounds, grab}   (then drag-move stream)
host → overlay      carry-start {card, bounds, grab}  → ack
host → panel(src)   carry-confirmed                   (original ghosts)
host → panels       invite on
host → panel(hover) drag-over {point} → drop-target {bay, bounds}
pointer up:
host → panel(dst)   adopt {card, bay} → ack {bounds}  (hidden redraw)
host → overlay      land {bounds} → ack               (fly, then fade)
host → panel(dst)   reveal        host → panel(src)   release
     — or, no target —
host → overlay      carry-cancel {bounds: origin} → ack
host → panel(src)   restore
```

## Verified

`node scripts/probe-planes.mjs` (dev server on 4214) drives real CDP
mouse input through all three legs — A→B, B→A, and a dead-space release —
asserting after each that the receiving document owns the card at opacity
1, the source document does not, and the overlay is empty. All legs pass;
screenshots land in `renders/planes-*.png`.

## Known simplifications

- **No shared clock.** Each document runs its own rAF/WAAPI; the handoff
  is message-sequenced, not clock-synced. The reel's one-clock law
  (adoption/retiming) is the obvious next experiment here.
- Same-origin, zero sandboxing — the protocol shape is the point, not the
  isolation. Real isolation adds `sandbox` attrs + origin checks at the
  bootstrap listener.
- 1:1 plane-to-frame; the note's n-to-m grouping by z-index is untested.
- The follow lerp in the overlay is a stand-in for a real spring; landing
  uses a fixed cubic-bezier, not the engine's generator.
- Choreo itself is not involved yet: the host relay is hand-rolled. The
  end state is a `<Choreo>` region per plane with far matching across the
  frame boundary — the adopt/reveal pair IS a far match whose sender and
  receiver live in different documents.
