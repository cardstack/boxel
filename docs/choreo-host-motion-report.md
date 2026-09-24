# Host motion redesign — implementation and verification

2026-09-22 · `codex/choreo-host-tweens` · local mise preview against staging

## Click latency regression — September 22

Normal-speed in-app traces after the shadow/header changes measured 483.7 ms from click to native playback readiness opening the PretUI catalog, and 923.9/843.3 ms for initial/warmed returns. The warmed return spent 382 ms in its initial task even though the host's own capture setup marker was reached at 21 ms. Long Animation Frame attribution on the initial return reported 150.8 ms forced style/layout in the click handler and 263.3 ms in the view-transition callback. These are interaction samples, not isolated CPU/GPU benchmarks.

The capture engine batched style reads within each `.add()` subject, but wrote names/classes before reading the next subject. Independent title, icon, shadow and chrome matches therefore added repeated style flushes. A pinned `motion-dom@13.3.0` patch now reads names and overflow policy for every resolved subject first, then assigns them in a write phase. Both old/new snapshots use the same ordering. The motion budget, durations, scaling and shadow paint are unchanged. Extra opt-in markers distinguish destination rendering from header measurement. The standalone DevTools connector exposed no attached page, so these samples come from the actual in-app browser's opt-in recorder.

With capture batching alone, the comparable opening sample reached playback readiness at 150.1 ms (previously 483.7 ms), and the warmed return at 275.5 ms (previously 843.3 ms). Header measurement took 0.2 ms opening and under 0.1 ms returning. Source click-task time on the initial return dropped from 223 to 71 ms. Machine conditions are not controlled; these samples diagnose the work reduction rather than establish a universal latency guarantee.

That trace also found a 402 ms catalog body mount starting only 35 ms after playback readiness. The final handoff therefore waits for primary playback to finish, then gives the endpoint a paint opportunity before mounting the authored body. The source bitmap and incoming frame carry the transmutation; full destination content follows it. Interrupted/skipped captures use the same bounded handoff. This deliberately trades earlier full-content appearance for uninterrupted primary motion; it does not make arbitrary synchronous card rendering cheap.

Verification: 32/32 focused motion tests and full host lint pass. The new test detects style reads interleaved with participant-name writes, and the handoff test verifies that full content mounts only after native playback and snapshot cleanup. Existing endpoint, interruption, shadow and proportional-scale checks continue to pass. Logs: `/tmp/boxel-capture-final-tests.log`, `/tmp/boxel-capture-final-lint.log`, `/tmp/boxel-capture-final-test-build.log`.

Final production verification (`/tmp/boxel-capture-final-preview.log`) measured opening readiness at 202.2 ms, completion at 645.3 ms, and body mount at 674.9 ms. Its 303 ms body-render task was entirely after primary completion. The return reached readiness at 409.9 ms, with 255.2 ms in destination updating; this is still above the requested few-frame response. After Close, the workspace reached `(20, 60, 1240, 640)` with `transform: none` and no shadow-suppression markers. The batching removes a demonstrated startup cost, but does not eliminate expensive authored-card layout/rendering or native capture latency. All timings here are normal-speed individual samples with this task's builds and tests idle.

## Ambient shadows and PretUI stack depth

### Shadow continuity during transmutation — September 22

The PretUI gallery tile already paints a very faint contact shadow (`0 2px 8px`, 5% opacity), while the stack card uses a stronger baked contact and broad pool. Blending the contact shadows for the entire boundary move made the moving card appear to lose and regain depth; the pool also entered on a different schedule. Both existing shadow participants now take the raised lighting during the first 18% of an opening and keep it through travel. Close holds the raised lighting through 82% of the return, then blends to the tile's faint contact shadow and retires the pool at landing. A source or destination without a particular shadow face fades that face at the same boundary. The two shadow bitmaps, plane order, geometry clock, and endpoint cleanup remain unchanged; no blur value is animated per frame.

At 0.1× inspection speed in the rebuilt PretUI preview, opening contact and pool both reached full new-face opacity during travel; on Close both old faces remained at full opacity during travel. At rest there were zero temporary shadow planes and suppression markers, and the card's authored shadow was restored. The fixture now includes the faint fitted tile shadow and checks early handoff, sustained travel, late return, and cleanup. All 32 focused motion tests, full host lint, production build, and `git diff --check` pass. Logs: `/tmp/boxel-shadow-elevation-tests.log`, `/tmp/boxel-shadow-elevation-lint.log`, `/tmp/boxel-shadow-elevation-preview.log`.

The final refresh exposed a separate staging compatibility mismatch: its current cards import `loaderForModule`, which this older local checkout did not export. The small API and active-loader fallback were carried over from repository commit `0c6277628b`; the local preview now loads the signed-in PretUI workspace and full catalog. The final production build and host lint pass (`/tmp/boxel-shadow-loader-preview.log`, `/tmp/boxel-shadow-loader-host-lint.log`). Runtime-common JavaScript lint passes; its full type check still reports pre-existing missing declarations and a dropdown signature error in `packages/boxel-ui`, not in the compatibility changes (`/tmp/boxel-shadow-loader-runtime-lint.log`).

### Stacked-header separation correction — September 22

