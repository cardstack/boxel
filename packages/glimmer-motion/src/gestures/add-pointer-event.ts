// @ts-nocheck — vendored verbatim; type-checked upstream under Motion's tsconfig
// Vendored from Motion's packages/framer-motion/src/events/add-pointer-event.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
import { addDomEvent } from "motion-dom"
import { addPointerInfo } from "./event-info"
import type { EventListenerWithPointInfo } from "./event-info"

export function addPointerEvent(
    target: EventTarget,
    eventName: string,
    handler: EventListenerWithPointInfo,
    options?: AddEventListenerOptions
) {
    return addDomEvent(target, eventName, addPointerInfo(handler), options)
}
