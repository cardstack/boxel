// Pretui — MOTION CORE. The four primitives the rest of the kit builds its
// motion on, all four dependency-free (Law 9) and timer-free (realm law):
// every effect is CSS, and the only JavaScript is *measurement* inside an
// ember-modifier that disconnects on cleanup.
//
//   Presence         mount/unmount transitions  ← AnimatePresence
//                    (motion-primitives / framer-motion)
//   InView           scroll-entrance choreography ← motion-primitives InView,
//                    react-bits AnimatedContent / ScrollReveal
//   SlidingHighlight the travelling selection indicator (Law 5's second
//                    canonical mechanism) — shared under Tabs /
//                    SegmentedControl / Select
//   ScrollProgress   reading-progress ribbon ← motion-primitives
//                    ScrollProgress
//
// What the inspiration got wrong, and what this file does instead, is
// recorded per component below. The recurring theme: all four upstreams pay
// a JS animation engine (and a per-frame RAF loop) for behaviour the modern
// CSS platform now expresses declaratively — @starting-style +
// transition-behavior: allow-discrete for real enter AND exit transitions,
// scroll-driven animation timelines for scroll binding. Dropping the engine
// is not a compromise here; it is the upgrade. It also means every one of
// these keeps working when the main thread is busy, which the RAF originals
// do not.
//
// (the motion-core group)

// Pretui — the shared motion vocabulary for Presence and InView.

// ── Shared motion vocabulary ─────────────────────────────────────────────
// One preset table for Presence and InView, so "rise" means the same travel
// in both. Exported so sibling components can speak the same vocabulary
// instead of inventing a third set of names.
export type MotionPreset = 'fade' | 'rise' | 'fall' | 'scale' | 'slide';

const PRESET_TRANSFORM: Record<MotionPreset, string> = {
  fade: 'none',
  rise: 'translateY(var(--pretui-motion-distance, 8px))',
  fall: 'translateY(calc(-1 * var(--pretui-motion-distance, 8px)))',
  scale: 'scale(var(--pretui-motion-scale, 0.96))',
  slide: 'translateX(calc(-1 * var(--pretui-motion-distance, 8px)))',
};

/**
 * The off-screen transform for a named motion preset. Every preset resolves
 * through `--pretui-motion-distance` / `--pretui-motion-scale`, so a caller
 * can retune travel without leaving the preset vocabulary.
 */
export function presetTransform(preset?: MotionPreset): string {
  return PRESET_TRANSFORM[preset ?? 'fade'] ?? PRESET_TRANSFORM.fade;
}

export function seconds(value: number | undefined, fallback: number): string {
  let v = value !== undefined && value > 0 ? value : fallback;
  return `${v.toFixed(3)}s`;
}
