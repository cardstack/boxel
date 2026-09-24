# Host motion redesign from native-boxel

Status: core navigation implemented and measured, 2026-09-20. This supersedes the implementation direction in `choreo-host-motion-plan.md`. See [the final implementation report](choreo-host-motion-report.md) for actual behavior, measurements, validation, and deviations. The source findings below preserve the pre-change audit; new assistant, mode-switch, reorder, and feedback effects remain deferred.

## What the review established

The current implementation reaches its endpoints in focused tests, but those tests are not evidence of responsive navigation or smooth playback. We need to reduce work and give each transition one owner before tuning its appearance.

Source findings in the host:

- `stack-motion.gts` animates actual width/height on complete kept card trees. `search-sheet/motion.gts` does the same to a sheet containing results. This avoids stretched glyphs but makes layout part of playback.
- `workspace-scene.gts` animates an inherited custom property that feeds a large scene's clip, card translation, and opacity. This does not give the card an independent compositor transform/opacity animation. Whether its clip is accelerated must be established by a trace.
- `motion-timing.ts` still defaults to the 600 ms review speed. Routine card exits travel an entire card height. Both are poor starting points for frequent interactions.
- `bitmap-crossing.ts` uses document-scoped View Transitions. The update awaits the navigation task and an Ember render commit. The current card-navigation helper itself commits synchronously: a network wait has **not** been established here. Capture/render cost, root snapshots, and overlap with other motion owners need measurement.
- Search, stack, header, and workspace transitions have separate lifecycle controls. `bitmapCrossingActive` is a boolean rather than a navigation identity; an earlier `finally` can clear it while a newer handoff is active. Existing workspace tokens are a useful foundation for fixing this consistently.
- Live dashboard observation at 1065 × 731: **262 tile elements, six intersecting the viewport, 256 CSS wallpaper backgrounds, and 7,363 total DOM elements**. These are DOM counts, not a count of decoded images or a frame-time measurement. Retaining this entire dashboard avoids remounting but preserves a large reactive tree.

No representative authenticated performance trace was recorded in this planning pass. The attached DevTools browser is separate from the signed-in in-app browser. Do not infer FPS, milliseconds saved, or GPU acceleration from these findings. Baseline measurement is the first implementation step.

## What to adopt from native-boxel

| Evidence                                                                                                                                                                                                                                                                     | Lesson for the host                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [operator-choreography.ts](/Users/chris/Projects/native-boxel/ui-realm/operator-choreography.ts) centralizes motion declarations; its policy disallows product frame loops.                                                                                                  | Keep transition intent in a small policy module. Choreo owns playback; application state owns the result.               |
| [stack-stage.gts](/Users/chris/Projects/native-boxel/ui-realm/stack-stage.gts) uses short card translation and opacity: 24 px / 320 ms in, 18 px / 200 ms out. The header has position-only layout motion.                                                                   | Ordinary push/pop is a small local movement. A header's text should move without changing glyph proportions.            |
| [operator-sheet.gts](/Users/chris/Projects/native-boxel/ui-realm/operator-sheet.gts) gives the sheet a resolved layout and moves its panel.                                                                                                                                  | Resolve the sheet layout once; animate its presentation separately from its result list.                                |
| [native-app.gts](/Users/chris/Projects/native-boxel/ui-realm/native-app.gts) retains an inert catalog under the workspace and excludes the catalog root from screen motion. It starts the main catalog at 24 workspaces.                                                     | Keep the dashboard's place without making the whole catalog a transition participant. Bound the retained work.          |
| [realm-image.ts](/Users/chris/Projects/native-boxel/ui-realm/realm-image.ts) resolves assets through a cache and gates image work on viewport proximity.                                                                                                                     | Window wallpaper work as well as tile markup; returning should not trigger a new image storm.                           |
| [host-kernel.js](/Users/chris/Projects/native-boxel/boxel-kernel/frontend/host-kernel.js) and [crossing.js](/Users/chris/Projects/native-boxel/boxel-kernel/frontend/crossing.js) preserve tile/document identity, crossfade representations, and implement both directions. | Make each crossing an explicit source/destination pair with a return policy.                                            |
| [motion-policy.test.js](/Users/chris/Projects/native-boxel/tests/motion-policy.test.js) enforces ownership, retained catalog behavior, and bounded image loading.                                                                                                            | Test architectural limits as well as geometry. Add measured playback tests; source-policy tests alone are insufficient. |

