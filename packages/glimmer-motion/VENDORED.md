# Vendored from Motion

Copied verbatim (marked `// @ts-nocheck`, type-checked upstream) from `motion` at commit `bbabb00`
(the React package, `packages/framer-motion/src`), imports re-pointed at `motion-dom` / `motion-utils`. Re-diff these
against upstream whenever `motion-dom` is bumped:

| here | upstream |
|---|---|
| `src/gestures/PanSession.ts`, `PanGesture.ts`, `VisualElementDragControls.ts`, `DragGesture.ts`, `DragControls.ts`, `constraints.ts`, `event-info.ts`, `add-pointer-event.ts`, `distance.ts`, `get-context-window.ts`, `is-ref-object.ts` | `gestures/pan/*`, `gestures/drag/*`, `events/*`, `utils/distance.ts`, `utils/get-context-window.ts`, `utils/is-ref-object.ts` |
| `src/gestures/transform-page-point.ts` | `utils/transform-rotated-parent.ts`, `utils/transform-viewbox-point.ts` (React ref → element or `{current}`) |
| `src/reorder/check-reorder.ts`, `detect-axis.ts`, `auto-scroll.ts` | `components/Reorder/utils/*` |
| `src/features.ts` (AnimationFeature, ExitAnimationFeature) | `motion/features/animation/*` |

Everything else in `src/` is the Glimmer re-implementation of React glue (`motion` component lifecycle,
AnimatePresence, LayoutGroup, MeasureLayout timing, Reorder.Group/Item). The test-app carries the ports of
Motion's Jest suites and Cypress fixtures that pin the fidelity.
