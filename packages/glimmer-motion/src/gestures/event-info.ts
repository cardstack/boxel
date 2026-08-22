// @ts-nocheck — vendored verbatim; type-checked upstream under framer-motion's tsconfig
// Vendored from framer-motion/src/events/event-info.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
import { isPrimaryPointer } from "motion-dom"
import type { EventInfo } from "motion-dom"

export type EventListenerWithPointInfo = (
    e: PointerEvent,
    info: EventInfo
) => void

export function extractEventInfo(event: PointerEvent): EventInfo {
    return {
        point: {
            x: event.pageX,
            y: event.pageY,
        },
    }
}

export const addPointerInfo =
    (handler: EventListenerWithPointInfo): EventListener =>
    (event: PointerEvent) =>
        isPrimaryPointer(event) && handler(event, extractEventInfo(event))