The initial fixed top lamp left almost no ink above a raised card: its broad pool was offset downward, and its contact paint was reduced to 30%. On white stacked headers this erased the visible depth boundary even though the shadow was present and unclipped. The raised contact token now also contains a centered diffuse edge (`0 0 0.5rem 0.0625rem`, black at 16% opacity). It is baked into the existing contact face, so resting cards and temporary transition captures share the same paint and still use two shadow participants. There is no extra animation, per-frame calculation or blur tween.

Validation for this paint calibration: production preview build and full host lint pass (`/tmp/boxel-shadow-edge-preview.log`, `/tmp/boxel-shadow-edge-lint.log`). The new token is present on both the buried and foreground live cards, with no lingering shadow suppression.

### Shadow continuity and independent header scaling — September 22

Slow inspection exposed a second issue: the parent tray's named snapshot used `overflow: clip`, which removed its outer shadow during movement and restored it at rest. The tray now preserves its outer ink; its header and body remain separate participants. Shadow crossfades also keep `plus-lighter` compositing throughout the host's clock, including slow inspection, instead of allowing the browser's default-duration blend animation to switch modes midway. The paired opacity weights remain complementary.

The workspace title and realm icon now have independent uniform `transform: scale(...)` tracks on their incoming raster faces. Title scale comes from the two resolved font sizes; icon scale comes from its two measured widths. Those reads occur only at capture boundaries. The destination live font and layout stay fixed during playback, and the title's changing flex-box width cannot stretch its glyphs. Close reverses both scales. The existing matches and two temporary primary shadow participants are reused.

“Baked” here means that the lighting formulas produce static CSS at build time and the browser rasterizes each endpoint for the transition. Scaling cached pixels avoids recomputing a CSS blur every frame, but scaling also changes apparent softness. During changing aspect ratios these endpoint shadow faces are resampled and crossfaded; they are not a physically invariant blur or a nine-slice shadow texture.

Validation: all 31 focused motion tests pass, including different title/icon scale ratios, intermediate uniform transforms in both directions, fixed destination font size, no font-size keyframes, unclipped tray ink and complementary shadow weights beyond the browser's default fade interval. Host lint, production build and diff whitespace checks pass. Logs: `/tmp/boxel-shadow-continuity-tests.log`, `/tmp/boxel-shadow-continuity-lint.log`, `/tmp/boxel-shadow-continuity-preview.log`. Live PretUI inspection confirmed separate uniform matrices (for example, title 0.9134 and icon 0.7979 during return), constant 14px destination text, and zero temporary shadows or names at rest.

The primary bitmap crossing now allocates exactly two temporary shadow participants: contact and pool. Ambient CSS 3.0.1's calibrated drop-shadow values are baked by `packages/host/scripts/bake-motion-shadows.mjs`, with a freshness check in host lint and the upstream MIT notice in `vendor/ambientcss-LICENSE.txt`. The generated CSS is imported by the application so production and test bundles both contain it. This is fixed top lighting for the host's paper frames, not a runtime Ambient lighting system.

Each participant captures its paint at the source and destination. Choreo's `animateView` interpolates their shared bounds and crossfades old/new raster faces on the existing 360/260 ms opening/return clock. No shadow blur, spread, filter, or shadow string is animated. A tile keeps its authored resting shadow at its endpoint; a stack frame uses reduced contact plus the broad pool. The shadow snapshots contain no text. Their bitmap resampling during a shape change is distinct from recomputing a Gaussian every frame.

The plane order is now parent frame 0, parent body 1, parent header 2, title/icon 3, primary shadows 4, primary card 5, toolbar/panel 6, and edge/corner controls 7. Shadow ink has an unclipped group outside the primary face's crop. Completion and failures restore resting paint; token ownership prevents an interrupted older run from restoring paint over a newer crossing. Shadow matches and temporary DOM surfaces are released. Drag continues to preempt optional scene playback through the existing budget service; this change does not attach a shadow to arbitrary drag gestures inside authored cards.

Within-page header motion now keeps its existing shadow on a separate fixed-paint surface. The header shape can tween radius while the shadow only transforms with its boundary. Search-sheet motion already transforms its empty surface with fixed shadow paint. Neither requires a second animation clock or permanent GPU promotion.

PretUI's catalog uses custom buttons, rather than fitted CardDef wrappers. The host now observes activation within each stack card and consumes the clicked button only when `viewCard` runs during that dispatch. A weak, parent-scoped return address lets Close match back to the same button; no realm-specific selector or permanent animation identity is needed. Stale unrelated clicks and removed buttons cannot become matches. Existing fitted/embedded card identity remains preferred.

Live verification covered PretUI workspace → The Pretui Collection → AiInstructions and both Close steps, including 0.05× inspection. Both custom buttons and fitted previews use the same parallel parent/child crossing. The fixture checks shadow bounds against the primary at start, quarter-time and end, verifies actual nonempty shadow paint, and exercises dropped-frame and interruption cleanup. These changes are local host code; no staging card documents were changed.

### Current shadow-build measurements

Normal speed, 1280×720 in-app browser, optimized production preview, with compilation and tests idle. These are individual diagnostic samples, not controlled benchmarks or GPU measurements. Playback readiness is a browser marker, not a photon-on-screen timestamp.