Do not copy the reference indiscriminately. Its earlier kernel crossing resizes real DOM boxes; it is not a bitmap implementation. Its current native navigation deliberately omits a screen-wide Crossing. Its small uniform sheet/press scales also need adaptation to the user's stronger preference for stable text. Adopt its separation of responsibilities, not every primitive or duration.

## Shared contract

1. **One action, one owner.** A navigation transaction has a unique presentation ID, source, target, direction, and completion handle. Bitmap handoff, workspace portal, and ordinary stack entry are mutually exclusive for that action. Duplicate card URLs do not share presentation IDs.
2. **Commit layout once.** Establish the destination shell immediately. Data loading is independent and can fill that shell later. No network fetch, module loading, or unbounded readiness wait inside a snapshot-update callback.
3. **Separate surface and text.** Across-page transitions use browser bitmap faces with aspect-preserving cropping. Within-page text uses translation and opacity at its native font size. Changing aspect ratio belongs to an empty shell, crop, or two independent faces, never an anisotropically scaled text ancestor.
4. **Use direct animation tracks.** Translate and fade via Choreo's browser animation path. Replace the inherited portal clock with explicit delayed tracks. Clip and radius are bounded shell effects whose cost must be traced; calling an animation WAAPI does not guarantee it avoids paint.
5. **Late content does not restart motion.** A newly loaded card body fades into the already settled shell once. No replay of the card entrance, portal, or header handoff when data arrives.
6. **Resting CSS is authoritative.** On finish, skip, cancellation, reduced motion, tab visibility changes, resize, or errors, reconcile to the latest navigation state and remove temporary styles, names, layers, inert flags, and retained source references. Stale completion cannot finalize a newer action.
7. **Keep playback out of data churn.** Only explicit user actions start navigation motion. Token streaming, counts, image arrivals, and index updates cannot re-arm it. Pointer resizing follows the pointer directly.

