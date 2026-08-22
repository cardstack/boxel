// @ts-nocheck — vendored verbatim; type-checked upstream under framer-motion's tsconfig
// Vendored from framer-motion/src/gestures/drag/use-drag-controls.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
import {
    DragControlOptions,
    VisualElementDragControls,
} from "./VisualElementDragControls"

/**
 * Can manually trigger a drag gesture on one or more `drag`-enabled `motion` components.
 *
 * ```jsx
 * const dragControls = useDragControls()
 *
 * function startDrag(event) {
 *   dragControls.start(event, { snapToCursor: true })
 * }
 *
 * return (
 *   <>
 *     <div onPointerDown={startDrag} />
 *     <motion.div drag="x" dragControls={dragControls} />
 *   </>
 * )
 * ```
 *
 * @public
 */
export class DragControls {
    private componentControls = new Set<VisualElementDragControls>()

    /**
     * Subscribe a component's internal `VisualElementDragControls` to the user-facing API.
     *
     * @internal
     */
    subscribe(controls: VisualElementDragControls): () => void {
        this.componentControls.add(controls)

        return () => this.componentControls.delete(controls)
    }

    /**
     * Start a drag gesture on every `motion` component that has this set of drag controls
     * passed into it via the `dragControls` prop.
     *
     * ```jsx
     * dragControls.start(e, {
     *   snapToCursor: true
     * })
     * ```
     *
     * @param event - PointerEvent
     * @param options - Options
     *
     * @public
     */
    start(
        event: PointerEvent,
        options?: DragControlOptions
    ) {
        this.componentControls.forEach((controls) => {
            controls.start(
                event,
                options
            )
        })
    }

    /**
     * Cancels a drag gesture.
     *
     * ```jsx
     * dragControls.cancel()
     * ```
     *
     * @public
     */
    cancel() {
        this.componentControls.forEach((controls) => {
            controls.cancel()
        })
    }

    /**
     * Stops a drag gesture.
     *
     * ```jsx
     * dragControls.stop()
     * ```
     *
     * @public
     */
    stop() {
        this.componentControls.forEach((controls) => {
            controls.stop()
        })
    }
}

/** framer-motion's useDragControls(): one DragControls per owner, created once */
export const createDragControls = () => new DragControls()

