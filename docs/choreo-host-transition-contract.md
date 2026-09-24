# Host transition contract

Historical implementation notes through 2026-09-19. The current durations, ownership, portal tracks, bitmap layers, and performance evidence are specified in [the 2026-09-20 report](choreo-host-motion-report.md); it supersedes the older details below.

This replaces implicit animation rules with an explicit owner for each moving object. Live header/sheet timing is 600 ms. Workspace portals run for 420 ms; search bitmap crossings run for 380 ms, with non-overshooting easing. Reduced motion applies the destination immediately.

## Matching, movement, and visibility

| Object                                 | Identity / matching                                       | Movement                                                                                                                                                                          | Visibility during the transition                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card shell                             | Stack occurrence ID, not card URL                         | Existing Choreo stack entry/exit and layout movement                                                                                                                              | Entry fades in; exit fades out. Covered cards finish at opacity 0; exposed cards finish at 1.                                                                                                                                                         |
| Header in an ordinary stack reflow     | Remains inside its card                                   | Rides the card; no independent transform                                                                                                                                          | Fully visible, inheriting any card opacity.                                                                                                                                                                                                           |
| Header moving between card and top bar | Same occurrence ID with `:header` suffix                  | One arriving header moves between measured boxes in a temporary layer. Width/height and corner radius tween there on the same clock; text and icons are not scaled independently. | The arriving header is visible. The departing copy is immediately hidden and noninteractive, retained only for matching until cleanup. Its visibility hold is applied synchronously before the first painted frame. There is no two-header crossfade. |
| Interrupted header handoff             | Continue only IDs already moving in the current run       | Re-measure current painted origin and latest destination; preserve the same movement/temporary-layer policy                                                                       | No new entrance fade and no extra visible copy.                                                                                                                                                                                                       |
| Search sheet shell                     | One persistent element across closed/prompt/results       | Tween actual width, height, and position; keep its bottom anchored                                                                                                                | The shell uses the destination state's background. It does not scale its text or search results.                                                                                                                                                      |
| Search bar and results                 | Existing component instances                              | No independent position or scale animation                                                                                                                                        | Newly inserted content fades in. Kept content completes to opacity 1. Closing removes content immediately.                                                                                                                                            |
| Search tile → opened card              | Selected tile paired with a unique destination occurrence | Native bitmap frame morph with proportional cropping; actual-size Choreo fallback                                                                                                 | Outgoing and incoming bitmaps crossfade. The live destination stays at its final geometry.                                                                                                                                                            |
| Search footer                          | Persistent while search is open                           | Follows the sheet's layout                                                                                                                                                        | Opacity follows prompt/results state: 0 / 1.                                                                                                                                                                                                          |

The search sheet's final cue repositions open filter dropdowns after the current layout is applied, including the zero-duration path. Application navigation and input availability do not wait for the animation.

Dashboard tile → realm uses the tile's image rectangle as a portal aperture. The wallpaper stays full-size behind it; the index card waits until the aperture opens, then follows with a short lift and fade. Returning to the dashboard reverses both on the same progress channel. Tile icons, text, menus, and scrims stay on the dashboard plane.

## Layer order

Within the host's existing stacking context, from back to front:

| Layer                            |                         z-index | Rule                                                                                                                    |
| -------------------------------- | ------------------------------: | ----------------------------------------------------------------------------------------------------------------------- |
| Realm wallpaper                  |                               0 | Full-size, stationary background inside the clipped realm scene; no image growth or final image swap.                   |
| Resting cards                    | 1, with existing stack ordering | Preserve each card's position in its stack.                                                                             |
| Departing card shells            |                             100 | Above resting stack content, released when the exit finishes. Hidden donor headers cannot receive input here.           |
| Moving header / card from search |                             150 | Above cards; below workspace chooser, search, profile, and toolbar controls. Return to its normal parent when complete. |
| Workspace chooser                |                   200; portal 0 | During a portal, the chooser stays behind the realm scene (z-index 1). Otherwise it uses its existing layer.            |
| Search sheet                     |                             300 | Existing host layer; the new full-area wrapper passes pointer events through outside the sheet.                         |
| Profile / profile popover        |                       400 / 500 | Existing host layers.                                                                                                   |
| Top bar / assistant              |                             700 | Existing host layers. A settled expanded header belongs to the top bar again.                                           |
| Assistant button / popovers      |                       800 / 900 | Existing host layers.                                                                                                   |

