// Pretui — structure territory, scenes wave: four scene-setting layout
// pieces TRANSCRIBED (not wrapped — no boxel-ui engine exists for these)
// from their JS-motion originals into CSS-first Glimmer:
//   Marquee       ← fancy SimpleMarquee (rAF motion-value engine → pure
//                   CSS keyframe loop; TIMER LAW: no JS timers)
//   Comparison    ← webawesome wa-comparison semantics (role=slider seam,
//                   arrow/Home/End keys) + motion-primitives
//                   ImageComparison layer-clip idea, drag via the
//                   pointer-capture modifier pattern (freestyle Viewport)
//   StackingCards ← fancy StackingCards (scroll-progress transforms →
//                   pure position:sticky pinning + static nth-child scale)
//   Dock          ← motion-primitives Dock (cursor-distance spring
//                   magnification → :hover/:has sibling falloff)
// Theming contract: no dark-mode branches; every color is
// var(--token, lightFallback); prefers-reduced-motion honored wherever
// anything moves. Per-component delta notes sit on each section.
//
// Pretui — shared helpers for the scene components.

export function clamp01to100(v: number): number {
  return Math.min(100, Math.max(0, v));
}
export function styleVar(name: string, value: string): string {
  return `${name}: ${value}`;
}
