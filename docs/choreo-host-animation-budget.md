# Host choreography budget

The host chooses what deserves to move. Choreo executes that choice. Priority is direct manipulation, then one primary composition with explicitly budgeted boundary matches, then supporting fades. Ordinary rendering has no navigation score.

## What was ported from bento-boxel

Studied `~/projects/bento-boxel/app/components/workspace.gts`, `app/components/doc-index.gts`, `app/components/document-view.gts`, `app/lib/crossings.ts`, and `app/lib/morph.ts`.

The reference gives the cover and document one identity, arms its Crossing only for the navigation, and retires the score after the surviving run finishes. Its reference duration is 520 ms; the host's faster preset is now 360 ms opening and 260 ms returning. Host uses Choreo's `createArming` for this lifetime, and its `animateView` bitmap adapter for cross-page boundary matching. The bitmap adapter replaces the reference's live-element scaling so text cannot be stretched. The selected preview and destination are measured rather than estimated from generic card dimensions.

## Allocations

These are limits on simultaneous visual work, not purported percentages of hardware capacity. Frame time depends on the device and card contents.

| Interaction                          | Primary allocation                                                                                                                                              | Supporting motion                                                                                                                                                                                                                   | Lifetime / priority                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Pointer drag / resize                | Direct manipulation owns the interaction                                                                                                                        | Optional host playback is completed and retired                                                                                                                                                                                     | Highest priority; no interpolation clock inserted between pointer and dragged surface                                 |
| Index preview → stack                | Two parallel card boundaries in one 360 ms composition: workspace → underlying card, selected preview → top card; proportional bitmaps and interpolated corners | One content-pane bitmap scales uniformly and fades away. The persistent workspace header has three small matched parts: surface, title and realm icon. All share the primary clock; no separate stack lift or unrelated-card tweens | All matches are inserted for this action and removed together; no match for ambiguous or invisible previews           |
| Stack × → index preview              | The same two boundaries in reverse, 260 ms, with a prompt departure and damped landing                                                                          | The parent header/title/icon return together; resolve the newly visible tile after layout                                                                                                                                           | Missing/ambiguous tiles and multi-card trims do not invent return targets; no retained DOM references between actions |
| Search result → stack                | One selected tile → card bitmap boundary, 320 ms                                                                                                                | Search and stack geometry scores suppressed                                                                                                                                                                                         | Same exclusive allocation and drag preemption                                                                         |
| Stack open without a visible preview | One arriving card, 280 ms                                                                                                                                       | Other stack members settle; visible opacity changes can fade                                                                                                                                                                        | Explicit stack mutation arms the score                                                                                |
| Stack close                          | One revealed card may reposition, 280 ms                                                                                                                        | Departing surface fades, 180 ms                                                                                                                                                                                                     | Explicit stack mutation; only the selected destination owns reflow                                                    |
| Expand / restore header              | One selected header assembly, 280 ms                                                                                                                            | Its empty surface changes shape; title, icon and controls translate at natural proportions                                                                                                                                          | Temporary header score; unrelated headers do not match                                                                |
| Search dock / prompt / results       | One search-sheet surface, 240 ms                                                                                                                                | Header translates without scaling; content fades                                                                                                                                                                                    | Explicit size changes arm the score; typing into unchanged results does not                                           |
| Dashboard → workspace                | One wallpaper portal, first 220 ms of a 400 ms sequence                                                                                                         | Index fades in during the remaining 180 ms; no competing card translation                                                                                                                                                           | Portal token owns the scene; stack and search allocations excluded                                                    |
| Workspace → dashboard                | Index fades first, 160 ms                                                                                                                                       | Wallpaper is the sole shape transition during the remaining 240 ms                                                                                                                                                                  | Same exclusive portal lifetime                                                                                        |
| Idle / card data refresh             | None                                                                                                                                                            | None from host navigation choreography                                                                                                                                                                                              | No armed timeline; no drag listener doing frame work                                                                  |

## Runtime contract