The generic Choreo overlay previously used z-index 2147483000. The host now supplies an explicit raised-layer value so a flying header cannot cover unrelated controls.

## Measurement requirements

- Measure the actual arriving header, not its retained departing copy.
- Sample each animation frame. Width, height, and position must remain within the origin/destination envelope for this non-overshooting tween.
- Verify the departing header is hidden and the active header uses the expected layer while moving.
- Compare both directions and ordinary card reflow. A child header must not apply the card's transform a second time.
- Continue the existing interruption, reduced-motion, dropped-frame, final-geometry, and cleanup checks.

The first frame-sampling regression reproduced a 192 → 160 px header transition that incorrectly measured 384–461 px in flight. Promotion was measuring an already-transformed element and then applying those dimensions again, while percentage minimum-width constraints resolved against the overlay instead of the card. The local dependency patch uses the measured destination layout and temporarily releases those inherited constraints. Before measuring a replacement run, raised elements return to their real parents; a kept run promotes them again. This fixes reduced-motion changes during a handoff as well.

## Verified measurements

Measured on 2026-09-19 in the mise development build using staging cards. The live preview viewport was 1280 × 720 CSS pixels. Repeated DOM samples include duplicate samples within a browser frame; the focused rendering tests separately sample on each animation frame.

| Live Coffee Shop Menu header                    |              x |            y |            Width |        Height |
| ----------------------------------------------- | -------------: | -----------: | ---------------: | ------------: |
| Resting in card                                 |         21.320 |           59 |         1237.359 |            48 |
| Resting in toolbar                              |            370 |            9 |              800 |            40 |
| Expansion sample range (196 reads while raised) | 22.874–369.581 | 9.060–58.777 | 800.523–1235.406 | 40.008–47.961 |
| Restore sample range (211 reads while raised)   | 21.702–367.808 | 9.314–58.945 | 802.742–1236.875 | 40.047–47.984 |

Both directions stayed inside the measured endpoint envelope. Every raised sample used z-index 150 and had exactly one visible Coffee Shop Menu header. The restored rectangle matched a fresh render of the same URL; no inline width or motion transform remained on the header.

The live prompt → results search transition stayed on layer 300, with maximum bottom-anchor error of 0.016 px across 431 DOM samples. The final shell had no transform. Search results load independently of the geometry transition.

All 12 focused motion tests pass, including the 192 → 160 px fixture that previously grew to 461 px. They cover both header directions, per-frame bounds, visibility and layer checks, unscaled header text, ordinary card reflow, rapid reversal under load, reduced motion during a handoff, interrupted sheet resize/close, and the existing stack completion regressions. Host lint (including Glint type checking) and the mise preview build pass.

## Header corner radius

The same 600 ms Choreo tween also morphs the header's corners. In the card, top corners use `--boxel-border-radius-xl` (15 px at the standard root size) and bottom corners are square. In the toolbar, all four use `--boxel-border-radius-2xl` (20 px). A numeric CSS custom property interpolates between those theme values, so the geometry and roundness stay synchronized. The inline header owns its top corners while lifted out of the parent card's clipping region.

Reversal reads the previous receiver's current interpolation value, including a handoff interrupted before completion. CSS supplies the destination shape. The existing frame-sampling tests now also check intermediate radii, bounded radius values, both endpoints, and the final radius after interruption under load.

Live restore verification sampled top radii from 19.965 down to 15.008 px and bottom radii from 19.859 down to 0.030 px, then settled exactly at 15 px top / 0 px bottom. The expanded endpoint was 20 px on all four corners. All 12 focused motion tests and host lint/type checks pass with the radius tween.

## Opening from the search dock

