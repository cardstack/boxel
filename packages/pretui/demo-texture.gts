// Pretui — demo-texture: the hue rail the BackgroundField, Backdrop and PulsingBorder usage pages share.

// A curated hue rail. Every entry but the first is a THEME TOKEN, because the
// point being demonstrated is that a field re-tints with the season and with
// light/dark on its own — the one literal at the end is there to prove the
// arg also takes a plain CSS color when a caller really wants one.
export const HUE_OPTIONS = [
  'default',
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--primary)',
  'var(--foreground)',
  '#c2410c',
];

export function hueArg(value: string): string | undefined {
  return value === 'default' ? undefined : value;
}