- The budget service never drives a frame. Choreo and browser-native animation controls own playback.
- Arm before the state mutation. Insert only that action's score. Bind only its selected primary identity.
- A higher-priority interaction completes optional playback at the destination before removing its allocation. Never strand an intermediate transform, clipping rectangle or opacity.
- Use the surviving run's completion to retire a score. A stale completion cannot remove a newer allocation.
- Source DOM references remain local to capture; stack state carries only temporary geometry and a destination key. The index match is cleared after the handoff.
- Layer order: workspace frame 0; proportional content pane 1; header surface 2; title and realm icon 3; selected card 4; stationary toolbar / assistant panel 5; closed search dock, neighbor-stack edge controls and assistant corner button 6. All groups are flat, so the selected card and header content cannot inherit the workspace body's scale or clip. Chrome is captured only to preserve occlusion; it has no travel animation, in either direction.
- The content pane uses `object-fit: contain`, anchored at the top center, in its own un-cropped bitmap group. Its source viewport scales uniformly into the buried body area and fades out; the reverse fades the full content bitmap in as it expands. A temporary empty frame measures the snapshot footprint independently of the hidden body's retained layout. Both the frame and its match are removed after playback.
- Match the persistent header rather than dissolving it inside the body snapshot. Its centered title uses `object-fit: none` in both captured faces: the surrounding flex space may change width, but glyphs keep their natural size. The realm icon uses `object-fit: contain`, preserving its square proportions as it moves to the smaller buried header. Header surface, title and icon resolve their new DOM counterparts after rendering, then release every temporary identity.
- Reduced motion uses immediate navigation. Missing, offscreen or ambiguous source identities use the regular entrance instead of guessing a match.
- The same card-identity lookup applies at every stack depth and for all actions routed through the host's `viewCard`. A fitted/embedded identity with `display: contents` resolves to its single rendered descendant surface; boxless ancestors do not clip the measurement. Multiple surfaces remain ambiguous. The reverse resolves that surface again after the parent returns, with no realm-specific selectors or retained DOM references.
- An unchanged matched header uses one visible snapshot face throughout its geometry tween. Crossfading identical old/new glyphs would produce a double print at intermediate sizes.
- Supporting fades are lower cost than shape/layout changes, but still consume compositing bandwidth. They are not free.

## Click responsiveness

For a matched stack push, construct the lightweight destination frame/header first. Choreo captures that endpoint and begins native playback before the card renderer and overlay tree mount. A one-shot two-frame paint boundary releases the content; a 100 ms timer backs it up in background tabs, and completion/interruption always reveals it. This scheduler does not drive any tween. The browser's live incoming view-transition face receives the new content during playback.

A matched parent's existing body layout is retained at its last visible dimensions while buried, invisible and inert. It is not reflowed to the narrow stack width, then expanded again on return. No old bitmap is retained between actions. The separate empty body frame continues to supply the small proportional fade destination; its snapshot identity still exists only during the crossing.

Use an optimized production build for interactive previews (`mise exec -- pnpm build:production`, or `mise exec -- pnpm exec vite build` with a separate output directory). The package's plain `pnpm build` deliberately uses development mode for tests, including debug runtime overhead and unminified code. Backend selection is independent: the production bundle here still connects to staging.

## Performance recording

Load a preview URL with `motionTrace=1` for lightweight interaction records in the `host-motion-inspection` JSON script. The recorder collects frame-callback intervals, long tasks, Long Animation Frame script attribution, and User Timing phases: capture-start, update-start/end, playback-ready and finished. It performs no per-frame geometry reads or animation enumeration. It is opt-in and installs no observer or frame loop in the normal preview.

Use `motionInspect=1&motionSpeed=0.1` separately to inspect geometry and z-order. That mode deliberately measures rendered elements and native tracks; its frame timings include diagnostic overhead. Avoid benchmarking while builds or typechecks are running. Neither recorder measures GPU time or directly counts compositor-dropped frames.

## Verification

Focused tests inspect both boundaries at departure, quarter-time and arrival, require synchronized progress and explicit back/front ordering, require unscaled live typography, and require released snapshot identities. The header fixture replaces its DOM during navigation and checks the matched title and realm icon's start/end bounds, natural glyph sizing, proportional icon scaling, occlusion layers and cleanup. Existing tests cover skipped frames, reversal and exact endpoints. Budget tests exercise action-only arming, idle data updates, and direct-manipulation preemption. Live validation uses the authenticated local preview against staging, with no realm writes.

