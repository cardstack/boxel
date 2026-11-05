---
status: proposed
date: 2026-10-21
scope:
  - packages/pretui/components/stick-to-bottom.gts
  - packages/pretui/docs/scroll-anchoring-protocol.md
---

# 012. Hold one scroll anchor per change, chosen by priority and read from layout

A live transcript changes height for many reasons at once: a reply streams, a
row grows its steps, a turn folds, a question collapses into its answer, a card
loads. Each one can move what the reader is looking at. The transcript's scroll
owner (StickToBottom) holds one anchor through every change. It chooses the
anchor by a fixed priority, reads it from layout, and settles it when the
render commits, so that a motion layer measuring after the commit sees the
scroll as part of the state. Only the reader leaves the end, and while the
reader scrolls, the position is theirs. The protocol itself is described in
`packages/pretui/docs/scroll-anchoring-protocol.md`.

## 1. Decision

### 1.1. One anchor, held through every change

A scroll container whose content changes under the reader MUST hold one anchor
across each change. One element keeps its distance from the viewport's top, or,
while following, the content's end keeps its distance from the viewport's
bottom.

The anchor MUST be chosen in this order:

1. the element the app asked to show, or the element focus moved to other
   than by a pointer press, for a moment after;
2. the element the reader pressed (by pointer, or Enter or Space), for a moment
   after, unless they have scrolled since;
3. the end, while following;
4. the element on the reading line, a third of the way down the view.

### 1.2. Only the reader leaves the end

Following MUST stop only when one of these happens:

- the reader's scroll input: a wheel, a touch, a scrolling key (also when its
  target is the document's body), or a press on the scrollbar;
- a pressed or focused anchor (§1.1, 1 and 2) that grows the content past the
  end;
- the owner's API (`navigate()`, `reveal()`);
- a scroll that the owner did not write and that no layout change caused. It is
  taken as the reader's.

A position that changes because the layout changed (content shrank, the
viewport grew) MUST NOT stop following. Following MUST start again only when a
scroll reaches the end (within the owner's threshold, and not while the
reader's own move up is still recent), by `scrollToEnd()`, or by a controlling
caller.

### 1.3. Layout, not paint

The anchor's position MUST be read from layout offsets, which a motion layer's
transforms do not move. The browser's own `overflow-anchor` MUST be off in a
container that holds its own anchor.

### 1.4. Settle when the render commits

The scroll owner MUST settle its anchor in the render commit of a change it is
told about (`@revision`, `@active`), not in the frame after. It SHOULD also
settle on resize, so the anchor holds through changes that no render makes. A
host with a motion layer SHOULD call `settle()` after the render pass commits
and before the motion layer measures.

### 1.5. One scroll owner

App code MUST NOT scroll a managed container itself, with `scrollIntoView` or
by setting `scrollTop`. It SHOULD go through the owner's API (`navigate()`,
`scrollToEnd()`, `reveal()`), which makes the target the anchor.

### 1.6. Proved by property

A change to the anchor's rules SHOULD keep the seeded property tests in
`stick-to-bottom.test.gts` passing. A new cause of a height change SHOULD get a
case there.

### 1.7. Whole pixels

The scroll owner MUST write scroll positions on whole device pixels, and MUST
ignore drift smaller than one device pixel.

### 1.8. A scroll in flight keeps its position

While the reader scrolls, a settle MUST hold only what layout moved since the
anchor was recorded, not the recorded offset. The reader scrolls from their
input until a short time after their last input or the last scroll that
followed it, so a touch's momentum stays theirs. While the owner's own smooth
scroll is in flight, a settle MUST NOT write a position; it MUST move the
smooth scroll's target by what layout moved, or to the new end while following.

## 2. Rationale

The transcript collected scroll rules one bug at a time: following pinned the
end, a prepend kept the first row still, a press counted as the reader's for
half a second, an upward scroll with no input re-pinned when heights changed,
and the room scrolled messages into view itself. Each rule was right alone. Two
causes landing in one frame resolved by event order, and the reader saw the
view yank. One invariant with one priority has no order to depend on.

Motion makes the timing matter. A motion layer measures each render pass and
animates what moved. If the scroll lands after it measures, the motion layer
animates a jump the reader didn't cause. Settled in the commit, the scroll is
part of the state the pass produced (ADR 007 §1.1).

A settle can run between the reader's scroll and its scroll event, for example
during a fast wheel. Holding the recorded offset then takes their last step
back. Skipping the correction instead lets content inserted above move them.
Holding only the layout move keeps both their step and their line (§1.8). The
same holds for the owner's own smooth scroll: an instant write cancels it
halfway.

A scroll that the owner did not write and that layout did not cause is
something the reader wanted: find in page, a focus scroll, a stray
`scrollIntoView`. While following, the next settle would pull it back to the
end, so it detaches (§1.2).

## 3. Considered options

- **One anchor by priority, settled in the commit.** Chosen. It is one rule, it
  doesn't depend on order, and it can be tested as a property.
- **The browser's `overflow-anchor`.** Rejected. The browser picks its anchor
  from painted boxes, which a FLIP transform moves, and it can't know what the
  reader pressed or that the app asked to show something.
- **A rule per cause** (prepend, expand, stream, cap). Rejected. It's what the
  transcript had, and the rules raced when causes shared a frame.
- **Correcting the scroll after motion runs.** Rejected. It runs one frame
  late, and the motion layer has already animated the wrong delta.
- **Timers to tell the reader's scrolls from the app's.** Rejected. A timer
  guesses intent that the input events already state. The owner's own scrolls
  are recognised by the position they aim at.
- **Smooth scrolling (`behavior: 'smooth'`) for the follow.** Rejected. The
  scroll animates outside the motion layer, which then measures a page in
  motion, and the reader's own wheel fights it.
- **Keeping following through a scroll nobody recognised.** Rejected. The next
  settle pulls the reader back to the end, away from what find in page or focus
  showed them.

## 4. Consequences

The motion layer's side of §1.4, a settle phase in a render-pass barrier that
calls each live scroll owner after mounts and before any region measures, is
not decided here. When it lands, it extends §1.4 by an edit to this ADR.

## 5. Sources

- `packages/pretui/docs/scroll-anchoring-protocol.md`: the protocol.
- `packages/pretui/components/stick-to-bottom.gts`, `stick-to-bottom.test.gts`:
  the scroll owner, its seeded property tests, and a test for each rule of §1.8
  and for each kind of reader input in §1.2.

## 6. Remediation

Known gaps are listed in [remediation/012.md](remediation/012.md).
