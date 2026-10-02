// Pretui — TEXTURE territory. Three components: BackgroundField (the
// consolidated ambient-field catalogue), Backdrop (the scrim under layered
// surfaces), PulsingBorder (the "this is live" boundary, shipped WITH its
// text affordance).
//
// Law 6 governs this whole file: texture never carries information. Every
// painted layer here is `aria-hidden`, `pointer-events: none`, and never the
// sole carrier of meaning. The one borderline case the matrix calls out —
// "pulsing border" = "this is live" — ships the affordance in the component
// rather than trusting the caller to bolt one on.
//
// Law 9 governs the implementation: `pretui/texture` vendors NO engine. No
// WebGL, no ogl, no three, no paper-shaders, no canvas paint loop, no
// requestAnimationFrame. Everything below is gradients, masks, transforms
// and @keyframes. A card rendering an invoice pays for nothing.
//
// What the inspiration got wrong, and what this file does instead:
//
//   * react-bits ships **55 separate background components** (Aurora, Beams,
//     DotGrid, GradientWaves, Grainient, LightRays, Plasma, Waves, …), most
//     of them dragging in ogl/WebGL; cult-ui ships a parallel `bg-*` /
//     `hero-*` family; fancy ships AnimatedGradientWithSvg. Fifty-five import
//     paths, fifty-five prop surfaces, fifty-five bundles. Pretui ships ONE
//     component with a `@variant` knob naming a compiled catalogue. The
//     consolidation IS the improvement: one signature to learn, one set of
//     knobs (scale / opacity / hue / speed / fade) that means the same thing
//     in every field, and one place where the reduced-motion and token rules
//     are enforced.
//   * Upstream backgrounds hardcode their palettes (`#7cff67`, `rgba(255,
//     255,255,.08)`) or fork on `dark:`. Every field here rides theme tokens
//     (`--chart-1…5`, `--foreground`, `--background`) through
//     `color-mix()`, so a field re-tints with the season and with light/dark
//     automatically. There is not one dark branch in this file.
//   * Upstream animates `background-position` (a full repaint of a
//     viewport-sized layer, every frame). Here the painted layer is
//     oversized and only `transform` / `opacity` are animated — compositor
//     work, no repaint. Tile-drift translations are exactly one tile, so the
//     loop is seamless.
//   * Upstream's "reduced motion" story is usually nothing at all. Here the
//     base rule IS the resting state and the keyframes only supply the
//     choreography, so `animation: none` is a complete, deliberate-looking
//     kill switch (Law 5).
//   * Deliberately NOT ported: everything that needs a shader or a particle
//     integrator (Galaxy, Plasma, Iridescence, Dither, Particles, Lightfall,
//     GridDistortion, Balatro…). Those are not expressible in honest CSS and
//     Law 9 forbids the engine that would make them possible. They are named
//     here rather than hidden (Law 7).
//
// Every component here lives in its own module under components/; this
// module re-exports them so existing imports keep working.
//
// (the texture group)

// Pretui — shared style helpers for the texture components (BackgroundField, Backdrop, PulsingBorder).
import { htmlSafe } from '@ember/template';
import { cssValue as sharedCssValue } from '../pretui-css';

// ── shared helpers ───────────────────────────────────────────────────────

// Args flow into inline custom properties, so caller strings go through the
// kit-wide allowlist (pretui-css.gts) before they reach htmlSafe.
//
// This replaced a local strip-and-continue sanitiser that removed `;{}<>`
// and kept whatever was left — which let `url(https://evil/x)` through
// untouched, since it contains none of those characters. Validate-or-drop is
// the only version of this that holds. `@hue='var(--chart-4)'` (the useful
// case) is unaffected.
export function cssValue(value: string | undefined): string | undefined {
  return sharedCssValue(value);
}

export function clampNum(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.max(value, min), max);
}

export function styleFrom(parts: string[]): ReturnType<typeof htmlSafe> | undefined {
  return parts.length > 0 ? htmlSafe(parts.join('; ')) : undefined;
}