| PretUI interaction       | Click → capture prepared | Click → playback ready | Destination update | Completion callback |
| ------------------------ | -----------------------: | ---------------------: | -----------------: | ------------------: |
| Workspace → catalog      |                   1.5 ms |                61.0 ms |            17.4 ms |            438.9 ms |
| Catalog → AiInstructions |                   1.0 ms |               156.5 ms |            36.6 ms |            635.2 ms |
| AiInstructions → catalog |                   2.9 ms |               255.3 ms |            86.6 ms |            526.3 ms |
| Catalog → workspace      |                   2.7 ms |               249.6 ms |            66.3 ms |            527.6 ms |

Moving retained-body measurements ahead of snapshot/shadow setup writes removed an avoidable forced layout in the click handler. The sampled nested opening improved from 220.9 to 156.5 ms to readiness. The remaining native capture/update and large authored-card rendering still exceed the desired few-frame response, especially on return. Catalog mounting incurred a 142 ms task; the component detail incurred a 172 ms mounting task. The primary geometry remains browser-owned, but these tasks still delay input and completion callbacks. Shorter travel duration does not fix them. Catalog virtualization/incremental rendering and profiling the native capture boundary remain the next performance work; this shadow implementation is not a claim of universally smooth or optimal rendering.

After both returns, the workspace measured `(20, 60, 1240, 640)` with `transform: none`, its resting shadow present, zero temporary shadow elements and zero shadow-suppression markers. Asynchronous custom actions that call `viewCard` after click dispatch use the existing stack fallback rather than borrowing a stale button origin.

**Validation:** 31/31 focused motion tests pass after the final measurement-order change, including shadow paint/bounds/layer order, stale custom actions, reverse matching, dropped frames and interruption cleanup. Full host lint (JavaScript, templates, Glint and generated-shadow freshness) and `git diff --check` pass. Logs: `/tmp/boxel-shadow-batched-tests.log`, `/tmp/boxel-shadow-batched-lint.log`, `/tmp/boxel-shadow-batched-test-build.log`. Production build: `/tmp/boxel-shadow-batched-preview.log`. The user's existing in-app tab was refreshed at normal speed; the signed-in PretUI workspace, generated shadow tokens and absence of temporary shadow nodes were verified.

## Nested stack and performance follow-up

The local HTTPS preview responds with 200 and the signed-in PretUI workspace loads. The standalone Chrome DevTools connector targets a separate blank browser, so its connection-check recording is excluded. The actual preview is measured with opt-in User Timing markers, frame callbacks, long tasks and Long Animation Frame attribution in the in-app browser. These are main-thread interaction traces, not a GPU trace or full JavaScript flame chart.

Recipe Gallery's fitted recipe wrappers use `display: contents`. Their zero-size boxes prevented the earlier identity lookup from finding an opening boundary. The lookup now unwraps a single rendered surface and ignores boxless ancestors when checking clipping. It works through the shared host `viewCard` path at any stack depth, including Gallery → Butter Chicken and its reverse; it contains no Recipe Gallery-specific selectors. Ambiguous/offscreen previews retain their fallback.

Two avoidable costs were removed: pointer release no longer writes `dragging=false` when no drag occurred, and a bitmap handoff omits the ordinary stack score entirely instead of compiling zero-duration tracks alongside the native transition. Persistent header parts use one visible face, avoiding a double print while keeping the title and square realm icon separately matched.

### Respond before rendering the full card

The original preview used the package's plain `build` command, which explicitly selects development mode. It has now been replaced with an optimized production bundle, still backed by staging. The production output lives in `/tmp/boxel-choreo-production`; the test build stays in `packages/host/dist`. Before the content-ordering change, production Gallery opening reached playback-ready in 172 ms (90 ms updating), while Butter Chicken reached it in 113 ms (69 ms updating). The earlier development numbers below are not directly comparable benchmarks; both code and machine conditions changed.

The earlier implementation mounted only the card frame/header in the capture callback, then released the expensive body after native playback readiness and a paint opportunity. The September 22 latency correction above supersedes that handoff: body mounting now follows primary completion and cleanup, because large authored templates could block playback immediately after it started. The one-shot paint boundary still has a 100 ms fallback for suspended/background frame callbacks and does not add an animation loop.

On return, the existing buried parent body retains its prior layout size, invisible and inert, rather than narrowing/re-expanding a large DOM tree through `display: none`. Only its layout is retained: all snapshot identities and temporary measurement frames still retire with the crossing. Keeping hidden layout has a memory/layout-maintenance tradeoff when card data updates, so this is not claimed as a universal hardware optimum.

### Earlier production interaction samples (before shadow integration)

Normal speed, 1280×720 in-app browser, after this task's build/typecheck/tests finished:

| Interaction                              | Click → playback ready | Destination update | Body mount starts | Completion callback |            Tasks over 50 ms |
| ---------------------------------------- | ---------------------: | -----------------: | ----------------: | ------------------: | --------------------------: |
| Workspace → Recipe Gallery               |                58.4 ms |            15.9 ms |           76.6 ms |            426.8 ms |                           0 |
| Gallery → Butter Chicken                 |                54.2 ms |            19.9 ms |           69.6 ms |            434.4 ms |                           0 |
| Butter Chicken → Gallery                 |                48.0 ms |            20.6 ms |   Already mounted |            325.7 ms |                           0 |
| PretUI workspace → 301-component catalog |                44.6 ms |            14.6 ms |           59.0 ms |            410.3 ms | 1, 134 ms during body mount |
| PretUI catalog → workspace               |               108.7 ms |            41.3 ms |   Already mounted |            388.1 ms |      1, 54 ms during update |

