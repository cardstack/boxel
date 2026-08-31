# Vendored from Motion

Copied verbatim (marked `// @ts-nocheck`, type-checked upstream) from `motion` at commit `bbabb00`
(the React package, `packages/framer-motion/src`), imports re-pointed at `motion-dom` / `motion-utils`. Filenames are kebab-cased and the files are
prettier-formatted to this repo's style (`git diff -w` or format upstream first when re-diffing). Re-diff them
against upstream whenever `motion-dom` is bumped:

| here                                                                                                                                                                                                                                             | upstream                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/gestures/pan-session.ts`, `pan-gesture.ts`, `visual-element-drag-controls.ts`, `drag-gesture.ts`, `drag-controls.ts`, `constraints.ts`, `event-info.ts`, `add-pointer-event.ts`, `distance.ts`, `get-context-window.ts`, `is-ref-object.ts` | `gestures/pan/*`, `gestures/drag/*`, `events/*`, `utils/distance.ts`, `utils/get-context-window.ts`, `utils/is-ref-object.ts` |
| `src/gestures/transform-page-point.ts`                                                                                                                                                                                                           | `utils/transform-rotated-parent.ts`, `utils/transform-viewbox-point.ts` (React ref → element or `{current}`)                  |
| `src/reorder/check-reorder.ts`, `detect-axis.ts`, `auto-scroll.ts`                                                                                                                                                                               | `components/Reorder/utils/*`                                                                                                  |
| `src/features.ts` (AnimationFeature, ExitAnimationFeature)                                                                                                                                                                                       | `motion/features/animation/*`                                                                                                 |

Everything else in `src/` is the Glimmer re-implementation of React glue (`motion` component lifecycle,
AnimatePresence, LayoutGroup, MeasureLayout timing, Reorder.Group/Item). The test-app carries the ports of
Motion's Jest suites and Cypress fixtures that pin the fidelity.

## Deviations

Vendored files are copied verbatim; where this port deliberately differs, the file says
`DEVIATION from upstream (see VENDORED.md)` at the site and the change is listed here.
Re-apply these after a re-diff.

| file                           | change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gestures/drag-gesture.ts` | `unmount()` always calls `controls.cancel()`. Upstream keeps the pan session alive when a component unmounts mid-drag, because React 19 can unmount and remount during reorder reconciliation; Glimmer's keyed `{{#each}}` moves nodes instead, so an unmount really is the end of the gesture. Upstream's branch skips `cancel()`, and with it the release of `setDragLock`'s module-global lock — so an element removed mid-drag silently kills `onDragStart` / `onDragEnd` for every later drag on the page. |