The choice of transform/opacity for routine playback follows the browser rendering guidance in [web.dev's animation guide](https://web.dev/articles/animations-guide). Snapshot preparation must be bounded because a View Transition begins after its update callback completes, as specified by [the View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition).

## Plan by animation type

All durations below are proposed starting values for review, not measured wins. Keep a separate developer slow-motion control; do not use review speed as the default.

### 1. Dashboard tile → realm, and return

**Match:** only the selected tile's wallpaper face to the realm wallpaper. Use realm URL plus tile occurrence (favorite/catalog), so duplicated tiles cannot both match. Keep tile icon, label, and counts on the dashboard. The index card is a separate middle plane.

**Opening:** reveal the stationary, aspect-correct wallpaper through a rounded aperture over about 220 ms. Start the index card only after that reveal, then translate it upward about 16–24 px and fade it in over 160–180 ms. Total about 380–400 ms. The wallpaper, card, and chrome have independent tracks in one transaction. No scaling of the index-card text.

**Return:** retire the index card first (about 140 ms), then close the wallpaper aperture into the currently measured tile (about 220 ms). Retain dashboard scroll/filter state. If its source tile is no longer visible, fade the wallpaper into the dashboard instead of flying to stale coordinates or scrolling the user without input.

**Implementation:** replace the custom-property scene clock in `workspace-scene.gts` with direct tracks on a wallpaper-only bitmap/image plane and the index-card presentation. Do not clip the live workspace subtree. Use browser captures for the page representations, with a direct image layer when the wallpaper asset itself is already available. Verify aperture/radius cost; if it misses the budget, simplify to a short bitmap crossfade while retaining wallpaper-first sequencing.

**Loading:** use the cached tile wallpaper immediately and a stable destination shell. A cold index card must not hold the portal open or restart it.

### 2. Realm → another realm

**Match:** no shared card identity between different index cards. Wallpaper and page representations are independent outgoing/incoming bitmap faces.

**Motion:** if navigating through the dashboard, perform the normal return and tile-open actions. For direct realm switching, crossfade wallpaper faces over 220–260 ms, then admit the new index card. Do not shrink the old workspace into the new workspace's unrelated tile.

**Implementation:** reuse the navigation transaction and guard delayed `updateCodePath` results with its identity, so the old realm cannot overwrite the latest route after a quick switch.

### 3. Search dock → prompt → results, and close

**Match:** the dock control and sheet shell share an origin; prompt and results retain the same input and keyboard focus.

**Motion:** translate/fade a pre-laid-out sheet upward over 220–260 ms. The empty background shell can reveal from the dock, with its corners tweened. For prompt → results, resolve the results layout once, move the input by position only, and reveal the body with a clip and 120–160 ms fade. Close in 160–200 ms.

**Implementation:** remove width/height playback on the populated result tree in `search-sheet/motion.gts`. Give the shell, input/header, and results body separate roles. Keep list scroll and query state mounted; do not replay a fade for every query result. Reposition only affected popovers on completion, replacing the global synthetic `resize` event.

### 4. Search result → workspace card

**Match:** the selected visible tile occurrence to the newly created card presentation, never every instance with the same card URL.

**Motion:** one 280–340 ms bitmap crossing. Move the shared frame from the tile's clipped visible bounds to the final card bounds. Crossfade source/destination faces, preserve each bitmap's aspect ratio, and tween shell corners. The source starts opaque and the destination starts transparent; no two full-strength text faces. Retire the rest of the search sheet once.

**Implementation:** keep the useful bitmap helper, but place it under the navigation transaction. Establish the final shell in the snapshot update and finish that callback promptly. Capture a ready face if available; otherwise capture a stable shell/loading face and fade content in when ready. Suppress ordinary stack and sheet-close motion for the captured participants. Explicitly disable unintended root crossfade and define snapshot group order.

**Return/fallback:** return to that exact search result only when the search context is restored and the tile is visible. Otherwise use ordinary pop. With unsupported snapshots, use a brief translation/fade at the destination; remove the live full-card resizing fallback in `dock-card-motion.gts`.

### 5. Card push / pop inside a workspace

**Match:** stable stack and presentation IDs. A newly pushed card is not the same object as its parent card.

**Motion:** enter with 16–24 px translation plus opacity, about 240–320 ms. Exit with 12–18 px translation plus opacity, about 160–200 ms. Existing headers/cards translate only as needed. Covered bodies keep their settled geometry and stop participating in layout animation.

**Implementation:** remove full-height exits and blanket `@size=true` on populated cards in `stack-motion.gts`. Preserve explicit final `y=0`, resting opacity, focus, and interrupted-run cleanup. Container resizing is a separate action, not an incidental side effect of every push.

### 6. Card expand / collapse and header handoff

**Match:** shell, icon, title, and controls are separate semantic participants of one card presentation. Exactly one interactive header exists.

**Motion:** move the shell boundary and tween its radius over about 260–300 ms. Translate title/icon at native font dimensions. Fade controls that differ; do not stretch the entire toolbar. Lay out the destination card body once, then reveal it through the moving shell; if content must rewrap, use a short content fade around the single layout change.

**Implementation:** split `header-motion.ts` ownership into shell geometry and position-only title/icon motion. A child must not receive both its own displacement and its parent's displacement. Large body layout changes never run a width tween on the full text tree.

### 7. Neighbor stack creation, removal, and workspace reflow

**Match:** stable stack identities; children ride their stack unless moving to another stack.

**Motion:** translation for unchanged-width stacks, roughly 240–280 ms. If adding a column changes wrapping, commit widths once and reveal the newly laid-out content with a brief fade inside each moving shell. No live card scaleX/scaleY and no all-card size tween.

**Implementation:** scope measurement to affected stacks. Viewport resize reconciles to new layout immediately or retargets shell translation; it does not restart an entrance for every card.

### 8. Assistant dock open / close and divider drag

**Match:** one persistent assistant and existing workspace stacks.

**Motion:** slide the resolved panel from the edge in 220–260 ms while translating affected stack shells on the same timeline. Treat changed text wrapping as a one-time layout change with a short reveal. On drag, update layout directly without starting new tweens.

**Implementation:** preserve editor/conversation state and saved width. Streamed tokens never trigger dock or stack motion. This remains deferred until the existing navigation paths meet the performance gate.

### 9. Interact ↔ Code / card preview

**Match:** the selected card's preview face across page modes; editor text and unrelated cards are not shared elements.

**Motion:** a bounded bitmap crossfade, about 240–300 ms. The editor appears at final layout; its text never flies or stretches. Retain selection and scroll.

**Implementation:** reuse the proven bitmap transaction, with a simple fade when there is no visible matching preview. Defer until search handoff is reliable.

### 10. Dashboard sorting/filtering and image arrival

**Match:** visible tile occurrences, including distinct favorite/catalog instances.

**Motion:** position-only reorder over about 180–220 ms for a deliberate sort/filter. Added visible tiles can fade in. Count updates and newly decoded wallpapers do not animate the grid.

**Implementation:** start with 24 catalog tiles, then window by viewport plus overscan while preserving keyboard navigation, accessible order, focus, and return anchors. Retain the selected tile if needed for a crossing. Gate wallpaper asset loading near the viewport; retain source URLs/cache without keeping hundreds of active image surfaces. Pause hidden-catalog work.

### 11. Menus, dialogs, toasts, press feedback, attachment feedback

**Match:** stable overlay/attachment identity; content remains at its own proportions.

**Motion:** short translation and opacity, generally 120–180 ms. Press feedback changes surface color/shadow or moves 1–2 px; it does not scale text. An explicit attachment can send a bitmap/icon to its chip, followed by position-only chip reflow. Success highlights occur only after success.

**Implementation:** use shared tokens and existing focus/Escape semantics. Keep these effects independent of navigation. No animation on every streamed update. Defer new effects until core paths are smooth.

## Layer and property ownership

The following DOM layers retain the host's existing chrome ordering. Use an isolated workspace scene for its local planes; do not keep increasing global z-index to hide collisions.

| Plane                                    | Layer                | Owner and allowed motion                                       |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------- |
| Retained dashboard                       | scene 0              | Static, inert while covered; never a moving screen root.       |
| Realm wallpaper aperture                 | scene 1              | Wallpaper transaction: crop/radius or measured fallback fade.  |
| Workspace cards                          | scene 2              | Stack movement or index entrance, never both.                  |
| Retained departing card                  | host 100             | Short exit; released on finish/interrupt.                      |
| Moving expansion shell/header            | host 150             | Shell geometry; title/icon translation only.                   |
| Active dashboard overlay                 | host 200             | Settled dashboard presentation; moves to scene 0 for a portal. |
| Search sheet                             | host 300             | Sheet owner; suppressed for its captured bitmap handoff.       |
| Profile / profile popover                | host 400 / 500       | Existing chrome.                                               |
| Top bar / assistant / assistant controls | host 700 / 700 / 800 | Stationary chrome or dedicated assistant motion.               |
| Assistant popovers                       | host 900             | Existing chrome.                                               |

Browser View Transition pseudo-elements live outside this normal DOM stacking order. A `z-index:150` declaration on a live card cannot put its snapshot below a live toolbar. For bitmap handoffs, define and test the snapshot ordering explicitly: backdrop, wallpaper, card/sheet crossing, stationary chrome, active overlay. Prefer a scoped transition only after feature detection and validation; the document-scoped path needs stationary chrome represented above the crossing. Modal/top-layer interactions must remain above navigation, or navigation motion must be skipped while they are active. There must be no full-page default crossfade hiding these relationships.

## Implementation order and acceptance

1. **Record the baseline and centralize ownership.** Add lightweight marks for input, first visual response, shell commit, capture-ready, motion-finished, and content-ready. Record actual dashboard → PretUI, return, search → Slow Bloom, card push/pop, and expand/collapse in the signed-in preview. Measure cold and warm content separately. Add transaction identity; retain existing completion safeguards.
2. **Reduce background work.** Bound dashboard markup and wallpaper work, retain its state, and prove return does not remount/reload the catalog. Capture traces again before claiming an improvement.
3. **Fix ordinary motion first.** Central timing policy; stack translation/fade; shell/text separation for sheet and header. These should give a usable baseline even with cross-page effects disabled.
4. **Rebuild the two signature crossings independently.** First search bitmap handoff; then wallpaper-first realm portal, including reverse. Review each at normal speed and slow inspection speed before proceeding.
5. **Extend only after those pass.** Assistant docking, mode changes, grid reordering, and small action feedback reuse the established owners.

For each implemented type, collect five warm runs at desktop and 390 × 844, normal CPU and a documented throttled setting. Capture first-response latency, preparation time, layout/paint activity during playback, long tasks, and final bounds. Also review a recorded transition at actual display rate; rAF counts alone cannot establish compositor smoothness.

Proposed gates: visible response within 100 ms on the normal warm path; no network wait in capture; no repeated layout of complete card/result trees during steady playback; no new animation-induced long task over 50 ms on the normal warm path; final geometry within 1 CSS px of motion-disabled layout; exactly one visible identity; no residual transform, opacity, snapshot name, or pointer blocker. Treat these as targets to verify, not current results.

Exercise rapid reversal at multiple points, repeated selections, a 700 ms main-thread stall, delayed card content, failed images, resize, background/foreground, reduced motion, offscreen return targets, and duplicate tile/card identities. After a stall, the first available frame must reflect the latest state. Keep the existing 19 endpoint tests, but add representative loaded-content tests and traces: tiny fixtures do not reproduce this dashboard or these cards.

Acceptance requires both the measured evidence and a visually coherent normal-speed run. A successful build and passing endpoint assertions are necessary but insufficient.
