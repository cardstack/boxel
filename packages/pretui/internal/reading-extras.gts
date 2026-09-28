// Pretui — reading extras: entity + date display components.
// Foundation decisions (per 2026-08-12 standing rules, revised 2026-08-12
// "one calendar" pass):
// - EntityDisplay: FRESH, merging boxel-ui's entity-icon-display and
//   entity-thumbnail-display into one component with @variant='icon'|
//   'thumbnail'; the tag row reuses Pretui Chip.
// - Calendar: FRESH — THE Pretui date surface. One month-grid implementation
//   (pure date math, roving-tabindex arrow keys) shared by every date control
//   in the kit. @mode='single'|'range'; @months panels side by side that
//   collapse to the first month in a narrow container.
// - DatePicker: Pretui Input trigger + Popover around a single-mode Calendar.
// - DateRangePicker: FRESH — rebuilt on Calendar in range mode (previously
//   wrapped boxel-ui's ember-power-calendar DateRangePicker; the wrap is
//   gone so both date controls share the same Pretui calendar). Popover
//   trigger consistent with DatePicker's; two months by default.
// - RelativeTime: FRESH (webawesome relative-time semantics) — computes the
//   phrase ONCE from @date vs @now; @now is caller-supplied (LoadingState
//   precedent). It does NOT auto-tick: the realm forbids timers.
// Visual values flow through theme tokens only; fallbacks declared per root.
//
// (the reading-extras group)

// Pretui — shared date math for the date components (pure: no deps, no timers).

// ── shared date math (pure — no deps, no timers) ─────────────────────────
export const DISPLAY_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
export const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
export const MONTH_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
});
export const ABS_FMT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function toIso(d: Date): string {
  let mm = String(d.getMonth() + 1).padStart(2, '0');
  let dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function fromIso(iso: string): Date | undefined {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    return undefined;
  }
  let [, y, mo, da] = m;
  return new Date(Number(y), Number(mo) - 1, Number(da));
}
