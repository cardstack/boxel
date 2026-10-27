# The assistant's motion

Everything that animates in the assistant panel is declared in this directory. Components elsewhere only say who they are, with glimmer-motion's `{{motion id= role=}}` or Choreo's `{{beacon}}`; nothing outside this directory names a duration, an easing or a step. Read this file to review the panel's motion against [ADR 007](../../../../../../docs/adr/007-keep-motion-a-reactive-layer-that-state-never-waits-on.md).

The assistant is the first part of operator mode to run on this model. The motion in draft PR #6325 (operator-mode stacks, dashboard tiles) is the feel this borrows: the same ease-out curve and card-sized durations. That PR got there with a `HostMotionService` that callers arm and that runs bitmap crossings around state updates, which ADR 007 turns down. Once the assistant's motion is settled, the rest of operator mode can recover #6325's scope the same way: participants declared by the components that render them, scores in one place, no service.

## Files

| File                    | What it holds                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tokens.ts`             | The curves (`EASE` out, `EASE_IN` for leavers), `DURATION` inside the ADR's ranges, `RISE`, `SETTLE_AFTER_MS`, and `motionEnabled()` |
| `transcript-motion.gts` | `TranscriptMotion` (the conversation) and `MessageMotion` (one message's parts)                                                      |
| `composer-motion.gts`   | `ComposerMotion`: the New Messages chip, the cap and its status                                                                      |
| `quick-look-motion.gts` | `QuickLookMotion`: the viewport layer Quick Look opens in                                                                            |

## Regions

### The conversation: `TranscriptMotion`, `@id='assistant-transcript'`

Mounted as the message list inside `AiAssistantConversation` (`message/index.gts`).

Participants: each message's section, `role='message'`, or `role='message-live'` while it streams; the id is the Matrix event id (`message/index.gts`).

Score, declared once the room's first render has settled (`SETTLE_AFTER_MS`), so opening a room never plays:

- moved messages: `c.Move`, translate only (`@size={{false}}`), on `DURATION.move`, `EASE_FOLLOW`: the whole conversation travels together, and a front-loaded ease put half of it in the first frame, which read as a jump;
- moved live messages: `c.Move`, translate only, on the same clock;
- inserted messages, live or not, are fixed to the block above them (`arriveWithBlockAbove`): an arrival starts where that block's move puts it and travels on its clock, so the two never overlap (ADR 013 §1.10, §1.20); with nothing above it moving, it fades in and rises `RISE` px;
- removed messages fade over `DURATION.exit`, `EASE_IN`.

### One message: `MessageMotion`

Mounted as each message's `.content`, nested inside the conversation.

Every region passes `@maxFrameStep={{MAX_FRAME_STEP}}` (20 ms): behind a long render a move slows for that frame instead of skipping ahead.

Idle (`@idle`) unless the message is in the room's latest turn, is streaming, or the reader pressed inside it in the last 2.5 s. A region runs on every render pass, so a long transcript with a live region per message spent most of each pass measuring messages that could not change.

Participants: the message's tool rows, `role='row'`, id = the tool call id (`matrix/room-message-tool.gts`).

Score: moved rows `c.Move`, translate only, with `@space='parent'` (not named while the message streams); inserted rows rise and fade in; removed rows fade.

### The composer: `ComposerMotion`, `@id='assistant-composer'`

Wraps the chip, the cap and the message box in `matrix/room.gts`.

Participants: the New Messages row (`role='chip'`, id `unread`, `room.gts`); the cap (`role='cap'`, id `composer-cap`, `room.gts`); each kind of cap status row (`role='cap-status'`, id `cap-status`, `ai-assistant/composer-cap.gts`).

Score: the cap rises 12 px out from behind the box and fades in, and sinks back as it leaves; a cap that changes size moves to its new place and takes its size at once (translate only); a change of status kind pairs the old row with the new and crossfades them over one box (`@swap='during'`, `DURATION.feedback`); the chip rises 8 px in and fades out.

### Quick Look: `QuickLookMotion`, `@id='assistant-quick-look'`

Mounted once, as a fixed full-viewport layer, in `operator-mode/submode-layout.gts`.

Participants: Pret UI's QuickLook sheet (`role='quick-look'`) and backdrop (`role='quick-look-backdrop'`), declared in `packages/pretui/components/quick-look.gts`. Beacons `ql:<owner>:<id>` on every card or file that can open one: CardPill and FilePill in the reader's bubble (`message/attachments.gts`) and card and file slots in an answer (`operator-mode/preview-panel/rendered-markdown.gts`, prefixed by `aibot-message.gts`). Beacons are document-wide, so the layer can sit outside the panel.

Score: the inserted sheet moves `@from` the source beacon with `@size='crop'` over `DURATION.space`; the backdrop fades in; the removed sheet moves `@to` the beacon and fades with `EASE_IN` over `DURATION.exit`.

## Against ADR 007

| Rule                                       | How this layer meets it                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.1 State never depends on motion         | Every change the panel animates is a plain state change that lands in its render: a message arriving, the cap's status, Quick Look's `current`. Nothing awaits an animation; there is no closing flag. Host tests run with the regions not mounted (`motionEnabled()`), and the DOM is the same with motion on, once settled.                                                                |
| §1.1 No state that exists for an animation | The one memory that serves motion, the last Quick Look source to fly back to, is kept by `QuickLookMotion` as a plain field, not by the service. The cap's hold through a gap between phases is a state rule about what the cap says, and plays with motion off too.                                                                                                                         |
| §1.2 One engine reacts                     | Choreo regions measure each render pass and play their score. No service, caller or component starts, sequences or checks an animation. The old `smoothHeight` modifier, the transcript's height transitions and the cap's `Presence @size` are gone.                                                                                                                                        |
| §1.3 Two levels of declaration             | Pret UI components and the host components that render rows and messages declare identity and role; the scores here say how changes move.                                                                                                                                                                                                                                                    |
| §1.4 Native machinery                      | Choreo plays through Motion's engine on the Web Animations API; runs show in devtools.                                                                                                                                                                                                                                                                                                       |
| §1.5 Purpose                               | Arrivals rise from where they'll live, leavers fade, the follow after a send carries the transcript instead of cutting it, Quick Look comes out of the pill that opened it. Streaming text gets no motion of its own.                                                                                                                                                                        |
| §1.5 Durations and easings                 | All from `tokens.ts`: 140 / 240 / 280 / 320 ms, ease-out in, ease-in out.                                                                                                                                                                                                                                                                                                                    |
| §1.5 Transform and opacity only            | Moves are FLIP transforms; in the transcript and the cap a size change lands at once (translate-only moves), so text never scales. Quick Look's sheet uses `@size='crop'`, which is not a pure clip: it scales uniformly by width with the top pinned and clips the extra height, so its contents scale while it flies to or from its source. Nothing animates height, width, top or margin. |
| §1.5 Interruption                          | Choreo retargets a running move from its painted position on the next pass.                                                                                                                                                                                                                                                                                                                  |
| §1.5 Reduced motion                        | Each region follows glimmer-motion's MotionConfig `'user'`: positional values land at once, fades remain.                                                                                                                                                                                                                                                                                    |
| §1.5 Latency                               | Quick Look shows the card's loading state inside the sheet; nothing waits on a flight.                                                                                                                                                                                                                                                                                                       |

## What building this suggests for the ADR

These came up while making the panel smooth, and the ADR doesn't decide them yet.

- **Scroll that a state change implies.** Settled now in the render pass: Choreo's barrier runs a SETTLE phase after mounts and before MEASURE (`registerSettle`), and the conversation registers StickToBottom's `settle()` there, so the motion layer measures the page with the reader's anchor already held. The protocol is `packages/pretui/docs/scroll-anchoring-protocol.md`; the ADR should state the rule.
- **Motion off in tests.** The ADR says the DOM must match with motion off, and leaves how to the host. Here the regions aren't mounted when `isTesting()`. A shared helper, or a MotionConfig that skips runs, would stop each surface choosing its own.
- **High-frequency change inside a scene.** A streaming message is declared with a different role (`message-live`) so the score moves it but never animates its growth. It works, but the ADR could name the pattern: high-frequency change is declared, not suppressed in the engine.
- **Nested regions and shared scrolls.** A nested region measuring in page space animates its sprites by a distance the outer region already covers. `@space='parent'` on the inner moves is the answer; it is worth stating for any nested scene inside a scroller.
- **One clock per scene.** Two steps in one score that move the same kind of shift at different speeds make neighbours overlap mid-flight. Shared durations for anything a single cause moves could be a quality rule.
- **The region's size.** The transcript mounts one region per message. That is cheap so far, but a long session could warrant measuring how many regions a pass touches.

- **A finished crop leaves its clip.** Choreo's `@size='crop'` ends with `clip-path: inset(0px)` inline on the element instead of removing it. On a transcript message that cut every ring and inset hanging into the gutter (framed rows, tables, card frames). The transcript's moves are translate-only until the engine releases the clip; ADR 007 §1.1's rule that the settled DOM matches motion-off would catch this if a test checked inline styles after a run.

## Known gaps

- A script row's steps can fold and unfold for a few frames as its checks start applying. That is the row's data changing, not motion, and is tracked separately.
- Tool-row card pills and the turn's changed files don't open Quick Look yet.
- No host test drives the regions with motion on. A test with `setupChoreo(hooks)` that interrupts a fold mid-flight and asserts `orphanCount() === 0` and no stranded transforms is the next step.
