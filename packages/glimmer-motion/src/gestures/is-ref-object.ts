// @ts-nocheck — vendored verbatim; type-checked upstream under framer-motion's tsconfig
// Vendored from framer-motion/src/utils/is-ref-object.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
export interface MutableRefObject<T> { current: T }

export function isRefObject<E = any>(ref: any): ref is MutableRefObject<E> {
    return (
        ref &&
        typeof ref === "object" &&
        Object.prototype.hasOwnProperty.call(ref, "current")
    )
}
