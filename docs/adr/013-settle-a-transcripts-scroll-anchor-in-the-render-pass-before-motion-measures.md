---
status: proposed
date: 2026-10-21
scope:
  - packages/pretui/components/stick-to-bottom.gts
  - packages/choreo/src/far.ts
  - packages/choreo/src/choreo.gts
  - packages/choreo/src/run.ts
  - packages/host/app/components/ai-assistant/message/index.gts
  - packages/host/app/components/ai-assistant/message/aibot-message.gts
  - packages/host/app/components/ai-assistant/motion/*.gts
  - packages/host/app/components/ai-assistant/motion/tokens.ts
  - packages/host/app/components/ai-assistant/message/user-message.gts
  - packages/host/app/components/matrix/room.gts
  - packages/host/app/components/matrix/room-message-tool.gts
  - packages/host/app/lib/reply-furniture.ts
---

# 013. Settle a transcript's scroll anchor in the render pass, before motion measures

ADR 012 sets how the transcript's scroll owner holds one anchor through every change. This ADR adds what a transcript with a motion layer needs. The owner settles that anchor in the same render pass, before the motion layer measures, so what the reader looks at stays still and only what really moved on screen is animated. Every scroll lands inside a pass, the motion layer counts a scroll as a move, whatever scrolls with the messages takes part in their motion, and a move spends painted frames rather than wall time, so a follow glides even behind a long render. Only what can be seen is wired for motion; a load or a jump lands as layout puts it; and no two blocks are ever drawn over each other. And the latest turn gets shorter only when an activity ends: what it shows live and what it shows settled share one place, so the motion layer carries real change and never has to hide a furniture swap. §1.1 to §1.3, §1.5, §1.6 and §1.12 point to ADR 012; their numbers stay so that citations of them stay valid.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. One anchor, held through every change

ADR 012 §1.1 applies.

### 1.2. Only the reader leaves the end

ADR 012 §1.2 applies.

### 1.3. Layout, not paint

ADR 012 §1.3 applies.

### 1.4. Settle before measure

Where a Choreo region measures the transcript, the scroll owner MUST settle its anchor (ADR 012 §1.4) in the render-pass barrier's SETTLE phase (`registerSettle`), after the pass's mounts and before any region measures.

### 1.5. One scroll owner

ADR 012 §1.5 applies.

### 1.6. Proved by property

ADR 012 §1.6 applies.

### 1.7. Every scroll lands in a pass

A change to a followed or anchored transcript's scroll position MUST happen in the SETTLE phase of a render pass its motion regions watch. A scroll settled anywhere else (a resize observer, a late layout change) lands in one frame, because no region measures it.

### 1.8. A scroll is a move

A motion region inside a scroller MUST count a change in its ancestors' scroll offsets as a change in where its participants stand, both when it decides whether a pass during a run can be declined and when it compares the layout a run compiled in. A follow that lands while a move is running MUST be carried by the next run, not dropped.

### 1.9. What scrolls with the messages is a participant

Every block in a followed transcript that moves when the transcript follows (a message, a footer line, a status line) MUST be a participant of the transcript's region. A block that is not lands at its new place while its neighbours glide, and draws over them. A block that another one replaces (the session total moving into an answer's footer) SHOULD leave at once rather than fade where it stood.

### 1.10. An arrival travels with the block above it

A block inserted in a moving transcript MUST start where the block above it is drawn, offset as that block is, and travel on its clock, so the two keep their gap in every frame. It MUST NOT take its offset from the pass as a whole (a median of every move, say): a neighbour that moves differently from the rest leaves the arrival drawn over it. It SHOULD NOT fade while it travels: a later pass can recompile the run mid-arrival, and the fade does not survive the recompile.

### 1.11. A move spends frames, not wall time

A transcript move SHOULD start its clock on its first painted frame and advance at most one step (`@maxFrameStep`, the `MAX_FRAME_STEP` token) per painted frame. A long render then slows the move instead of skipping part of it. Moves that carry the whole transcript SHOULD use an evenly spread ease (`EASE_FOLLOW`), not one that does most of its travel in its first frames.

### 1.12. Whole pixels

ADR 012 §1.7 applies.

### 1.13. Both renderers, one size

A block drawn by one renderer while it streams and another once it settles MUST measure the same in both: the same spacing between blocks, the same line height, the same placeholder for a card that has not loaded, and the same reading of reply furniture (chip rows, pills). The swap then moves nothing, and the follow has nothing to correct.

### 1.14. A turn closes up only when an activity ends

In the latest turn, a block MUST NOT get shorter because furniture changed: a reply settling, a message being delivered, a footer moving to a later answer, or a state the room shows for a moment between a call's result and the answer that follows it. A finished activity (a call that ends, a row's steps folding) MAY close up, and the reader MAY collapse what they opened. The motion layer carries that change on one clock with its neighbours (§1.20).

### 1.15. Live and settled share a slot

A block's live form and its settled form MUST take the same place, and SHOULD take the same height. A live part that only says the obvious (that a running call can be stopped, beside the composer's own Stop) SHOULD NOT be drawn at all. The session's cost MUST show only in the latest answer's footer, not as a line of its own that comes and goes.

### 1.16. History keeps its footer

An answer's footer MUST stay, and stay visible, when a later answer supersedes it. Hover MUST NOT add height.

### 1.17. Proved by a ledger

A change to a message's furniture SHOULD be checked with a height ledger across one send with a tool call: every block of the latest turns sampled each frame, with no decrease that §1.14 doesn't allow.

### 1.18. Wire what can be seen

A transcript's motion region MUST measure and animate only the participants inside its scroller's view, or close enough to it that a move may bring them on screen (`@inView`; one view beyond each edge). The rest MUST be left to layout: no snapshot, no measuring, no motion. A participant coming within that margin is wired, and one leaving it is unwired; neither is an arrival or a removal. A participant a run is still moving MUST stay wired until a pass lets it go.

### 1.19. A load is not a change

What the reader didn't watch happen MUST land as layout puts it, unanimated: the room's first render and what it loads, a page of history, and a move longer than the wired margin (a jump). The transcript's region MUST sit out passes (`@idle`) until the room's history is in, and waking it MUST NOT replay what arrived while it sat out.

### 1.20. Never overlap

Two blocks of a transcript MUST NOT be drawn over each other in any frame. That holds when every wired block moves on one clock (§1.10), when anything a move can bring into view is wired (§1.18), and when a move that needs more than that lands instead (§1.19).

## 2. Rationale

ADR 012 §2 says why the scroll owner holds one anchor by priority.

Motion makes the timing matter. Choreo measures every render pass and animates what moved. If the scroll lands after it measures, the motion layer animates a jump the reader didn't cause, or freezes one it should have hidden. Settled before measure, the scroll is part of the state the pass produced (ADR 007 §1.1), and the motion layer sees the page as the reader will.

§1.7 to §1.13 came from measuring 4K recordings frame by frame, one send with a tool call in a session of about 200 messages, and fixing what each take showed:

- A turn settling dropped the transcript 80 px in one frame. Choreo's check for "nothing changed during a run" read offsets inside the region, which a scroll does not change (§1.8).
- A new bubble landed on the previous answer while the messages above it glided up (§1.10), and the session line, not a participant, did the same (§1.9).
- Moves started late in a long render, or behind one, skipped up to 70 ms on their first frame; with an ease-out that was half the move (§1.11).
- A reply grew or shrank as it settled: card links streamed as wrapped URLs, block spacing and line height differed, and a sentence naming code became a row of chips only once settled (§1.13).

§1.14 to §1.17 came from a height ledger of one send with a tool call. Every decrease in it was furniture coming and going, not content:

- the user bubble's "Sending…" line left on delivery (16 px);
- the tool row dropped from 90 px to 32 px when the call finished, losing its live line and its Stop receipt;
- the session line (16 px) and the answer footer (28 px) traded places at different heights;
- the previous answer's footer was hidden when the new one arrived. The room counts a turn as finished once its calls are applied, so for the 650 ms before the assistant's answer began, the previous footer went and came back.

The motion layer had been animating these shrinks. That made them smoother, not gone. Holding a finished row at the height it reached was tried and dropped: the held space read as uneven gaps between rows, and a reader rarely opens a finished row again, so a finished activity closes up instead.

§1.18 to §1.20 came from the same takes. On page load the transcript's score switched on after a fixed timer, while the room's history arrived later, so a 200-message history played as arrivals, each offset by a follow the height of the transcript, and every message was drawn over the others. And an arriving reply took its offset from the median move of the pass: the user bubble above it moved less than the rest, and the reply's first line was drawn over the bubble's last. Every snapshot also measured every message in the room, on every pass, though only a screenful could move on screen.

## 3. Considered options

- **The anchor settled in the SETTLE phase, before measure.** Chosen. The scroll is then part of the state the pass produced, and the motion layer measures the page as the reader will see it.
- ADR 012 §3 has the options for how the anchor itself is held.
- **Leaving ancestor scroll out of the layout fingerprint**, so a busy page cannot cancel a region's runs. Rejected for scroll: the page above reflowing is still left out, but a scroll moves every participant, and dropping it is what made follows land in one frame.
- **Fixed heights for messages and rows.** Rejected: a slot sized for its tallest state wastes space on every row that never reaches it, and one sized smaller clips. A block that keeps the height it reached is fixed only where it needs to be.
- **Animating a shrink instead of preventing it.** Rejected: the follow glides, but the reader still watches the transcript drop under them.
- **Wiring every message and skipping far ones when compiling the run.** Rejected: the measuring is the cost, and a block that isn't wired must not be read at all.
- **A fixed delay before motion starts.** Rejected: the history doesn't arrive on a timer, and whatever lands after the delay plays as arrivals.
- **Holding every block at the tallest height it reached.** Rejected: it fixed the shrink, and left uneven gaps under every finished row.
- **Fading arrivals during a follow.** Rejected: a second pass mid-arrival drops the fade and the arrival shows at full opacity over its neighbour.

## 4. Sources

- `packages/pretui/docs/scroll-anchoring-protocol.md`: the protocol and its build order.
- `packages/pretui/components/stick-to-bottom.gts`, `stick-to-bottom.test.gts`: the coordinator and its seeded property tests. With the correction disabled, every reading and pressed case fails.
- `packages/choreo/src/far.ts`, `packages/choreo/tests/integration/choreo/settle-test.gts`: the SETTLE phase.
- `packages/host/app/components/ai-assistant/motion/README.md`, "What building this suggests for the ADR": where the need first showed.
- `packages/choreo/tests/integration/choreo/run-clock-test.gts`, and the mid-run scroll case in `settle-test.gts`: §1.8 and §1.11, each failing with its fix disabled.
- `packages/host/tests/unit/reply-furniture-test.ts`, `card-ref-label-test.ts`: §1.13.
- `packages/choreo/tests/integration/choreo/in-view-test.gts`: §1.18 and §1.19.

## 5. Remediation

- `packages/choreo/src/run.ts`, a run compiled in a long task: §1.11. The first painted frame after a send still advances the follow by about 14% of its travel (19 px of 133 when the task before it took 87 ms): the run's clock counts part of that task despite the fresh-clock start.
- `packages/pretui/components/stick-to-bottom.gts`, `settle()` on a viewport resize: §1.7. The composer cap's slot now opens and closes over a beat, so the transcript follows it in small steps instead of dropping, but each step is settled from the scroll owner's ResizeObserver, outside a render pass.
