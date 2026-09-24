# Choreo motion opportunities for the Boxel host

Superseded direction: the [native-boxel redesign plan](./choreo-host-native-motion-plan.md) addresses the performance and motion-design problems reported on 2026-09-20. The implementation notes below are historical, not acceptance of the current animation quality.

Status: approved. Implemented: expanded header, search sheet, search tile → card, and dashboard ↔ realm portal. Assistant docking and the remaining navigation/action opportunities are still planned.

Phase 1 validation: 12 focused motion tests pass, including frame-by-frame geometry, one visible header, layer order, ordinary card reflow, interruption, reduced motion, dropped frames, and sheet resize. Host lint/type checks and the mise build pass. Review timing is now 600 ms. The [transition contract](./choreo-host-transition-contract.md) records matching, property ownership, fades, layers, and live measurements.

## Direction

Use motion to show where a card came from, where it went, and how the workspace accommodates it. Bento Boxel's strongest examples are tile-to-document, row-to-detail, and card-to-Build transitions. The host already has the corresponding objects: search results, card stacks, the assistant, workspace tiles, and code previews.

Correct resting layout is the first requirement. Dropped frames are acceptable; a card stranded at an intermediate scale, position, or opacity is not. The existing stack completion fixes must remain intact.

This plan is based on source review of the local Bento prototypes and the host. Implementation status is recorded above; remaining opportunities are proposals.

## Opportunities

| Opportunity                       | What the user sees                                                                                                                                                                   | Bento inspiration                                               | Scope                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Search result → card stack        | The selected result becomes the opened card, so its origin remains clear. Closing can return toward the result when it is still visible.                                             | Tile → document and row → detail crossings.                     | Medium–large: source and destination currently have different motion owners. |
| Assistant opens and makes room    | The assistant slides into its dock while cards move into the narrower workspace on the same timeline. Closing reverses the relationship.                                             | Persistent AI sidebar and workspace layout.                     | Medium: coordinate panel layout with existing stack motion.                  |
| Expanded card → top-bar header    | The card's title and icon travel into the expanded header slot as its shell fills the workspace; collapsing restores them together.                                                  | Persistent identity across views and animated breadcrumbs.      | Small–medium: finish the existing expansion transition.                      |
| Search prompt → results sheet     | The compact search control opens into a prompt, then expands into results; content and footer arrive with the sheet.                                                                 | Shelf and sheet presence transitions.                           | Medium: replace several CSS transitions and their completion callback.       |
| Workspace tile → workspace        | Selecting a workspace carries its icon/title into the workspace header while the background changes. Sorting or filtering tiles produces readable movement.                          | Seated card → document and dashboard reflow.                    | Medium–large: chooser and destination must share an explicit transition.     |
| Card → Code, plus action feedback | Opening a card in Code carries its identity into the preview; attaching a card to chat settles it into an attachment chip; jumping to source scrolls and highlights the destination. | Quick Look → Build, shelf placement, source/citation crossings. | Separate medium and small follow-ups; reuse the earlier crossing pattern.    |

## Recommended build order

### 1. Complete expansion and animate the search sheet

Start with two contained, frequently used interactions.

- Replace the independent header `Element.animate()` call with a Choreo transition coordinated with card expansion. Match the current expanded and collapsed layouts exactly, including the hidden covered cards.
- Animate search closed/prompt/results states through one timeline. Keep input focus and keyboard interaction available immediately. Preserve search terms, filters, and scroll state.
- Replace the search sheet's CSS `transitionend` dependency: dropdown positioning must update after the current Choreo run settles and also when motion is skipped. Interruption must not let an older callback reposition against an obsolete state.
- Use 600 ms tweens with non-overshooting easing for the current review build, per user feedback. Keep related card/header tracks synchronized.

Primary files: [stack-item.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/stack-item.gts:341), [stack-motion.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/stack-motion.gts), [submode-layout.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/submode-layout.gts:453), and [search-sheet/index.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/search-sheet/index.gts:68).

### 2. Add the signature result-to-stack transition and assistant docking

This is the highest-value Bento-inspired demonstration: search for an existing card, open it from its result, expand it, and open the assistant beside it.

Implemented opening behavior: capture the selected search tile and opened card as browser bitmap faces, crossfade them in a shared frame, and use proportional cropping when their aspect ratios differ. The live destination is already at its final layout. Missing snapshot support falls back to Choreo actual-size movement. Within-page text remains proportional. Closing to a surviving tile and assistant docking remain planned.

- Capture the selected result as a source beacon before navigation. Animate the destination card shell from that measured box to its actual layout. Crossfade differing preview/isolated content instead of stretching text throughout the transition.
- Give each navigation an identity distinct from the card URL: the same card can appear in multiple results or stacks.
- Return toward the source only when it still exists and is visible. Otherwise use the existing stack exit. Missing sources or slow card content must never delay navigation.
- Establish a narrowly scoped, persistent motion owner or bridge across search and stacks. Verify nested-region behavior before selecting the implementation; avoid two owners writing the same transform.
- Animate discrete assistant open/close changes together with workspace reflow. During divider dragging, follow the pointer directly; do not restart a tween on every drag event. Retain the user's saved panel width.
- Keep the assistant's conversation and focused-card context stable through docking. Do not animate every streamed token.

