import type { Format } from './formats.ts';
import type { HydrationMode } from './search-results-component.ts';

// The single declarative rule mapping a resolved render format to its default
// liveness. An auto-rendered field (a query- or collection-backed `@field`)
// inherits this default; a surface that needs different behavior passes an
// explicit hydration mode, which overrides the format default.
//
//   `fitted`           → prerendered HTML, inert until a lazy hydration gesture
//                        — the cheap fast path.
//   every other format → live — a full, running instance.
//   (incl. `embedded`)
//
// `live` and the gesture are kept apart: `HydrationMode` describes *when* inert
// HTML becomes live, which only applies to the prerendered branch. A live field
// has no gesture — it is already running.
export type FieldLiveness =
  | { live: true }
  | { live: false; mode: HydrationMode };

// The lazy gesture a prerendered field hydrates on by default: pointer hover
// (and, synonymously, keyboard focus) — the least-effort interaction.
const DEFAULT_LAZY_GESTURE: HydrationMode = 'hover';

export function defaultLivenessForFormat(format: Format): FieldLiveness {
  return format === 'fitted'
    ? { live: false, mode: DEFAULT_LAZY_GESTURE }
    : { live: true };
}