The three recipe-flow samples put native playback readiness within roughly three to four 60 Hz frame intervals. Readiness is a browser animation-start marker, not a measured photon-on-screen timestamp. Maximum recorded main-thread frame-callback gaps were 48.7, 57.2 and 54.6 ms respectively; this is not a claim that every compositor frame rendered at 60 fps. Native durations remain 360 ms opening and 260 ms returning; callback completion can follow the native endpoint on a later task/frame.

The PretUI opening is ready in roughly three 60 Hz intervals, but the large catalog still mounts synchronously afterward: a 134 ms task begins at 58.8 ms, and the maximum frame-callback gap is 150.2 ms. Input responsiveness during that task remains limited; moving it after animation startup does not make it free. Its return reaches ready at 108.7 ms, including 41.3 ms updating/removing the outgoing card and roughly 54 ms before the native update callback. Catalog virtualization or incremental rendering is the next content-level optimization; the host cannot preempt a synchronous arbitrary card template midway through mounting. No staging card content was modified in this pass.

After the deeper return, Gallery measured `(20, 60, 1240, 640)` and the buried workspace `(306.66, 30, 666.66, 670)`. Both transforms were `none`; the lower content was hidden and the top content visible. There were zero generated snapshot names, body measurement frames or bitmap entry keys remaining.

**Validation:** all 30 focused motion tests pass, including deferred body mounting after native readiness, interrupted reveal completion, boxless nested-card matching, retained-layout visibility, reverse geometry, proportional content, endpoint cleanup and drag preemption. Full host lint passes. Logs: `/tmp/boxel-responsive-tests-final.log`, `/tmp/boxel-responsive-verified-lint.log`. Optimized build: `/tmp/boxel-responsive-production-final.log`. Preview: `https://localhost:4200/`, served by Vite with `--outDir /tmp/boxel-choreo-production`.

### Initial trace findings

At 1280×720 and normal animation speed, the first Gallery opening spent 347 ms inside the destination-update phase and reached playback-ready at 598 ms after click. Its prescribed animation then took roughly 384 ms to complete. The first Butter Chicken opening spent 343 ms updating and reached playback-ready at 566 ms; a repeated opening reduced those to 89 ms and 169 ms. Warm Gallery opening remained expensive: 389 ms updating, 584 ms to playback-ready. These samples were taken before removing the redundant zero-duration stack score, after this task's build and tests had stopped. Other machine workloads were still present, so they are diagnostic observations rather than isolated benchmarks.

The main source of sluggishness is capture/update startup, not simply the 360/260 ms travel duration. The earlier geometry-inspection recording found 60 ms of forced style/layout inside a 228 ms View Transition callback, but that mode itself reads geometry each frame and is excluded from performance comparisons. The new `motionTrace=1` mode performs no per-frame layout reads. Normal sessions install neither recorder.

## Faster timing preset

The latest preset opens in **360 ms** and returns in **260 ms**, replacing 520 ms in both directions. It uses a normalized, critically damped (`bounce: 0`) spring response baked into native CSS `linear(...)` easing through Choreo's `animateView`. The preset keeps the same spatial matches, header identities and foreground planes. The return now departs promptly and eases into the tile; it no longer uses the slow-start time reversal of the opening curve.

