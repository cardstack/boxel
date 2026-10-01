// The usage pages this module used to hold now live in
// components/<slug>.usage.gts; what remains here is the fixtures they
// share. The header below describes those pages, not this file.
// Pretui — demo-texture: freestyle usage pages for the texture territory
// (BackgroundField, Backdrop, PulsingBorder in texture.gts).
//
// The BackgroundField page is deliberately shaped as a CATALOGUE rather than
// a specimen. That is the whole argument of the component: react-bits ships
// 55 separate background imports and cult-ui a parallel `bg-*` family, while
// Pretui ships one component whose `@variant` names a compiled field. A page
// that showed one field at a time would demonstrate a background; a page that
// shows all nine responding to ONE shared set of knobs demonstrates the
// consolidation. So the knob rail drives the focus specimen and all nine
// catalogue tiles simultaneously — change `@hue` once and watch every field
// re-tint, which is also the fastest way to see that nothing here carries a
// hardcoded palette.

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

