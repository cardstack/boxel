# Scroll anchoring: one protocol for where the reader's view stays

Status: built in StickToBottom (`settle()` and `navigate()` on its API), with seeded property tests in `stick-to-bottom.test.gts`. [ADR 012](../../../docs/adr/012-hold-one-scroll-anchor-per-change-chosen-by-priority-and-read-from-layout.md) states its rules. The settle phase in Choreo's render-pass barrier (below) is not built yet.

## The problem

A transcript changes height all the time, for many causes:

- a reply streams;
- a row's steps grow;
- a turn folds or unfolds;
- a question collapses into its answer;
- an image or card loads;
- the cap above the message box grows;
- the reader opens a disclosure;
- a motion layer moves things with transforms while their layout has already moved.

Every one of these can move what the reader is looking at. A scroll owner can answer them with one rule per cause:

- following pins the end;
- a detached reader's top element is put back after a resize;
- a prepend keeps the first row still;
- a press in the content counts as the reader's for 500 ms;
- an upward scroll with no input re-pins when the heights changed;
- the app has its own scroll-into-view branches.

Each rule is right on its own, but they don't compose. When two causes land in one frame, which rule wins depends on event order: a click that collapses a question while a reply streams, or a turn that folds while the cap grows. That's the yank the reader sees.

The fix is one invariant, held by one owner, at one moment in the frame.

## The invariant

> In every render pass, one element is the **anchor**, and its top edge keeps the same distance from the viewport's top, by layout, from before the pass to after it. The one exception: when the anchor is the **end** (following), the content's bottom edge keeps its distance from the viewport's bottom.

Everything else follows from that:

- Content that changes below the anchor moves nothing the reader sees above it.
- Content that changes above the anchor is paid for with a scroll correction of exactly the anchor's layout shift.
- What moves on screen is only what changed between the anchor and the edge the change happened on. That's what the motion layer then animates.

This is an algorithm, not a set of heuristics. The work is choosing the anchor well and correcting at the right moment.

## Choosing the anchor

Each pass picks the first of these that holds:

| Priority | Anchor                | Holds when                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | **Navigation target** | the app asked to show something: the jump chip, "go to the waiting row", `reveal(id)`, a Quick Look closing back to its source; or focus moved into the content other than by a pointer press (Tab, a skip link, the app's `focus()`), which the browser scrolls into view | the app's intent is explicit; once it arrives, the target becomes the reading anchor                                                                                                                               |
| 2        | **Pressed element**   | the reader pressed something in the content (pointer, or Enter or Space; focus that code moves does not count) less than 2 s ago and hasn't scrolled since: a toggle, a choice, Undo, a disclosure                                                                         | what they touched stays under their pointer, so an expand grows downward from it and a collapse shrinks toward it (macOS disclosure behaviour)                                                                     |
| 3        | **End**               | following: the reader is at the end and hasn't left it by their own input                                                                                                                                                                                                  | new content arrives below, and the end stays in view                                                                                                                                                               |
| 4        | **Reading line**      | otherwise                                                                                                                                                                                                                                                                  | the element crossing a line about a third of the way down the viewport, with its offset from that line: where eye-tracking puts a reader's attention, steadier than the top edge, which half-hidden elements cross |

Priority 2 outranks 3 on purpose. A reader at the end who opens a fold shouldn't be pulled to the new end; they're reading what they opened. The pressed element is the anchor, not a timer that guesses.

**What counts as an element.** Anchor candidates are the elements marked `data-scroll-anchor`: messages, rows, steps, answer blocks. Picking the deepest marked element that crosses the line keeps the anchor small enough to stay still while its parent grows around it (a message that streams below the step being read). In unmarked content, the anchor is the smallest element the line crosses.

**Where the reader is.** Following stops on:

- the reader's scroll input: a wheel, a touch, a scrolling key (also when its target is the body, as after a click on text), a press on the scrollbar;
- a pressed or focused anchor (priority 1 or 2) that grows the content past the end: the reader caused it, and is reading what grew;
- `navigate()` or `reveal()`;
- a scroll the component did not write and no layout change caused (find in page, a stray `scrollIntoView`): it is taken as the reader's, because the next settle would otherwise pull it back to the end.

A layout change alone (content shrank, the viewport grew, a clamp) never stops following; the clamp is corrected. Following starts again when a scroll reaches the end, or by `scrollToEnd()`.

## When to correct: inside the render pass, before motion measures

The correction must land after the DOM for the pass is in, and before anything measures or paints. StickToBottom settles in the render commit of a change it is told about (`@revision`, `@active`), and in the commit of a render pass that a resize starts. A host with a motion layer calls `settle()` after the pass commits and before the motion layer measures.

Choreo's render-pass barrier (`far.ts`) has that moment: `runBarrier()` calls `beforeMeasure()` (Choreo's own mount flush), then every region's `measurePass()`, then MATCH and RUN. The plan adds a **SETTLE** phase there (not built yet):

```
render pass commits DOM
  └─ Choreo barrier (afterRender)
       0. MOUNT    flush pending mounts                      (exists)
       1. SETTLE   every scroll owner holds its anchor        (planned)
       2. MEASURE  every region builds its changeset          (exists)
       3. MATCH    far matching across regions                (exists)
       4. RUN      every region plays its score               (exists)
  └─ browser paints
```

The protocol, per scroll owner:

1. **Record (end of every pass, and on every reader scroll):** the anchor element (by the priority table) and its offset in the viewport, by layout: `layoutTop(anchor) − scrollTop`. For the end anchor, record `scrollHeight − scrollTop − clientHeight`.
2. **Settle (phase 1 of the next pass):** read the anchor's new layout top and correct the position as below. Then re-record. If the anchor element left the DOM, fall back to its nearest surviving marked ancestor.
   - Normally the recorded offset is held: `scrollTop += layoutTop(anchor) − scrollTop − recorded`. This also undoes a clamp when content shrank. For the end anchor, pin the end.
   - While the reader scrolls (their input, or a scroll that follows it such as momentum, within a short window), only what layout moved is held: `scrollTop += layoutTop(anchor) − recordedLayoutTop`. A settle can run between their scroll and its scroll event, and holding the offset would take their step back.
   - While the component's own smooth scroll is in flight, nothing is written: the smooth scroll's target moves by `layoutTop(anchor) − recordedLayoutTop`, or to the new end while following, so the scroll is not cut short.
3. **Measure (phase 2):** Choreo measures in the scroller's viewport space after the correction. An element that holds its place on screen reads as not moved and gets no animation. Only what really moved on screen gets a FLIP, from its painted position before to its new one.

**Layout, never paint.** The anchor's position is read from layout offsets (an `offsetTop` chain), which a running FLIP's transforms don't move. Choreo works from painted positions for its starts; the anchor works from layout for its correction. The two never fight: the correction is a layout fact, and the motion is drawn on top of it.

**One pass, one clock.** Every cause that lands in the same frame is settled once, together, against one anchor. A click that collapses a question while a reply streams is one correction, not two that race.

**Outside a render pass.** Some changes don't come from a render: an image decodes, fonts swap, the viewport resizes. The scroll owner's ResizeObserver starts a render pass (`onResize`) and settles in its commit, so the motion layer measures that pass with the anchor held, as it does for a change from a render.

## Architecture

| Piece               | Where                                                                                                                                                | Does                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScrollCoordinator` | Pret UI, inside StickToBottom (one per scroller)                                                                                                     | holds the mode (follow or read), the navigation target and the pressed element with their times, and the recorded anchor; runs `record()` and `settle()` |
| Anchor marks        | `data-scroll-anchor` on messages, rows, steps, answer blocks                                                                                         | bounds anchor candidates; no runtime cost                                                                                                                |
| Reader input        | the existing wheel, touch, key and scrollbar listeners                                                                                               | the only path that changes the mode                                                                                                                      |
| Navigation API      | `api.reveal(id)`, `api.scrollToEnd()`, `api.navigate(element, block)`, instead of the app's own `scrollIntoView` calls; focus moved into the content | sets priority 1                                                                                                                                          |
| Press tracking      | `pointerdown`, and Enter or Space, in the content                                                                                                    | sets priority 2 (element and time)                                                                                                                       |
| SETTLE phase        | planned: Choreo's barrier, run after MOUNT and before MEASURE                                                                                        | calls each live coordinator's `settle()`                                                                                                                 |
| Fallback            | the coordinator's ResizeObserver                                                                                                                     | starts a render pass for changes outside one, and settles in its commit                                                                                  |

Prepend is "anchor = reading line" with nothing special about it. Send is "mode = follow". The jump chip is a navigation.

**ADR 007 fit.** Scroll position is state, and it's settled before motion measures, so state never waits on motion (§1.1). One engine reacts (§1.2). ADR 012 records this as a decision.

## Proving it

The invariant is testable without a person watching:

- **Property test** (kit, in the browser). Build a transcript of random rows. Apply random batches of operations in one pass each: insert above, below or inside the anchor; grow or shrink any row; fold or unfold; resize the viewport; press a random element first; scroll by input or by API. After every pass, assert the anchor's viewport offset is unchanged within 0.5 px, the end is pinned exactly when following, and the mode changed only on input. Run a few thousand seeded cases; a failure prints its seed and its operation list.
- **Motion check.** With Choreo regions on, the same sequences assert that no element's painted top jumps more than its own layout delta in one frame (a probe of each element's painted top, made a test helper), and that `orphanCount()` is 0 after interruptions.
- **Live probe.** A follow-gap sampler (every 100 ms: mode, gap, heights) as a dev-only overlay, so a reader reporting "it yanked" can turn it on and send the trace.

## Build order

1. **Coordinator in StickToBottom**, with the priority table, anchor marks and property tests. Built.
2. **SETTLE phase in Choreo**, so the coordinator settles in it when a region is live and motion animates only what moved on screen. Not built. This is a Choreo change, so its PR title takes a conventional-commit prefix (`feat(choreo): …`).
3. **The app's own scrolling moves onto the API** (`navigate`, `scrollToEnd`). Not in this package.
4. **ADR**: ADR 012, proposed.

## Open questions

- **The reading line.** One third of the way down is a guess from reading research. It should be a token, tuned by watching where readers' last presses and selections land.
- **Two scrollers.** When one scroller is inside another (a code block or table inside the transcript), the inner one settles first, then the outer. The barrier runs scroll owners innermost first.
- **Smooth navigation.** A smooth `navigate` spans several frames. The coordinator moves the smooth scroll's target by what layout moved and writes no position while it is in flight. Whether a settle should also re-aim at the target element when the target's own height changes is open.

[ADR 012](../../../docs/adr/012-hold-one-scroll-anchor-per-change-chosen-by-priority-and-read-from-layout.md) numbers the rules this protocol keeps. A change to scroll or follow behaviour updates ADR 012 in the same change.
