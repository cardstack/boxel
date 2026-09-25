// Pretui — shared helpers for the ink components (Chip, StatusChip, Token, Meter, Avatar).
import { cssStyle } from '../pretui-css';

// Stable hash: same status value → same chart hue on every card (Law 2 corollary).
export function statusHue(value: string): string {
  let h = 0;
  let s = String(value);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `var(--chart-${(h % 5) + 1})`;
}

// `@hue` is a caller string, so it goes through the kit-wide allowlist before
// it reaches htmlSafe — an unvalidated one could carry its own declarations.
// A rejected hue drops the override and the stylesheet's own fallback paints.
export function hueStyle(prop: string, hue: string | undefined) {
  return cssStyle(prop, hue);
}
