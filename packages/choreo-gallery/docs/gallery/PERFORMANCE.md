# Gallery rendering update — 2026-09-06

The room now mounts demos on demand. All 45 frames remain in the room; the overview uses static previews. Visited demos retain their DOM and state but skip layout/paint with content-visibility while parked. Only the focused demo runs. The highlights prewarm the next demo up to 2.4 seconds ahead.

The preview remains over the live canvas until its DOM, fonts and images are ready and two animation-frame paint opportunities have passed. It then fades out over 140 ms. When leaving, the preview covers the canvas before it is parked. Cancellation prevents a previous preparation from revealing the wrong tile. Native-size focus retains an independent compositing layer.

Camera writes are skipped when unchanged, viewport measurements are cached, and static tile matrices are cached. Animation-freezing reads are batched before writes, rather than scanning each subtree after every mutation.

## Reproducible lab comparison

Chrome, 390 × 844, DPR 3, 4× CPU slowdown; same initial four-second observation and six category moves. Reports: out/widget-perf-before.json and out/widget-perf-after.json. Run scripts/profile-widget-room.mjs. This is a desktop mobile simulation, not a physical iPhone measurement.

- Settled DOM: 2,965 → 553 nodes (81% fewer).
- Overview live demos: 45 → 0; all 45 previews available.
- Worst frame across six category moves: 808 → 21 ms.
- Frames over 50 ms during those moves: 32 → 0.
- Measured task duration: 15.22 → 3.15 seconds.
- Measured JS heap: 76.5 → 37.0 MB.

## Verification

- Chrome and WebKit: native CSS dimensions, same DOM and selected tab state after leaving/revisiting.
- Chrome and WebKit: deliberately gated image readiness keeps the preview opaque and the live content inert; no uncovered empty canvas during activation, departure or rapid reversals.
- WebKit: complete 50-second tour, all 23 automatic actions, no missed clicks, no page errors, at most one active demo. Finite animations pause and resume on the same node.
- Glint, targeted ESLint, formatting and production build passed.

Static previews show their captured state, so a crossfade can still change the visual state or responsive arrangement. The readiness fence prevents blank panels; it does not claim pixel-identical snapshots of every current demo state. Previously visited DOM remains allocated to preserve state, so memory grows as more demos are visited, while parked rendering stays suppressed.

## Hosted verification

Chrome and WebKit passed the delayed-image and reversal tests at the published URL. Both hosted WASM assets match the build byte-for-byte. The hosted WebKit tour completed 21 of 23 actions with no page errors; its two pre-existing misses remain the early Build Order range reset and Play actions. The local WebKit tour completed all 23. This remaining hosted tour issue is separate from the covered tile handoff and is not claimed fixed.

## Separate-clip narration reliability

Full-tour narration remains individual MP3 clips. Choreo still owns camera travel and minimum stop holds; the stop loop awaits real narration completion before advancing. The next clip is prefetched. A scoped playback helper removes stale handlers, retries transient AbortError playback failures after readiness, reloads a network-failed clip once, and resumes unexpected pauses when visible. Explicit Pause/Leave cancels the helper before pausing media. Autoplay permission denial still requires a user tap.

WebKit verification: six separate clips, an injected AbortError at the second clip, automatic advancement, unexpected pause recovery, explicit pause/resume and leaving the tour. No page errors. No combined track was shipped.