Primary files: [search/result-tile.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/search/result-tile.gts), [interact-submode.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/interact-submode.gts:948), and [submode-layout.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/submode-layout.gts:453).

### 3. Extend the proven pattern to navigation and actions

Workspace selection uses a reversible portal: the selected tile's image rectangle opens onto a stationary full-size wallpaper before the index card follows at natural size with a short lift and fade. One Choreo progress channel drives the aperture, radius, card translation, and opacity. Returning retires the card and closes the aperture toward the currently measured dashboard tile. The catalog is retained beneath the workspace; tile labels/icons remain on the back plane; generic card exits are suppressed during the portal. Matching icons/titles, animated tile sorting, and the other actions below remain planned.

Implement these individually after the previous phase is reliable:

- Workspace selection: carry the selected icon/title into the header and crossfade backgrounds. Preserve the chooser's immediate opaque background, which prevents a sign-in flash. Animate deliberate sorting/filtering without replaying an entrance for every incremental data update.
- Interact ↔ Code: carry the selected card into the preview area. Leave the editor and surrounding text stable, and preserve editor selection/scroll state.
- Attach to assistant: show a brief source-to-chip movement for an explicit attachment action; removal and expanding the chip list reflow smoothly.
- Jump to source: coordinate scrolling and a brief destination highlight. Show successful edit feedback only after an edit actually succeeds.

Primary files: [workspace-chooser/index.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/workspace-chooser/index.gts:770), [code-submode.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/operator-mode/code-submode.gts), and [attached-items.gts](/Users/chris/.codex/worktrees/2cb6/boxel/packages/host/app/components/ai-assistant/attachment-picker/attached-items.gts).

## Completion and interruption contract

1. Application state and CSS define the destination layout independently of animation. Skipping motion must produce the same geometry and behavior.
2. Every animated property has an explicit resting value. A rerender that changes an entering sprite into a kept sprite must continue all necessary channels, including scalar scale and opacity, rather than only its position.
3. Start crossings for a specific user action. Scope run ownership to the component or navigation transaction; a stale run must never finalize a newer one. Follow a replacement run through completion.
4. Use actual run completion for retained-element cleanup and dependent layout work, with an immediate path for reduced motion. Do not treat an elapsed duration timer as proof that the final frame was applied.
5. Any cancellation or recovery must reconcile to the latest application state, release temporary styles and layers, and leave no orphan or invisible pointer/focus blocker. Destruction must release listeners and retained elements.
6. Resolve the destination from current layout, including late card content and viewport changes. Do not restore a cached target box after it has become obsolete.
7. Respect reduced motion across all new interactions. Preserve focus, Escape handling, and return focus to a surviving origin where appropriate.

## Validation and review

For each interaction, compare final bounding rectangles, visibility, and scrollability against the same state with animation disabled. Account for intentional layout transforms rather than asserting that every transform must be absent.

Exercise normal completion, rapid reversal, close during entry, repeated navigation, content resizing during motion, viewport resizing, and a main-thread stall longer than the animation. Verify the correct resting state on the next available render after a stall, and after a hidden tab resumes. Include missing/offscreen origins and repeated occurrences of one card.

Extend the focused stack regression tests and add small component tests for each new interaction. Once crossings share infrastructure, add a short deterministic sequence of open/close/expand/search/panel actions that reports a reproducible seed, inspired by Bento's fuzz tests. Assert usable final layout, correct focus, and no retained exits or active run left behind.

Use the existing mise preview and staging cards for live review. Prefer focused tests and live reload during iteration; run package lint and the relevant build before delivering each implementation batch. Review one batch before expanding the scope.

## Bento source references

- [Workspace Choreo scene and crossings](/Users/chris/Projects/bento-boxel/app/components/workspace.gts:320): explicit crossings, source beacons, and continuation for sprites moved during an interrupted entry.
- [Crossing run ownership](/Users/chris/Projects/bento-boxel/app/lib/crossings.ts:131): generation guards and following replacement runs. Borrow the ownership principle, not its module-global state or startup polling wholesale.
- [AI sidebar](/Users/chris/Projects/bento-boxel/app/components/ai-sidebar.gts:157) and [top-bar breadcrumbs](/Users/chris/Projects/bento-boxel/app/components/top-bar.gts:285): scoped presence and identity changes.
- [Document crossing tests](/Users/chris/Projects/bento-boxel/tests/integration/doc-crossing-test.gts:51), [detail crossing tests](/Users/chris/Projects/bento-boxel/tests/integration/detail-crossing-test.gts:45), and [Build handoff tests](/Users/chris/Projects/bento-boxel/tests/integration/handoff-test.gts:36): bidirectional movement and interruption cases.
- [Seeded interaction tests in the sibling prototype](/Users/chris/Projects/bento-boxel-choreo/tests/integration/dashboard-fuzz-test.gts:546): repeatable stress sequences with motion-settled checks.