## Live parallel handoff measurements

Historical measurements of the earlier 520 ms preset: inspected in the in-app browser at 0.1× speed (5,200 ms), with the workspace and Gallery captured as distinct flattened bitmap groups. At each sample both groups reported the same playback time. The latest timing preset below preserves these endpoints.

| Progress in time | Gallery x / y / width / height / radius (px) | Workspace x / y / width / height / radius (px) |
| ---------------- | -------------------------------------------- | ---------------------------------------------- |
| 0%               | 422.50 / 262.00 / 355.17 / 240.00 / 12.00    | 21.50 / 58.00 / 782.35 / 651.67 / 15.00        |
| 25%              | 327.61 / 213.96 / 456.26 / 337.18 / 12.71    | 35.11 / 51.14 / 754.98 / 658.53 / 14.29        |
| 50%              | 111.48 / 104.55 / 686.50 / 558.52 / 14.33    | 66.10 / 35.51 / 692.62 / 674.16 / 12.67        |
| 100%             | 21.50 / 59.00 / 782.35 / 650.67 / 15.00      | 79.00 / 29.00 / 666.65 / 680.67 / 12.00        |

The narrower browser viewport changed the measured endpoints naturally; no viewport-specific offsets were added. At quarter-time both width changes were 23.66% complete. At completion the DOM had no temporary bitmap names or entry keys, and card transforms were `none`. These measurements establish choreography and landing correctness; they are not a claim of a universal CPU/GPU optimum.

## Matched header verification

The 0.1× live run of the earlier 520 ms preset adds the persistent header's own matches. Their geometry uses the same timeline; their transforms contain translation only. The title faces retain natural glyph size (`object-fit: none`), while the realm icon fits proportionally (`contain`). The changing title dimensions below describe its flex container, not stretched text.

| Native clock | Header x / y / width / height (px) | Title x / y / width / height (px) | Realm icon x / y / width / height (px) |
| ------------ | ---------------------------------- | --------------------------------- | -------------------------------------- |
| 0 ms         | 21.50 / 58.00 / 782.35 / 48.00     | 134.50 / 71.00 / 555.65 / 22.00   | 30.50 / 67.00 / 30.00 / 30.00          |
| 1267 ms      | 34.24 / 51.57 / 756.71 / 46.23     | 137.27 / 63.91 / 550.11 / 21.63   | 43.24 / 60.80 / 27.78 / 27.78          |
| 2584 ms      | 65.87 / 35.62 / 693.06 / 41.82     | 144.15 / 46.31 / 536.36 / 20.73   | 74.87 / 45.39 / 22.28 / 22.28          |
| 5200 ms      | 79.00 / 29.00 / 666.65 / 40.00     | 147.00 / 39.00 / 530.65 / 20.35   | 88.00 / 39.00 / 20.00 / 20.00          |

No nonzero secondary Choreo cue ran during the handoff. No temporary identities remained afterward, and both headers finished with `transform: none`. All 26 focused motion tests, full host lint, and the staging preview build passed. Exact logs are linked by path in the [implementation report](choreo-host-motion-report.md).

## Faster spring-feel timing

Use 360 ms opening and 260 ms returning. Both use a critically damped response (`bounce: 0`), with no overshoot. The reverse follows the same spatial matches in the opposite direction, but does not time-reverse the slow-start curve: it responds immediately and decelerates into the tile.

Implementation: sample the installed `motion-dom` spring generator over a normalized visual interval, normalize that interval's end to exactly 1, then pass the easing function into Choreo's `animateView`. Motion bakes the response into native CSS `linear(...)` easing at setup. All matched groups, fades and corners share the exact duration. There is no live physics loop and no extra spring tail retaining snapshot planes. Quarter-time progress is 38.9%, halfway is 76.1%, and the endpoint is exactly 100%.

This is a bounded spring-shaped tween, deliberately distinct from an unbounded physics simulation. Motion's normal [`visualDuration`](https://motion.dev/docs/spring) can leave settling motion after the visual duration; the normalized curve makes the host's deadline explicit. Direct manipulation remains the highest-priority allocation and is not given this easing.

## Proposed shadow allocation