The selected tile and destination card are separate browser bitmap faces. `glimmer-motion.animateView` captures the source before navigation, pairs it with the destination, and crossfades them in a shared moving frame over 380 ms. `crop(true)` uses proportional `object-fit: cover`; changes in aspect ratio crop excess pixels instead of stretching glyphs. The destination DOM is at its final layout throughout the bitmap crossing. The source element reference is consumed before creating the stack item.

This follows the native-boxel crossing's separate-face principle and retained dashboard underlay. The browser snapshot path handles the actual raster capture here. A missing source, reduced motion, or an unsupported snapshot API follows ordinary navigation. The existing Choreo dock path remains the fallback, resizing actual boxes without independently scaling text. Completion of the browser animation releases snapshot identities; no duration timer decides cleanup.

Within a page, stack reflow and header handoffs use actual width/height, never independent scaleX/scaleY. Ordinary card entry uses translation and opacity. Headers retain their existing single-copy matching and layer policy.

## Dashboard ↔ realm portal

The selected tile supplies an aperture rectangle, corner radius, realm URL, background URL, and favorite-section identity. Mouse and keyboard use the same capture path. The source belongs to the index stack occurrence; it is neither serialized into URL state nor copied into another stack. It remains available for the return trip. The chooser measures its current matching tile after rendering, so the return uses the actual dashboard layout.

Three planes have distinct responsibilities:

1. **Dashboard, back plane:** retained at z-index 0 during the transition. Tile labels, icons, menus, and scrims remain here.
2. **Realm wallpaper, back of the portal:** full workspace dimensions throughout. The scene's rounded clip expands from the tile rectangle to zero inset and zero radius. The wallpaper itself does not translate or scale.
3. **Index card, middle plane:** the stack waits at natural size while the wallpaper opens. After shared progress 0.6, it rises 1.5rem and fades in. Glyph dimensions do not change. It has no independent layout entrance or departing-workspace exit competing with the portal. Controls retain their existing foreground layers.

One Choreo numeric channel, `--workspace-portal-progress`, drives the aperture, corner radius, card translation, and opacity over 420 ms. The aperture uses progress 0–0.6; the card follows during 0.6–1. Opening runs from 0 to 1; returning runs from 1 to 0. An interruption continues from the painted progress. Layout replacements consume the original action’s remaining time instead of receiving another full duration. The dashboard has no competing CSS entrance fade. Resize recomputes aperture offsets relative to the actual workspace, while late content cannot reset the action's origin.

Workspace selection changes the active card and portal ownership in one render, before awaiting code-path metadata. The old workspace is removed immediately instead of sliding out over the new scene. Return-target updates are idempotent to avoid a tracked layout-report feedback loop.

A token-guarded Choreo Perform cue completes the action. Opening conceals and disables the retained dashboard and clears temporary clip/translation; returning conceals and disables the scene so the selected tile's labels are visible again. No elapsed-duration timer is used for cleanup. Reduced motion applies the same destinations immediately. Realms without an image use ordinary workspace navigation.

Focused rendering checks cover both directions, stationary wallpaper geometry, unscaled card translation, monotonic progress, previous-workspace removal, replacement and reversal, late content, resize, a 700 ms stall, zero duration, and cleanup.

The dashboard remains mounted and inert behind the workspace. Returning reuses its tiles and scroll position instead of rebuilding the catalog during the animation.

Reference: `/Users/chris/Projects/native-boxel/boxel-kernel/frontend/crossing.js` separates outgoing/incoming faces; `ui-realm/native-app.gts` retains the catalog under the workspace; `ui-realm/operator-choreography.ts` uses translation and opacity for card entry.

Validation: all 19 focused motion tests pass, including live text proportions during interrupted stack resizing, bitmap aspect preservation and cleanup after a main-thread stall, and wallpaper-before-card ordering in both directions. Host lint/type checks and the mise staging preview build pass. The live Slow Bloom search handoff showed old/new bitmap opacity pairs of 1/0, 0.394/0.606, 0.107/0.893, and 0/1; both faces used `object-fit: cover`. The destination DOM had `transform: none` throughout, temporary snapshot names were released, and no browser errors were reported.
