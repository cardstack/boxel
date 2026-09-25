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