The spring is sampled at setup, not integrated during playback. Its visual interval is normalized to hit the exact endpoint at the prescribed duration, with no additional settling tail. Quarter-time progress is 38.9%, halfway is 76.1%, and final progress is 100%. This is a bounded spring-shaped tween, not a continuously simulated physics spring. The [timing rationale](choreo-host-animation-budget.md#faster-spring-feel-timing) explains that distinction. Earlier measurements below retain their original 520 ms timings as historical evidence.

## Proportional workspace content

The parent content pane is captured separately from its frame and header at every stack depth. Its complete viewport scales with `object-fit: contain` and fades out as the parent recedes, rather than being cover-cropped with the outer tray. On return, it scales up proportionally and fades in. A transparent temporary frame supplies the buried body's snapshot bounds while its existing layout stays hidden; the frame is released with the transition. Header text and realm icon keep their independent identity matches.

Current layer order is frame 0, content 1, header surface 2, title/icon 3, selected card 4, toolbar/panel 5, and corner/edge controls 6. Earlier numeric layer observations below describe the previous allocation; the controls remain above the crossing in the current allocation as well.

The focused regression checks the actual content bitmap's `contain` fitting and opacity in both directions, the hidden-body measurement frame's cleanup, native spring-curve playback bounded at 360/260 ms, and unchanged final geometry. Host lint and the mise staging build passed (`/tmp/boxel-proportional-body-lint.log`, `/tmp/boxel-proportional-body-build.log`).

## Budgeted bento handoff follow-up

The × action now runs the same parallel handoff in reverse. It resolves the parent's hidden preview identity before closing, measures its visible destination after layout, and uses the time-reversed easing over the same 520 ms duration. Parent header/title/icon matches return with it. Multi-card trims and unavailable/ambiguous preview identities avoid competing or invented return matches.

Corner and edge chrome now owns a dedicated native snapshot plane at z-index 5: closed search dock, left/right neighbor-stack controls and assistant button. This stays above the moving card (3) and toolbar/panel (4), with no geometry animation. It is released after either direction of the crossing.

Latest verification: **27 focused motion tests pass**, including reverse start/midpoint/end measurements, hidden return targets, proportional header content, explicit edge-plane ordering and identity cleanup (`/tmp/boxel-reverse-tests.log`). Host lint passes (`/tmp/boxel-reverse-lint-final.log`), and the mise staging preview build passes (`/tmp/boxel-reverse-build.log`). In the live 0.1× reverse, Gallery travels from `(21.5, 59, 1237.35, 639.67)` to its tile at `(449, 262, 381.77, 240)`; the workspace goes from `(306.5, 29, 666.65, 669.67)` to `(21.5, 58, 1237.35, 640.67)`. Header, title and square realm icon share the clock. No nonzero secondary cues, leftover capture markers, or JavaScript errors were recorded. Search, both edge controls and the assistant button were independently observed on plane 5 during playback.

The separate-shadow strategy originally proposed here is now implemented; see the Ambient shadows section above and the [budget document](choreo-host-animation-budget.md#proposed-shadow-allocation).

The latest pass adds action-scoped choreography inspired by bento-boxel's temporary Crossing identities. Direct manipulation takes priority, a primary scene composition gets the geometry budget, and other changes use supporting fades. Choreo remains the execution engine; the budget service has no frame loop. The full allocation table and measured parallel handoff are in [choreo-host-animation-budget.md](choreo-host-animation-budget.md).

Opening Recipe Gallery now matches its visible index boundary to the top stack card while the workspace simultaneously moves underneath. Both measured boundaries share a 520 ms timeline. The previous workspace header is preserved as a matching surface, title and realm icon, independently of the fading/scaling body. Its title keeps natural-size glyphs; its icon stays proportional. Existing buried headers are not added to this match set, and regular header/stack entrance playback is suppressed during the bitmap handoff. All temporary identities are removed on completion.

This pass also removes the secondary card translation from workspace portals: wallpaper remains the primary motion and the index follows with opacity only. The earlier measurements and rendering traces below describe the preceding refinement; they are retained as historical evidence, not new performance measurements of this pass.

Validation for this follow-up: all **26 focused motion tests pass**, including the replaced-DOM header matches, direct-manipulation preemption, skipped frames and endpoint cleanup (`/tmp/boxel-header-match-tests.log`). Host ESLint, template lint and Glint pass (`/tmp/boxel-header-match-lint.log`). The staging preview build passes (`/tmp/boxel-header-match-build.log`).

Live Recipe Gallery verification at 0.1× speed measured the workspace header from `(21.5, 58, 782.35, 48)` to `(79, 29, 666.65, 40)` in x/y/width/height pixels. Its realm icon moves from `(30.5, 67, 30, 30)` to `(88, 39, 20, 20)`, remaining square throughout. The title's bitmap uses natural glyph sizing and both snapshot groups keep identity scale. The recording contains **no nonzero secondary Choreo cues** during this native handoff and no leftover match names or entry markers afterward. Both live headers finish with `transform: none`; the browser reports no JavaScript errors for this run. The normal-speed preview is refreshed at `https://localhost:4200/`.

## Result

The existing navigation paths now use bounded motion with explicit ownership. Workspace navigation opens the wallpaper aperture first, then introduces the index card. Search-to-card navigation crossfades two browser bitmap faces. Ordinary stacks use a short lift and fade, keep the parent centered, and retain natural text proportions. Intermediate renders continue the entrance instead of replacing it with the resting pose.

The largest performance correction was outside the tween itself: the dashboard retained hundreds of expensive tiles and repeated observer writes caused a roughly 330 ms render during return. Viewport windowing, retained scene identity, batched observation, and equality guards remove that repeated work.

This report covers the existing stack, header, sheet, search crossing, and workspace portal. New assistant, mode-switch, sorting, and feedback effects remain deliberately deferred. The per-type design plan is in [choreo-host-native-motion-plan.md](choreo-host-native-motion-plan.md).

## CPU/GPU refinement

The follow-up replaces separate `x`/`y` MotionValues with complete transform keyframes for stack entrance, exit, and reflow. In the installed Motion 13.3 runtime, full `transform` is eligible for native browser playback; separate `x`/`y` values require JavaScript style updates. Regression tests inspect actual browser `Animation` objects, rather than inferring native playback from the property name.

Headers now have an empty decorative surface plus separate title, realm icon, and action participants. The live header resolves its destination layout once. Its surface scales to bridge the measured boxes; the text and controls translate independently, with identity scale throughout. Corner radius remains a small paint-property tween on the empty surface. This deliberately preserves rounded corners and shadows; it is not a claim that the entire header is compositor-only.

The search sheet uses the same empty-surface strategy. Its populated layout stays fixed during playback, the bottom remains anchored, and the browser owns the surface transform. Native transform endpoints use matching function lists and explicit identity scales to avoid Motion's zero-scale interpolation of `none`.

Search-to-card capture keeps Choreo's document-scoped `animateView` path. Only the named card faces and stationary chrome are captured; the default root crossfade is disabled. Old and new card bitmaps use `object-fit: cover` inside the moving frame. The browser owns geometry and crossfade playback while the destination DOM retains its final layout.

Element-scoped capture was evaluated and rejected for this build: Chrome 153 aborted it with `Prepaint layout check failed` when the named source node was replaced. A standalone reproduction at 4× CPU slowdown failed with both synchronous and asynchronous updates; keeping the same node succeeded, and document-scoped replacement succeeded. The same failure appeared with a real Slow Bloom search tile. Retaining reliable document capture avoids that skipped animation, at the cost of snapshotting the stationary toolbar/assistant planes.
| Interaction | Choreo / browser API | Per-frame work |
| --- | --- | --- |
| Stack entrance, exit, reflow | `c.Tween`, `StepComponent`, complete `transform` and `opacity` keyframes | Native browser transform/opacity playback; layout resolves once |
| Header expand/restore | `MotionNode` identities, `Move(size: false, path)`, `Tween`, `Raise`, `Hold` | Native positional transforms; small radius tween on the empty surface; no font scaling or header width/height playback |
| Search sheet | `c.Tween(transform)`, position-only `c.Move(path)`, opacity tweens, final `Perform` | Native surface/header transforms; one final existing popover-resize notification |
| Search result → card | `animateView().add().group(false).crop(true)`, explicit old/new opacity | Browser bitmap geometry/crossfade; no live card resizing |
| Workspace portal | Existing `c.Sequence`, `c.Parallel`, clip/opacity/transform tweens and final `Perform` | Wallpaper aperture first, index translation/fade later; unchanged in this refinement |

The scoped-capture experiment followed the [CSS View Transitions specification](https://drafts.csswg.org/css-view-transitions-2/#dom-element-startviewtransition), but feature availability alone did not establish reliability in the current browser. No new animation dependency or competing frame scheduler was added.

## What native-boxel contributed

The references were `ui-realm/operator-choreography.ts`, `stack-stage.gts`, `operator-sheet.gts`, `native-app.gts`, `realm-image.ts`, `boxel-kernel/frontend/host-kernel.js`, `crossing.js`, and `tests/motion-policy.test.js` in `/Users/chris/Projects/native-boxel`.

The useful principles were short local translation, stable text, one motion owner, a retained inert catalog, viewport-gated image work, and an explicit reverse direction. The earlier native kernel crossing resizes DOM boxes; it is **not** the browser bitmap implementation used here. The host adapts the principles to its own cards and the user's stronger requirement against stretched text.

## Motion contract by type

| Interaction                       | Matching and motion                                                                                                                                                    | Ownership / finish                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard → realm                 | Tile occurrence supplies the aperture. Wallpaper stays at viewport size while clip and radius open for 220 ms. Index card follows with translation/opacity for 180 ms. | One 400 ms portal transaction; wallpaper at local layer 0, cards at 1. No simultaneous ordinary stack entrance.                                                                            |
| Realm → dashboard                 | Index recedes/fades for 160 ms; wallpaper aperture returns to the currently measured tile for 240 ms.                                                                  | Same retained dashboard and card identities. Missing/offscreen return targets fade instead of flying to a stale rectangle. Token guards reject obsolete completion.                        |
| Search tile → card                | Browser old/new raster faces crossfade in a moving, proportionally cropped frame for 320 ms.                                                                           | Destination DOM is already at final dimensions. Sheet/stack motion is suppressed during capture. Stationary chrome has separate snapshots above the card faces. No default root crossfade. |
| Search fallback                   | Short 24 px lift/fade at the destination.                                                                                                                              | Used without snapshot support, with reduced motion, missing source, or a modal. No live content size tween.                                                                                |
| Stack push/pop                    | 24 px / 280 ms entrance; 18 px / 180 ms exit. Existing cards resolve their widths once and move about their center.                                                    | Parent stays behind incoming card; outgoing cards use host layer 100. Explicit current-value keyframes preserve an entrance across a second render.                                        |
| Stack/column reflow               | Center-based translation to the new layout; natural content dimensions throughout.                                                                                     | No scaleX/scaleY or full-card width/height playback. Latest layout remains authoritative.                                                                                                  |
| Header expand/restore             | Match header and its parts; translate live content, transform the empty surface, tween 15 px top / 0 px bottom ↔ 20 px corners.                                        | One visible header on layer 150; counterpart is hidden. Header rides its card during ordinary reflow. Live text never scales.                                                              |
| Search sheet                      | Resolve populated content layout once; transform its empty surface, move its position-only header, and content opacity over 240 ms.                                    | Sheet stays on layer 300. Opening/closing does not compete with a bitmap handoff.                                                                                                          |
| Assistant / mode switching        | Existing behavior retained; new dedicated motion remains planned.                                                                                                      | Deferred pending separate implementation and measurement.                                                                                                                                  |
| Dashboard sorting / image arrival | Expensive catalog tiles are windowed; image arrival does not trigger a new grid animation.                                                                             | Small favorites/catalog sections remain mounted. Focused or selected catalog tiles remain available. New deliberate reorder motion is deferred.                                            |
| Menus / dialogs / feedback        | Existing behavior retained.                                                                                                                                            | New effects are deferred.                                                                                                                                                                  |

Document-scoped View Transition layers sit above normal DOM z-index. Their explicit ordering is crossing group 1, stationary toolbar/assistant group 2. Active modal navigation skips the bitmap effect. Normal host chrome retains its established layers: dashboard 200, sheet 300, profile 400/500, toolbar/assistant 700, assistant button 800, popovers 900.

## Corrections found by slowing and measuring

1. **Zero-size portal card:** incompatible `matrix(...)` → `none` interpolation could synthesize a zero matrix. Both endpoints now use the same `translateY(...)` function. The wallpaper opens independently of card motion.
2. **Sideways stack opening:** a corner-based position tween preserved the old left edge while the parent narrowed. The new reflow preserves its center. In the real FORGE stack, the parent changed from x=21.32 / width=1022.36 to x=199.16 / width=666.66; its center stayed at 532.50 px.
3. **Cached card skipped its entrance:** a second render produced a kept-card score before the first paint. Zero-delta geometry and implicit opacity starts discarded the entrance. Replacement cues now include the existing translation and explicit painted opacity. The live Slow Bloom card then continued through opacity 0 → 0.099 → 0.245 → 0.503 → 1, while its width stayed 1022.36 px and its final y was 59 px.
4. **Repeated return hitch:** unchanged tile observer results still wrote tracked state, provoking render/measure work. Guarding those writes removed the recurring roughly 330 ms task.
5. **Tiny nonzero endpoint:** a sampled path's epsilon clamp left a residual translation. The vendored runtime patch samples the exact last point. The patch and lockfile hash are updated.
6. **Competing bitmap owners:** navigation now uses transaction identity, suppresses both sheet and stack playback during capture, and captures stationary chrome above the card snapshots.
7. **Corner-radius snap on restore:** computed uniform radii collapse to one value. Explicit four-corner values at both ends preserve continuous interpolation. In the live slowed restore, bottom corners progressed through 18.32, 2.76, 1.24, 0.51, 0.16, 0.02, and 0 px while the populated header retained a 1237 px layout width.
8. **Skipped scoped bitmap capture:** node replacement exposed the browser failure described above. The final implementation retains the document-scoped path.

## Slow-motion values

The inspection rate is read once when the page loads, so route serialization cannot silently restore normal speed. Use `motionInspect=1&motionSpeed=0.2` on a preview URL and reload for five-times-slower review; `motionSpeed=0.1` gives ten-times-slower review. The opt-in JSON record is rendered in `#host-motion-inspection`. It records bounds, layout dimensions, opacity, transform, clip, radius, layer, DOM identity, active native animations and cues, rAF gaps, long tasks, and supported long-animation-frame attribution. It does not drive animation or update Ember state.

Example portal at 0.1 speed, viewport 1065 × 731:

| Time from input | Wallpaper clip                                            | Card plane                         |
| --------------: | --------------------------------------------------------- | ---------------------------------- |
|           64 ms | inset(282.469px 149.711px 282.531px 518.969px round 15px) | opacity 0; translateY(24px)        |
|         1038 ms | inset(26.098px 13.832px 26.104px 47.949px round 1.386px)  | opacity 0; translateY(24px)        |
|         2370 ms | Fully open                                                | Card still at its hidden start     |
|         3226 ms | Fully open                                                | opacity 0.876; translateY(2.982px) |
|         3826 ms | Fully open                                                | opacity 0.996; translateY(0.088px) |
|         Settled | clip none                                                 | opacity 1; transform none          |

Both planes retained their full 1065 × 731 dimensions. The wallpaper had no transform. The real Slow Bloom stack inspection likewise retained its natural dimensions, kept parent/child layers at 1/2, and finished with opacity 1 / transform none.

## Performance observations

These are authenticated in-app-browser observations of the development preview, not production benchmark claims or compositor FPS. No build or test process ran during the final five-pair warm measurements. Instrumentation itself reads geometry and adds overhead. Initial card/module/network loading is separate from warm navigation.

### Dashboard work

At 1065 × 731, the baseline had 262 tile elements, 256 wallpaper backgrounds, and 7,363 total DOM elements, with six tiles intersecting the viewport. The windowed dashboard initially had 10 expensive tile elements and about 2,204 DOM elements; it retains cheap slots for catalog order and scrolling. That is about 96% fewer expensive tiles and 70% fewer DOM elements in this view. These are DOM counts, not decoded-image or GPU-memory measurements.

### Prior-pass input to first observed visual change

| Path             | Earlier samples             | Final five warm samples         | Final median |
| ---------------- | --------------------------- | ------------------------------- | -----------: |
| Desktop open     | 300.8, 747, 495, 399.5 ms   | 47.7, 40.8, 42.7, 41.6, 41.0 ms |      41.6 ms |
| Desktop return   | 621.5, 586.1, 548.6 ms      | 48.1, 57.2, 56.6, 52.6, 51.5 ms |      52.6 ms |
| 390 × 844 open   | No mobile baseline recorded | 54.6, 42.6, 39.0, 38.8, 38.5 ms |      39.0 ms |
| 390 × 844 return | No mobile baseline recorded | 50.1, 54.4, 50.5, 46.2, 47.3 ms |      50.1 ms |

All 20 final warm interactions responded within 100 ms. Some input tasks measured 50–57 ms; this is not a claim that every task is below 50 ms. No later long tasks were recorded during those warm playback windows, and the maximum sampled frame gaps were the initial response gaps. Every recorded endpoint had full viewport dimensions, clip none, transform none, and opacity 1, with the inactive scene hidden on return.

Three additional warm Slow Bloom pushes at 390 × 844 responded in 73.8, 69.1, and 71.0 ms. Their 68–73 ms tasks were input/setup work; no later long tasks were recorded. Each card stayed 372 px wide, the parent stayed centered at 195 px, and both cards had no residual transform by the 324–326 ms samples.

The previous return hitch had a recurring 313–349 ms task after the input. A long-animation-frame sample led to the redundant observer-write fix. Cold content still produced later 54–72 ms response-processing tasks in one sample after the 400 ms motion had completed; those are not fixed by changing the tween.

### Rendering trace of the refined implementation

A Chrome 153 startup trace of the focused Testem suite is saved at `/tmp/boxel-native-playback-trace.json` (81 MB). The portable [sample measurements](choreo-motion-rendering-sample.json) retain exact trace intervals and the counting method. These are controlled fixtures, not staging-card or physical-device benchmarks.

The sampled steady portions exclude the first 50 ms and last 40 ms of each native animation, so setup and cleanup are not hidden inside a claim of free playback:

| Fixture        | Measured window | Layout events | Paint events / total duration |
| -------------- | --------------: | ------------: | ----------------------------: |
| Header expand  |        515.8 ms |             0 |                  62 / 1.60 ms |
| Header restore |        507.5 ms |             0 |                  60 / 1.39 ms |
| Sheet opening  |        107.7 ms |             0 |                      0 / 0 ms |
| Stack entrance |        124.7 ms |             0 |                      0 / 0 ms |

The header still paints its radius/shadow treatment, while its text layout remains fixed. The sampled sheet and stack playback perform no layout or painting on the renderer main thread. This demonstrates the intended reduction in work; it does **not** establish minimum possible GPU cost, universal frame rate, or a before/after GPU percentage. The browser still does compositing and raster work, and card loading/setup can remain expensive.

## Validation and reproducibility

- Focused host filter `motion`: **23 tests passed, 0 failed**. Final output: `/tmp/boxel-native-tests-release.log`.
- Separate Chrome 153 run at **4× CPU slowdown: 23 tests and 233 assertions passed**. This verifies playback participation, interruptions, and endpoint correctness under synthetic CPU pressure, not compositor FPS.
- Tests cover bitmap aspect/crossfade/chrome/root exclusion/cleanup, header identity/radius/geometry/layers, stack centering and entrance continuity, retained exits, rapid replacement/reversal, natural text dimensions, reduced motion, sheet anchoring and interruption, portal ordering, late content/resize, deliberately dropped frames, modal capture exclusion, and bounded dashboard rendering/keyboard selection.
- Deliberate main-thread stalls include a 700 ms workspace interruption and a 1,000 ms bitmap interruption. Final application geometry remains authoritative even when all intermediate animation frames are missed.
- Live staging cards included PretUI, FORGE's index, and Slow Bloom. The 390 × 844 review confirmed a final index card at x=9, y=50.13, width=372, height=772.55, opacity 1 and no transform.
- Final live Slow Bloom search handoff exposed native old/new opacity, bitmap geometry and all four corner-radius tracks. After playback, its card was 1237.36 × 640.67 px with opacity 1, transform none, and no temporary snapshot names.
- Host lint passed template lint, ESLint, and Glint checking (`/tmp/boxel-native-lint-release.log`). The staging mise build passed (`/tmp/boxel-native-build-release.log`) and the preview is refreshed at `https://localhost:4200/`.

The preview uses the existing staging environment variables and `mise exec -- pnpm build` from `packages/host`. Filtered verification uses `mise exec -- pnpm exec ember test --path dist --filter motion`, with output redirected to a file. No full host suite was attempted.

## Limits and follow-up

The rendering trace and CPU-throttled fixture checks use a separate Chrome session. The authenticated in-app review uses real staging cards without CPU throttling. Narrow viewport testing ran on the desktop machine, not a physical phone. Neither trace event counts nor synthetic slowdown establish mobile-device FPS, minimum GPU cost, or smoothness while JavaScript is blocked. Main-thread-stall regressions establish endpoint correctness under load.

Search result fetching, snapshot setup, and cold realm/module loading can still take time. In a live instrumented Slow Bloom handoff while a build was running, the bitmap update callback took 521 ms, including 412 ms of forced style/layout. That contended sample is not a controlled benchmark, but it confirms that native playback does not eliminate capture/setup cost. The sheet retains its existing one-time synthetic resize notification for popover repositioning. The refined header resolves its live layout once and transforms a separate decorative surface. Its radius still incurs small paint updates. Some existing dashboard/title and card-content layouts are cramped at 390 px; the motion finishes correctly without changing their font proportions.

The visual review confirms the intended wallpaper-first ordering, stable typography, coherent stack layering, and clean endpoints in the tested examples. Broader GPU profiling and new animation types remain separate work, rather than being implied by passing the endpoint suite.
