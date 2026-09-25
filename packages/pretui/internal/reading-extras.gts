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