Implemented follow-up (2026-09-21): primary bitmap crossings now use the separate contact/pool participants described below, with plane ordering and interruption-safe cleanup. Within-page header shadows have fixed paint independent of the radius tween. The production import and generated-token freshness check are verified. See `choreo-host-motion-report.md` for current behavior and validation; the table remains the design allocation, including future drag-owned elevation effects. Existing drag policy preempts optional crossing shadows rather than assigning shadows to arbitrary authored-card gestures.

Reference inspected on 2026-09-21: the Ambient CSS work is in the native-boxel worktree at `/Users/chris/Projects/native-boxel/.claude/worktrees/native-boxel-choreo-ux-4e381e`, commit `ab02b64`, rather than its main checkout. Relevant files:

- `scripts/bake-ambient-tokens.mjs` evaluates the pinned `@ambientcss/css` 3.0.1 formulas at build time for elevation, light direction and light/dark mode.
- `ui-realm/boxel-motion/ambient-tokens.generated.ts` contains static CSS shadow strings, not prerendered image assets. The browser still paints them.
- `ui-realm/boxel-motion/shadow.ts` implements a tight contact layer and a broad ambient pool. Its latest opacity-only ladder supersedes older transform-based prose at the top of that file. The card pools are tuned multi-stop paints; the generated Ambient tokens directly supply the well shadows, and Ambient's fitted reach informs the optional lamp pools.
- `tests/ambient-tokens.test.js` checks generated output and calibration; `tests/shadow-lamp-well.test.js` checks layer geometry and opacity-only policy. All nine tests passed locally; these are formula/source-contract tests, not a new browser performance measurement.

Use the two-layer technique in host, with Choreo owning the animation lifecycle:

| Interaction                            | Allocation and behavior                                                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointer drag                           | Highest priority. One carried card gets contact and pool layers. Fade contact down and pool up on pickup; keep their paint fixed throughout the drag. Start with a fixed theme lamp, without the POC's extra left/right pools.                        |
| Tile to stack, including deeper stacks | The primary card gets an unclipped shadow participant behind its matched face. Contact and pool crossfade on the existing 360ms opening clock. The receding parent keeps its captured shadow; it does not receive another independent lift animation. |
| Close back to the tile                 | Reverse the elevation change on the existing 260ms return clock, restoring the resting treatment without doubling the live and captured shadows.                                                                                                      |
| Header or sheet within the page        | Decorate the empty surface; never place text inside a shadow transform. Use the same two fixed paints only while that surface is the primary participant.                                                                                             |
| Background fades and idle cards        | No additional animated shadow allocation or permanent `will-change`. Keep the resting treatment as static CSS.                                                                                                                                        |

Each shadow caster must match the card border box and radius. Do not independently enlarge, shrink or translate its box to suggest elevation: the native POC found that this creates a detached second edge or paints shadow inside the card. Blur, spread, offset and color remain fixed during playback; apparent lift comes from the opacity mix. A changing card shape needs a measured snapshot implementation, not an assumption that an independently stretched shadow will remain correct.

The current primary bitmap uses `crop(true)`, so an external shadow cannot simply be added inside it. Give the shadow its own unclipped snapshot participant, immediately below the primary card but above the receding stack, while toolbar and corner/edge planes stay above both. Suppress duplicate shadow paint during the handoff, then restore resting paint and release temporary participants on completion, interruption and failure. This uses the existing Choreo crossing rather than adding a separate shadow timer.

Do not default to the earlier nine-slice suggestion. The native POC records offset and fractional-pixel seam problems with that approach. Host uses same-box contact/pool snapshots with fixed endpoint paint; their raster faces resample with the shared boundary during aspect changes. Validate radius continuity, edge alignment, absence of clipping/double shadows, layer cleanup and click-to-playback cost at normal speed and slowed inspection speed. If shadow capture delays startup or exceeds the texture budget, omit the optional elevation embellishment for that crossing.

Opacity/transform playback can avoid repeated paint; blur/shadow changes require paint work. Browser layer promotion and bandwidth still need measurement, so this is not a promise of zero GPU/CPU cost. See the browser team's [animation performance guidance](https://web.dev/articles/animations-guide) and [layer-count guidance](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count).
